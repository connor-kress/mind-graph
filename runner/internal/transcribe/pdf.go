package transcribe

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"

	"github.com/connor-kress/mind-graph/runner/internal/config"
	"github.com/connor-kress/mind-graph/runner/internal/openrouter"
	"github.com/connor-kress/mind-graph/runner/internal/pdf"
)

// PDF transcribes a PDF in ranges of pages. For each, the model reads the
// native PDF and links its figures, using tools to inspect, render and crop.
type PDF struct {
	Config  config.Config
	AI      *openrouter.Client
	Tool    pdf.Tool
	Prompts Prompts
}

func (t *PDF) Transcribe(ctx context.Context, _ string, data []byte, dir string) (*Result, error) {
	path := filepath.Join(dir, "source.pdf")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return nil, err
	}
	pages, err := t.Tool.PageCount(ctx, path)
	if err != nil {
		slog.Warn("couldn't count pages", "error", err)
		return nil, UserError("Couldn't read this PDF. If it has a password, remove it and upload it again.")
	}
	if pages == 0 {
		return nil, UserError("This PDF has no pages.")
	}
	if pages > t.Config.MaxPages {
		return nil, UserError(fmt.Sprintf("This PDF has %d pages. PDFs of up to %d pages can be transcribed.", pages, t.Config.MaxPages))
	}

	type part struct {
		text   string
		assets []*Asset
	}
	size := t.Config.RangePages
	parts := make([]part, (pages+size-1)/size)
	var ids, crops atomic.Int64
	err = ForEach(ctx, len(parts), t.Config.Parallel, func(ctx context.Context, i int) error {
		first, last := i*size+1, min((i+1)*size, pages)
		var err error
		parts[i].text, parts[i].assets, err = t.transcribeRange(ctx, path, first, last, dir, &ids, &crops)
		return err
	})
	if err != nil {
		return nil, err
	}

	var text strings.Builder
	assets := map[string]*Asset{}
	for _, p := range parts {
		text.WriteString(strings.TrimSpace(p.text) + "\n\n")
		for _, a := range p.assets {
			assets[a.ID] = a
		}
	}
	md, used := linkAssets(strings.TrimSpace(text.String())+"\n", func(id string) bool { return assets[id] != nil })
	if len(used) > maxAssets {
		allowed := map[string]bool{}
		for _, id := range used[:maxAssets] {
			allowed[id] = true
		}
		md, used = linkAssets(md, func(id string) bool { return allowed[id] })
	}
	// One image too large to upload loses only that image, not the note.
	for _, id := range used {
		if err := shrinkAsset(assets[id], dir); err != nil {
			slog.Warn("dropping an image too large to upload", "asset", id, "error", err)
			delete(assets, id)
		}
	}
	md, used = linkAssets(md, func(id string) bool { return assets[id] != nil })
	result := &Result{Markdown: md, Pages: pages}
	for _, id := range used {
		result.Assets = append(result.Assets, assets[id])
	}
	return result, nil
}

// transcribeRange transcribes pages first to last, splitting the range if the
// response would be too long. Its pages are numbered as in the whole PDF.
func (t *PDF) transcribeRange(ctx context.Context, path string, first, last int, dir string, ids, crops *atomic.Int64) (string, []*Asset, error) {
	r := &pagesRun{t: t, pages: last - first + 1, dir: filepath.Join(dir, fmt.Sprintf("pages-%d-%d", first, last)),
		ids: ids, assets: map[string]*Asset{}, crops: crops}
	md, err := r.run(ctx, path, first, last)
	if errors.Is(err, openrouter.ErrTooLong) && first < last {
		// Crops of the abandoned attempt don't count against the document.
		crops.Add(-r.cropped)
		mid := (first + last) / 2
		slog.Info("response too long; splitting the range", "pages", fmt.Sprintf("%d-%d", first, last))
		a, assetsA, err := t.transcribeRange(ctx, path, first, mid, dir, ids, crops)
		if err != nil {
			return "", nil, err
		}
		b, assetsB, err := t.transcribeRange(ctx, path, mid+1, last, dir, ids, crops)
		return a + "\n\n" + b, append(assetsA, assetsB...), err
	}
	if err != nil {
		return "", nil, fmt.Errorf("pages %d-%d: %w", first, last, err)
	}
	return renumber(md, first-1), r.list(), nil
}

// maxAssets and maxAssetBytes match convex/runner.ts.
const (
	maxAssets     = 200
	maxAssetBytes = 10 << 20
)

// shrinkAsset re-encodes an image too large to upload as a smaller JPEG.
func shrinkAsset(a *Asset, dir string) error {
	info, err := os.Stat(a.Path)
	if err != nil || info.Size() <= maxAssetBytes {
		return err
	}
	img, err := decodeImageFile(a.Path)
	if err != nil {
		return err
	}
	for _, side := range []int{4096, 2048} {
		data, err := encodeJPEG(fit(img, side, side))
		if err != nil {
			return err
		}
		if len(data) <= maxAssetBytes {
			path := filepath.Join(dir, a.ID+"-small.jpg")
			if err := os.WriteFile(path, data, 0o600); err != nil {
				return err
			}
			a.Path, a.ContentType = path, "image/jpeg"
			return nil
		}
	}
	return fmt.Errorf("still over %d bytes", maxAssetBytes)
}
