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

// PDF transcribes a PDF's text in ranges of pages, then links each page's figures.
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
		text, figures string
		assets        []*Asset
	}
	size := t.Config.TextRangePages
	parts := make([]part, (pages+size-1)/size)
	var ids, crops atomic.Int64
	err = forEach(ctx, len(parts), t.Config.Parallel, func(ctx context.Context, i int) error {
		first, last := i*size+1, min((i+1)*size, pages)
		p := &parts[i]
		var err error
		if p.text, err = t.textPass(ctx, path, first, last, dir); err != nil || !t.Config.Figures {
			return err
		}
		dir := filepath.Join(dir, fmt.Sprintf("figures-%d", first))
		figures, assets, err := t.figurePass(ctx, path, first, last, dir, &ids, &crops)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			// Without figures, the text still makes a useful note.
			slog.Warn("figure pass failed; keeping the text", "pages", fmt.Sprintf("%d-%d", first, last), "error", err)
			return nil
		}
		p.figures, p.assets = renumber(figures, first-1), assets
		return nil
	})
	if err != nil {
		return nil, err
	}

	var text, figures strings.Builder
	assets := map[string]*Asset{}
	for _, p := range parts {
		text.WriteString(strings.TrimSpace(p.text) + "\n\n")
		figures.WriteString(p.figures + "\n\n")
		for _, a := range p.assets {
			assets[a.ID] = a
		}
	}
	md := mergeFigures(text.String(), figures.String())
	md, used := linkAssets(md, func(id string) bool { return assets[id] != nil })
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

// textPass transcribes pages first to last, splitting the range if the
// response would be too long. Its pages are numbered as in the whole PDF.
func (t *PDF) textPass(ctx context.Context, path string, first, last int, dir string) (string, error) {
	rangePath := filepath.Join(dir, fmt.Sprintf("text-%d-%d.pdf", first, last))
	if err := t.Tool.Split(ctx, path, first, last, rangePath); err != nil {
		return "", err
	}
	data, err := os.ReadFile(rangePath)
	if err != nil {
		return "", err
	}
	c, err := t.AI.Complete(ctx, openrouter.Request{
		MaxTokens: textMaxTokens,
		PDF:       true,
		Messages: []openrouter.Message{{Role: "user", Content: []openrouter.Part{
			openrouter.TextPart(t.Prompts.Text),
			openrouter.PDFPart(fmt.Sprintf("pages-%d-%d.pdf", first, last), data),
		}}},
	})
	if errors.Is(err, openrouter.ErrTooLong) && first < last {
		mid := (first + last) / 2
		slog.Info("text too long; splitting the range", "pages", fmt.Sprintf("%d-%d", first, last))
		a, err := t.textPass(ctx, path, first, mid, dir)
		if err != nil {
			return "", err
		}
		b, err := t.textPass(ctx, path, mid+1, last, dir)
		return a + "\n\n" + b, err
	}
	if err != nil {
		return "", err
	}
	text := strings.TrimSpace(unfence(c.Message.Text()))
	if text == "" {
		return "", fmt.Errorf("pages %d-%d: empty transcription", first, last)
	}
	return renumber(text, first-1), nil
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
