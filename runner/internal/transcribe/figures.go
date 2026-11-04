package transcribe

import (
	"bytes"
	"cmp"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"image"
	"math"
	"os"
	"path/filepath"
	"slices"
	"sync/atomic"

	"github.com/connor-kress/mind-graph/runner/internal/openrouter"
	"github.com/connor-kress/mind-graph/runner/internal/pdf"
)

// The figure pass links each page's figures after its text is transcribed. The
// model sees the native PDF, every original bitmap and page previews, and uses
// local tools to inspect, render and crop, getting real pixels back.

const figureMaxTokens = 12000

// Bitmaps smaller than this on either side are taken to be decoration.
const minAssetSide = 25

// Longer sides, in pixels, of page renders: for previews, closer looks, and crops.
const (
	previewSize = 800
	inspectSize = 1400
	cropSize    = 2400
)

// figureRun is one range's figure pass.
type figureRun struct {
	t      *PDF
	pdf    string // The range as its own PDF, with pages counted from 1.
	pages  int
	dir    string
	ids    *atomic.Int64
	assets map[string]*Asset
	// Crops so far, across the document.
	crops *atomic.Int64
	// The last page rendered to crop from, by page.
	cropPage   int
	cropSource image.Image
	plans      int
}

// figurePass returns Markdown with ## Page N sections, counted within the range, and the assets it may link to.
func (t *PDF) figurePass(ctx context.Context, source string, first, last int, dir string, ids, crops *atomic.Int64) (string, []*Asset, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", nil, err
	}
	r := &figureRun{t: t, pdf: filepath.Join(dir, "range.pdf"), pages: last - first + 1, dir: dir, ids: ids,
		assets: map[string]*Asset{}, crops: crops}
	if err := t.Tool.Split(ctx, source, first, last, r.pdf); err != nil {
		return "", nil, err
	}
	pdfData, err := os.ReadFile(r.pdf)
	if err != nil {
		return "", nil, err
	}
	if err := r.findOriginals(ctx); err != nil {
		return "", nil, err
	}
	content := []openrouter.Part{
		openrouter.TextPart(t.Prompts.Figures + "\nInventory:\n" + r.inventory()),
		openrouter.PDFPart("pages.pdf", pdfData),
	}
	sheets, err := r.assetSheets()
	if err != nil {
		return "", nil, err
	}
	for _, s := range sheets {
		content = append(content, openrouter.TextPart("Labeled local asset contact sheet. Use the visible ID to match actual content."), s)
	}
	sheets, err = r.pageSheets(ctx)
	if err != nil {
		return "", nil, err
	}
	for _, s := range sheets {
		content = append(content, openrouter.TextPart("Actual full-page previews, labeled by physical PDF page. These support figure discovery; native PDF remains the transcription source."), s)
	}
	messages := []openrouter.Message{{Role: "user", Content: content}}

	turns := max(1, t.Config.FigureTurns)
	for turn := range turns {
		remaining := turns - turn
		budget := fmt.Sprintf("You have %d response turns remaining including the final Markdown. Batch independent tools now. Reserve a final response after image feedback.", remaining)
		var tools json.RawMessage = t.Prompts.Tools
		if remaining == 1 {
			budget += " This is the final turn. Return the complete Markdown using verified assets now."
			tools = nil
		}
		messages = append(messages, openrouter.Message{Role: "user", Content: budget})
		c, err := t.AI.Complete(ctx, openrouter.Request{MaxTokens: figureMaxTokens, PDF: true, Messages: messages, Tools: tools})
		if err != nil {
			return "", nil, err
		}
		msg := c.Message
		messages = append(messages, openrouter.Message{Role: "assistant", Content: msg.Content, ToolCalls: msg.ToolCalls})
		if len(msg.ToolCalls) == 0 {
			return unfence(msg.Text()), r.list(), nil
		}
		var previews []openrouter.Part
		for _, call := range msg.ToolCalls {
			meta, preview := r.execute(ctx, call)
			metaJSON, _ := json.Marshal(meta)
			messages = append(messages, openrouter.Message{Role: "tool", ToolCallID: call.ID, Content: string(metaJSON)})
			if preview != nil {
				previews = append(previews, openrouter.TextPart("Actual local pixels for tool result "+call.ID+" "+string(metaJSON)), *preview)
			}
		}
		if previews != nil {
			previews = append(previews, openrouter.TextPart("Inspect the returned pixels. Continue, revise an incomplete crop if needed, then finish the requested Markdown."))
			messages = append(messages, openrouter.Message{Role: "user", Content: previews})
		}
	}
	return "", nil, fmt.Errorf("no figures after %d turns", turns)
}

func (r *figureRun) list() []*Asset {
	var out []*Asset
	for _, a := range r.assets {
		out = append(out, a)
	}
	return out
}

// newID numbers assets across the document, since its ranges' Markdown is joined.
func (r *figureRun) newID(prefix string) (string, int64) {
	n := r.ids.Add(1)
	return fmt.Sprintf("%s%d", prefix, n), n
}

// findOriginals extracts the range's bitmaps. One drawn on several pages, such as a logo, is one asset.
func (r *figureRun) findOriginals(ctx context.Context) error {
	dir := filepath.Join(r.dir, "originals")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	placed, err := r.t.Tool.Images(ctx, r.pdf, 1, r.pages, dir)
	if err != nil {
		return err
	}
	byHash := map[[32]byte]*Asset{}
	for _, p := range placed {
		data, err := os.ReadFile(p.Path)
		if err != nil {
			return err
		}
		cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil || min(cfg.Width, cfg.Height) < minAssetSide || cfg.Width*cfg.Height > pdf.MaxImagePixels {
			continue
		}
		box := p.Box
		for i := range box {
			box[i] = math.Round(box[i])
		}
		hash := sha256.Sum256(data)
		if a := byHash[hash]; a != nil {
			a.placements = append(a.placements, placement{p.Page, box})
			continue
		}
		id, seq := r.newID("img")
		a := &Asset{ID: id, seq: seq, page: p.Page, Path: p.Path, ContentType: "image/" + format,
			width: cfg.Width, height: cfg.Height, kind: "original", placements: []placement{{p.Page, box}}}
		byHash[hash] = a
		r.assets[a.ID] = a
	}
	return nil
}

// inventory lists each page's originals, with where they're drawn and whether the page edge clips them.
func (r *figureRun) inventory() string {
	type item struct {
		ID      string     `json:"id"`
		Width   int        `json:"width"`
		Height  int        `json:"height"`
		Box     [4]float64 `json:"bbox_normalized"`
		Clipped bool       `json:"clipped_by_page_edge"`
	}
	type page struct {
		Page   int    `json:"page"`
		Assets []item `json:"assets"`
	}
	pages := make([]page, r.pages)
	for i := range pages {
		pages[i] = page{Page: i + 1, Assets: []item{}}
	}
	for _, a := range r.sorted() {
		for _, p := range a.placements {
			if p.Page < 1 || p.Page > r.pages {
				continue
			}
			clipped := p.Box[0] < 0 || p.Box[1] < 0 || p.Box[2] > 1000 || p.Box[3] > 1000
			pages[p.Page-1].Assets = append(pages[p.Page-1].Assets, item{a.ID, a.width, a.height, p.Box, clipped})
		}
	}
	data, _ := json.Marshal(pages)
	return string(data)
}

// sorted lists assets by page, then in the order they were found.
func (r *figureRun) sorted() []*Asset {
	out := r.list()
	slices.SortFunc(out, func(a, b *Asset) int {
		return cmp.Or(cmp.Compare(a.page, b.page), cmp.Compare(a.seq, b.seq))
	})
	return out
}

func (r *figureRun) assetSheets() ([]openrouter.Part, error) {
	var parts []openrouter.Part
	assets := r.sorted()
	for start := 0; start < len(assets); start += 6 {
		var tiles []tile
		for _, a := range assets[start:min(start+6, len(assets))] {
			img, err := decodeImageFile(a.Path)
			if err != nil {
				return nil, err
			}
			// Only the thumbnail is kept, not the decoded original.
			tiles = append(tiles, tile{fit(img, 480, 300), []string{a.ID, fmt.Sprintf("page %d | %dx%d | %s", a.page, a.width, a.height, a.kind)}})
		}
		part, err := jpegPart(sheet(tiles, 2, 500, 340))
		if err != nil {
			return nil, err
		}
		parts = append(parts, part)
	}
	return parts, nil
}

func (r *figureRun) pageSheets(ctx context.Context) ([]openrouter.Part, error) {
	pages := make([]int, r.pages)
	for i := range pages {
		pages[i] = i + 1
	}
	var parts []openrouter.Part
	for start := 0; start < len(pages); start += 4 {
		part, err := r.pagePreviews(ctx, pages[start:min(start+4, len(pages))], previewSize)
		if err != nil {
			return nil, err
		}
		parts = append(parts, part)
	}
	return parts, nil
}

// pagePreviews puts pages side by side, two to a row, each labeled with its number.
func (r *figureRun) pagePreviews(ctx context.Context, pages []int, size int) (openrouter.Part, error) {
	var tiles []tile
	for _, n := range pages {
		img, err := r.render(ctx, n, size)
		if err != nil {
			return openrouter.Part{}, err
		}
		tiles = append(tiles, tile{img, []string{fmt.Sprintf("PHYSICAL PDF PAGE %d", n)}})
	}
	return jpegPart(sheet(tiles, 2, 600, 500))
}

func (r *figureRun) render(ctx context.Context, page, size int) (image.Image, error) {
	path := filepath.Join(r.dir, fmt.Sprintf("page-%d-%d.png", page, size))
	if err := r.t.Tool.Render(ctx, r.pdf, page, size, path); err != nil {
		return nil, err
	}
	return decodeImageFile(path)
}

func jpegPart(img image.Image) (openrouter.Part, error) {
	data, err := encodeJPEG(img)
	return openrouter.ImagePart("image/jpeg", data), err
}

// execute runs a tool call, returning its result and any pixels to show the model.
func (r *figureRun) execute(ctx context.Context, call openrouter.ToolCall) (map[string]any, *openrouter.Part) {
	meta, preview, err := r.tool(ctx, call)
	if err != nil {
		return map[string]any{"error": err.Error()}, nil
	}
	return meta, preview
}

func (r *figureRun) tool(ctx context.Context, call openrouter.ToolCall) (map[string]any, *openrouter.Part, error) {
	var args struct {
		AssetID string    `json:"asset_id"`
		Page    int       `json:"page"`
		Pages   []int     `json:"pages"`
		BBox    []float64 `json:"bbox"`
	}
	if err := json.Unmarshal([]byte(call.Function.Arguments), &args); err != nil {
		return nil, nil, fmt.Errorf("arguments aren't valid JSON")
	}
	checkPage := func(n int) error {
		if n < 1 || n > r.pages {
			return fmt.Errorf("page %d doesn't exist; pages are 1 to %d", n, r.pages)
		}
		return nil
	}
	switch call.Function.Name {
	case "record_figure_plan":
		// Asking for a plan makes the model consider every page. It's kept to debug missed figures.
		r.plans++
		path := filepath.Join(r.dir, fmt.Sprintf("figure-plan-%d.json", r.plans))
		if err := os.WriteFile(path, []byte(call.Function.Arguments), 0o600); err != nil {
			return nil, nil, err
		}
		return map[string]any{"recorded": true}, nil, nil

	case "inspect_asset":
		a := r.assets[args.AssetID]
		if a == nil {
			return nil, nil, fmt.Errorf("no asset %q", args.AssetID)
		}
		img, err := decodeImageFile(a.Path)
		if err != nil {
			return nil, nil, err
		}
		part, err := jpegPart(fit(img, 1600, 1600))
		return map[string]any{"asset_id": a.ID, "kind": a.kind, "size": []int{a.width, a.height}}, &part, err

	case "render_pages":
		if len(args.Pages) < 1 || len(args.Pages) > 8 {
			return nil, nil, fmt.Errorf("render 1 to 8 pages at a time")
		}
		for _, n := range args.Pages {
			if err := checkPage(n); err != nil {
				return nil, nil, err
			}
		}
		part, err := r.pagePreviews(ctx, args.Pages, inspectSize)
		return map[string]any{"pages": args.Pages, "kind": "page_previews"}, &part, err

	case "crop":
		if len(args.BBox) != 4 {
			return nil, nil, fmt.Errorf("bbox needs 4 numbers")
		}
		if r.crops.Add(1) > int64(r.t.Config.MaxCrops) {
			r.crops.Add(-1)
			return nil, nil, fmt.Errorf("the crop limit for this document is reached; use originals or finish")
		}
		cropped := false
		defer func() {
			if !cropped {
				r.crops.Add(-1)
			}
		}()
		var src image.Image
		var page int
		var err error
		if args.AssetID != "" {
			a := r.assets[args.AssetID]
			if a == nil {
				return nil, nil, fmt.Errorf("no asset %q", args.AssetID)
			}
			page = a.page
			src, err = decodeImageFile(a.Path)
		} else {
			if err := checkPage(args.Page); err != nil {
				return nil, nil, err
			}
			page = args.Page
			if r.cropPage != page {
				r.cropSource, r.cropPage = nil, 0
				if r.cropSource, err = r.render(ctx, page, cropSize); err == nil {
					r.cropPage = page
				}
			}
			src = r.cropSource
		}
		if err != nil {
			return nil, nil, err
		}
		box := [4]float64(args.BBox)
		img, err := crop(src, box)
		if err != nil {
			return nil, nil, err
		}
		data, err := encodePNG(img)
		if err != nil {
			return nil, nil, err
		}
		id, seq := r.newID("crop")
		path := filepath.Join(r.dir, id+".png")
		if err := os.WriteFile(path, data, 0o600); err != nil {
			return nil, nil, err
		}
		b := img.Bounds()
		r.assets[id] = &Asset{ID: id, seq: seq, page: page, Path: path, ContentType: "image/png", width: b.Dx(), height: b.Dy(), kind: "crop"}
		cropped = true
		part, err := jpegPart(fit(img, 1600, 1600))
		return map[string]any{"asset_id": id, "kind": "crop", "bbox_normalized": box, "size": []int{b.Dx(), b.Dy()}}, &part, err
	}
	return nil, nil, fmt.Errorf("no tool %q", call.Function.Name)
}
