package transcribe

import (
	"bytes"
	"cmp"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"image"
	"log/slog"
	"math"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync/atomic"

	"github.com/connor-kress/mind-graph/runner/internal/openrouter"
	"github.com/connor-kress/mind-graph/runner/internal/pdf"
)

// Each range of a PDF's pages is one conversation with the model. It sees the
// native PDF, every original bitmap and page previews, and uses local tools to
// inspect, render and crop, getting real pixels back, until it returns the
// range's Markdown.

// Bitmaps smaller than this on either side are taken to be decoration.
const minAssetSide = 25

// Longer sides, in pixels, of page renders: for previews, closer looks, and crops.
const (
	previewSize = 800
	inspectSize = 1400
	cropSize    = 2400
)

// pagesRun is one conversation about a range of pages.
type pagesRun struct {
	t     *PDF
	pdf   string // The range as its own PDF, with pages counted from 1.
	pages int
	dir   string
	ids   *atomic.Int64
	// The originals found and crops made, by ID.
	assets map[string]*Asset
	// Crops so far, across the document, and in this conversation.
	crops   *atomic.Int64
	cropped int64
	// The last page rendered to crop from, by page.
	cropPage   int
	cropSource image.Image
}

// run returns the range's Markdown, with ## Page N sections counted within the range.
func (r *pagesRun) run(ctx context.Context, source string, first, last int) (string, error) {
	t := r.t
	if err := os.MkdirAll(r.dir, 0o700); err != nil {
		return "", err
	}
	r.pdf = filepath.Join(r.dir, "pages.pdf")
	if err := t.Tool.Split(ctx, source, first, last, r.pdf); err != nil {
		return "", err
	}
	pdfData, err := os.ReadFile(r.pdf)
	if err != nil {
		return "", err
	}
	if err := r.findOriginals(ctx); err != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		// The model can still crop figures from the pages.
		slog.Warn("couldn't extract the original images", "pages", fmt.Sprintf("%d-%d", first, last), "error", err)
		clear(r.assets)
	}
	// Before the inventory, which leaves out originals that can't be shown.
	assetSheets := r.assetSheets()
	content := []openrouter.Part{
		openrouter.TextPart(t.Prompts.PDF + "\n\nInventory:\n" + r.inventory()),
		openrouter.PDFPart(fmt.Sprintf("pages-%d-%d.pdf", first, last), pdfData),
	}
	for _, s := range assetSheets {
		content = append(content, openrouter.TextPart("Labeled local asset contact sheet. Use the visible ID to match actual content."), s)
	}
	pageSheets, missing := r.pageSheets(ctx)
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	for _, s := range pageSheets {
		content = append(content, openrouter.TextPart("Actual full-page previews, labeled by physical PDF page. The native PDF remains the transcription source."), s)
	}
	if len(missing) > 0 {
		content = append(content, openrouter.TextPart(fmt.Sprintf("Previews of pages %v couldn't be made; rendering or cropping them may fail too.", missing)))
	}
	messages := []openrouter.Message{{Role: "user", Content: content}}

	// The latest answer with every page, kept while the model fixes its image links.
	var draft string
	turns := t.Config.Turns
	for turn := range turns {
		remaining := turns - turn
		budget := fmt.Sprintf("You have %d response turns remaining, including the final Markdown.", remaining)
		var tools json.RawMessage = t.Prompts.Tools
		if remaining == 1 {
			budget += " This is the final turn. Return the complete Markdown now."
			tools = nil
		}
		messages = append(messages, openrouter.Message{Role: "user", Content: budget})
		c, err := t.AI.Complete(ctx, openrouter.Request{MaxTokens: textMaxTokens, PDF: true, Messages: messages, Tools: tools})
		if err != nil {
			if draft != "" {
				slog.Warn("keeping an answer with broken image links", "error", err)
				return draft, nil
			}
			return "", err
		}
		msg := c.Message
		messages = append(messages, openrouter.Message{Role: "assistant", Content: msg.Content, ToolCalls: msg.ToolCalls})
		if len(msg.ToolCalls) == 0 {
			md := strings.TrimSpace(unfence(msg.Text()))
			err := checkPages(md, r.pages)
			if err == nil {
				if err = r.checkLinks(md); err == nil {
					return md, nil
				}
				draft = md
			}
			if remaining == 1 && draft == "" {
				return "", fmt.Errorf("incomplete transcription: %w", err)
			}
			messages = append(messages, openrouter.Message{Role: "user", Content: fmt.Sprintf(
				"That Markdown can't be used: %v. Return the complete Markdown, with each of the %d pages under its own ## Page N heading, in order.", err, r.pages)})
			continue
		}
		var previews []openrouter.Part
		for _, call := range msg.ToolCalls {
			meta, pixels := r.execute(ctx, call)
			metaJSON, _ := json.Marshal(meta)
			messages = append(messages, openrouter.Message{Role: "tool", ToolCallID: call.ID, Content: string(metaJSON)})
			if len(pixels) > 0 {
				previews = append(previews, openrouter.TextPart("Actual local pixels for tool result "+call.ID+" "+string(metaJSON)))
				previews = append(previews, pixels...)
			}
		}
		if previews != nil {
			previews = append(previews, openrouter.TextPart("Inspect the returned pixels."))
			messages = append(messages, openrouter.Message{Role: "user", Content: previews})
		}
	}
	// Links to images that still don't exist only lose those images.
	if draft != "" {
		return draft, nil
	}
	return "", fmt.Errorf("no Markdown after %d turns", turns)
}

// checkLinks reports links to images that don't exist, such as crops the model
// planned and never made.
func (r *pagesRun) checkLinks(md string) error {
	var unknown []string
	linkAssets(md, func(id string) bool {
		if r.assets[id] != nil {
			return true
		}
		unknown = append(unknown, id)
		return false
	})
	if len(unknown) > 0 {
		return fmt.Errorf("it links to images that don't exist, %v. Crop those figures and use the IDs returned if you still can; otherwise link the closest original or remove the link", unknown)
	}
	return nil
}

func (r *pagesRun) list() []*Asset {
	var out []*Asset
	for _, a := range r.assets {
		out = append(out, a)
	}
	return out
}

// newID numbers assets across the document, since its ranges' Markdown is joined.
func (r *pagesRun) newID(prefix string) (string, int64) {
	n := r.ids.Add(1)
	return fmt.Sprintf("%s%d", prefix, n), n
}

// findOriginals extracts the range's bitmaps. One drawn on several pages, such as a logo, is one asset.
func (r *pagesRun) findOriginals(ctx context.Context) error {
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
			slog.Warn("leaving out an image that can't be read", "page", p.Page, "error", err)
			continue
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
func (r *pagesRun) inventory() string {
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
func (r *pagesRun) sorted() []*Asset {
	out := r.list()
	slices.SortFunc(out, func(a, b *Asset) int {
		return cmp.Or(cmp.Compare(a.page, b.page), cmp.Compare(a.seq, b.seq))
	})
	return out
}

// assetSheets shows the originals six to a sheet, leaving out any that can't be decoded.
func (r *pagesRun) assetSheets() []openrouter.Part {
	var tiles []tile
	for _, a := range r.sorted() {
		img, err := decodeImageFile(a.Path)
		if err != nil {
			slog.Warn("leaving out an image that can't be decoded", "asset", a.ID, "error", err)
			delete(r.assets, a.ID)
			continue
		}
		// Only the thumbnail is kept, not the decoded original.
		tiles = append(tiles, tile{fit(img, 480, 300), []string{a.ID, fmt.Sprintf("page %d | %dx%d | %s", a.page, a.width, a.height, a.kind)}})
	}
	var parts []openrouter.Part
	for start := 0; start < len(tiles); start += 6 {
		part, err := jpegPart(sheet(tiles[start:min(start+6, len(tiles))], 2, 500, 340))
		if err != nil {
			slog.Warn("couldn't make a contact sheet", "error", err)
			continue
		}
		parts = append(parts, part)
	}
	return parts
}

// pageSheets previews every page, four to a sheet, two to a row, each labeled
// with its number. It returns the pages it couldn't render.
func (r *pagesRun) pageSheets(ctx context.Context) ([]openrouter.Part, []int) {
	var tiles []tile
	var missing []int
	for n := 1; n <= r.pages && ctx.Err() == nil; n++ {
		img, err := r.render(ctx, n, previewSize)
		if err != nil {
			slog.Warn("couldn't preview a page", "page", n, "error", err)
			missing = append(missing, n)
			continue
		}
		tiles = append(tiles, tile{img, []string{fmt.Sprintf("PHYSICAL PDF PAGE %d", n)}})
	}
	var parts []openrouter.Part
	for start := 0; start < len(tiles); start += 4 {
		part, err := jpegPart(sheet(tiles[start:min(start+4, len(tiles))], 2, 600, 500))
		if err != nil {
			slog.Warn("couldn't make a contact sheet", "error", err)
			continue
		}
		parts = append(parts, part)
	}
	return parts, missing
}

func (r *pagesRun) render(ctx context.Context, page, size int) (image.Image, error) {
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
func (r *pagesRun) execute(ctx context.Context, call openrouter.ToolCall) (map[string]any, []openrouter.Part) {
	meta, pixels, err := r.tool(ctx, call)
	if err != nil {
		return map[string]any{"error": err.Error()}, nil
	}
	return meta, pixels
}

func (r *pagesRun) tool(ctx context.Context, call openrouter.ToolCall) (map[string]any, []openrouter.Part, error) {
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
		return map[string]any{"asset_id": a.ID, "kind": a.kind, "size": []int{a.width, a.height}}, []openrouter.Part{part}, err

	case "render_pages":
		if len(args.Pages) < 1 || len(args.Pages) > 8 {
			return nil, nil, fmt.Errorf("render 1 to 8 pages at a time")
		}
		for _, n := range args.Pages {
			if err := checkPage(n); err != nil {
				return nil, nil, err
			}
		}
		// Each page is its own image, so it's seen at the larger size.
		var parts []openrouter.Part
		for _, n := range args.Pages {
			img, err := r.render(ctx, n, inspectSize)
			if err != nil {
				return nil, nil, err
			}
			part, err := jpegPart(img)
			if err != nil {
				return nil, nil, err
			}
			parts = append(parts, openrouter.TextPart(fmt.Sprintf("PHYSICAL PDF PAGE %d", n)), part)
		}
		return map[string]any{"pages": args.Pages, "kind": "page_renders"}, parts, nil

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
		r.cropped++
		part, err := jpegPart(fit(img, 1600, 1600))
		return map[string]any{"asset_id": id, "kind": "crop", "bbox_normalized": box, "size": []int{b.Dx(), b.Dy()}}, []openrouter.Part{part}, err
	}
	return nil, nil, fmt.Errorf("no tool %q", call.Function.Name)
}
