package transcribe

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"io"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/connor-kress/mind-graph/runner/internal/config"
	"github.com/connor-kress/mind-graph/runner/internal/openrouter"
	"github.com/connor-kress/mind-graph/runner/internal/pdf"
)

// fakePDF is a PDF of some number of pages whose ranges are named by their pages.
type fakePDF struct {
	pages int
	// The originals Images finds, if set.
	images func(dir string) ([]pdf.PlacedImage, error)
	// A page that can't be rendered, if set.
	broken int
	// The pixels in the largest bitmap.
	largest int
}

func (f fakePDF) PageCount(context.Context, string) (int, error) { return f.pages, nil }
func (f fakePDF) LargestImage(context.Context, string) (int, error) {
	return f.largest, nil
}
func (regionRecorder) LargestImage(context.Context, string) (int, error) { return 0, nil }
func (fakePDF) Split(_ context.Context, _ string, first, last int, out string) error {
	return os.WriteFile(out, fmt.Appendf(nil, "%d-%d", first, last), 0o600)
}

// Render draws a page in a shade of gray that tells its number.
func (f fakePDF) Render(_ context.Context, _ string, page, size int, out string) error {
	if page == f.broken {
		return fmt.Errorf("can't render page %d", page)
	}
	img := image.NewGray(image.Rect(0, 0, size, size))
	for i := range img.Pix {
		img.Pix[i] = byte(page * 10)
	}
	data, err := encodePNG(img)
	if err != nil {
		return err
	}
	return os.WriteFile(out, data, 0o600)
}

// RenderRegion draws part of a page as Render does.
func (f fakePDF) RenderRegion(_ context.Context, _ string, page, _ int, region image.Rectangle, out string) error {
	if page == f.broken {
		return fmt.Errorf("can't render page %d", page)
	}
	img := image.NewGray(image.Rect(0, 0, region.Dx(), region.Dy()))
	for i := range img.Pix {
		img.Pix[i] = byte(page * 10)
	}
	data, err := encodePNG(img)
	if err != nil {
		return err
	}
	return os.WriteFile(out, data, 0o600)
}

func (f fakePDF) Images(_ context.Context, _ string, _, _ int, dir string) ([]pdf.PlacedImage, error) {
	if f.images == nil {
		return nil, nil
	}
	return f.images(dir)
}

// fakeModel answers chat completions with respond, given each request's file name or text.
func fakeModel(t *testing.T, respond func(ctx context.Context, input string) (content, finish string, status int)) (*openrouter.Client, *atomic.Int64) {
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var req struct {
			Messages []struct {
				Content json.RawMessage `json:"content"`
			} `json:"messages"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		input := string(req.Messages[0].Content)
		var parts []openrouter.Part
		if json.Unmarshal(req.Messages[0].Content, &parts) == nil {
			for _, p := range parts {
				if p.File != nil {
					input = p.File.Filename
				}
			}
		}
		content, finish, status := respond(r.Context(), input)
		rw.WriteHeader(status)
		json.NewEncoder(rw).Encode(map[string]any{"choices": []any{map[string]any{
			"message":       map[string]any{"role": "assistant", "content": content},
			"finish_reason": finish,
		}}})
	}))
	t.Cleanup(server.Close)
	return &openrouter.Client{URL: server.URL, HTTP: server.Client()}, &calls
}

func testPDF(ai *openrouter.Client, pages int) *PDF {
	prompts, err := LoadPrompts("")
	if err != nil {
		panic(err)
	}
	return &PDF{
		Config:  config.Config{MaxPages: 75, RangePages: 4, Turns: 3, MaxCrops: 12, Parallel: 2},
		AI:      ai,
		Tool:    fakePDF{pages: pages},
		Prompts: prompts,
	}
}

func TestARangeThatsCutOffIsSplit(t *testing.T) {
	ai, _ := fakeModel(t, func(_ context.Context, input string) (string, string, int) {
		if input == "pages-1-4.pdf" {
			return "## Page 1\n\nPartial", "length", 200
		}
		var first, last int
		fmt.Sscanf(input, "pages-%d-%d.pdf", &first, &last)
		var b strings.Builder
		for p := 1; p <= last-first+1; p++ {
			fmt.Fprintf(&b, "## Page %d\n\nText %d\n\n", p, first+p-1)
		}
		return b.String(), "stop", 200
	})
	result, err := testPDF(ai, 6).Transcribe(context.Background(), "a.pdf", []byte("%PDF"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for p := 1; p <= 6; p++ {
		if !strings.Contains(result.Markdown, fmt.Sprintf("## Page %d\n\nText %d", p, p)) {
			t.Errorf("missing page %d in %q", p, result.Markdown)
		}
	}
	if strings.Contains(result.Markdown, "Partial") {
		t.Error("the cut-off response should be replaced")
	}
}

func TestOneFailedRangeStopsTheOthers(t *testing.T) {
	ai, _ := fakeModel(t, func(ctx context.Context, input string) (string, string, int) {
		if input == "pages-1-4.pdf" {
			return "", "", http.StatusBadRequest
		}
		// The others would never finish, unless they're cancelled.
		<-ctx.Done()
		return "", "", http.StatusServiceUnavailable
	})
	tr := testPDF(ai, 12)
	tr.Config.Parallel = 3
	done := make(chan error)
	go func() {
		_, err := tr.Transcribe(context.Background(), "a.pdf", []byte("%PDF"), t.TempDir())
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "400") {
			t.Errorf("err = %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("the other ranges kept going")
	}
}

func TestOfficeRejectsAnEmptyResponse(t *testing.T) {
	ai, _ := fakeModel(t, func(context.Context, string) (string, string, int) { return "", "stop", 200 })
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	f, _ := z.Create("word/document.xml")
	io.WriteString(f, `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>`)
	z.Close()
	word := &Word{Config: config.Config{RangePages: 25, Parallel: 2}, AI: ai, Prompt: "Document."}
	_, err := word.Transcribe(context.Background(), "a.docx", b.Bytes(), t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "empty") {
		t.Errorf("err = %v", err)
	}
}

func TestPDFOverThePageLimit(t *testing.T) {
	ai, calls := fakeModel(t, func(context.Context, string) (string, string, int) { return "", "stop", 200 })
	_, err := testPDF(ai, 76).Transcribe(context.Background(), "a.pdf", []byte("%PDF"), t.TempDir())
	if _, ok := err.(UserError); !ok || calls.Load() != 0 {
		t.Errorf("err = %v after %d requests", err, calls.Load())
	}
}

func TestOfficeSplitsOneUnitWhoseResponseIsCutOff(t *testing.T) {
	long := strings.Repeat("word ", 1000)
	ai, calls := fakeModel(t, func(_ context.Context, input string) (string, string, int) {
		if strings.Count(input, "word") > 600 {
			return "partial", "length", 200
		}
		return "Formatted", "stop", 200
	})
	result, err := formatText(context.Background(), ai, "Document.", []string{long})
	if err != nil || result != "Formatted\n\nFormatted" || calls.Load() != 3 {
		t.Errorf("formatText = %q, %v after %d requests", result, err, calls.Load())
	}
}

func TestByKindRefusesOtherKinds(t *testing.T) {
	_, err := ByKind{"pdf": testPDF(nil, 1)}.Transcribe(context.Background(), "a.key", "key", nil, t.TempDir())
	if err != UserError("KEY files can't be transcribed.") {
		t.Errorf("err = %v", err)
	}
}

func TestShrinkAsset(t *testing.T) {
	dir := t.TempDir()
	// Noise doesn't compress, so this PNG is over the upload limit.
	img := image.NewRGBA(image.Rect(0, 0, 2000, 2000))
	r := rand.New(rand.NewPCG(1, 2))
	for i := range img.Pix {
		img.Pix[i] = byte(r.Uint32())
	}
	data, _ := encodePNG(img)
	if len(data) <= maxAssetBytes {
		t.Fatalf("fixture is only %d bytes", len(data))
	}
	path := filepath.Join(dir, "big.png")
	os.WriteFile(path, data, 0o600)
	a := &Asset{ID: "img1", Path: path, ContentType: "image/png"}
	if err := shrinkAsset(context.Background(), a, dir); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(a.Path)
	if a.ContentType != "image/jpeg" || info.Size() > maxAssetBytes {
		t.Errorf("shrunk to %s of %d bytes", a.ContentType, info.Size())
	}
}

func TestCrop(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 200, 100))
	img.Set(150, 75, color.Black)
	out, err := crop(img, [4]float64{500, 500, 1000, 1000})
	if err != nil {
		t.Fatal(err)
	}
	if b := out.Bounds(); b.Dx() != 100 || b.Dy() != 50 {
		t.Errorf("crop size = %v", b)
	}
	if _, _, _, a := out.At(50, 25).RGBA(); a == 0 {
		t.Error("crop should keep the pixels at its offset")
	}
	for _, box := range [][4]float64{{0, 0, 50, 0}, {500, 0, 400, 100}, {0, 0, 1001, 10}} {
		if _, err := crop(img, box); err == nil {
			t.Errorf("crop(%v) should fail", box)
		}
	}
}

// fakeRequest is what scriptedModel sees of each request.
type fakeRequest struct {
	Messages []struct {
		Role       string          `json:"role"`
		Content    json.RawMessage `json:"content"`
		ToolCallID string          `json:"tool_call_id"`
	} `json:"messages"`
	Tools json.RawMessage `json:"tools"`
}

// file is the name of the PDF the request's first message includes.
func (r fakeRequest) file() string {
	var parts []openrouter.Part
	json.Unmarshal(r.Messages[0].Content, &parts)
	for _, p := range parts {
		if p.File != nil {
			return p.File.Filename
		}
	}
	return ""
}

// last is the text of the request's last messages, whatever their form, before the turn budget.
func (r fakeRequest) last() string { return string(r.Messages[len(r.Messages)-2].Content) }

// images decodes the images in a message's content, in order.
func (fakeRequest) images(t *testing.T, content json.RawMessage) []image.Image {
	t.Helper()
	var parts []openrouter.Part
	json.Unmarshal(content, &parts)
	var out []image.Image
	for _, p := range parts {
		if p.ImageURL == nil {
			continue
		}
		_, data, _ := strings.Cut(p.ImageURL.URL, ";base64,")
		raw, err := base64.StdEncoding.DecodeString(data)
		if err != nil {
			t.Fatal(err)
		}
		img, _, err := image.Decode(bytes.NewReader(raw))
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, img)
	}
	return out
}

// hasGrid reports whether a gray page has withGrid's blue lines on it.
func hasGrid(img image.Image) bool {
	b := img.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			r, _, bl, _ := img.At(x, y).RGBA()
			if bl>>8 > r>>8+20 {
				return true
			}
		}
	}
	return false
}

// byte10 is the gray fakePDF draws page n in.
func byte10(n int) uint32 { return uint32(n * 10) }

type fakeReply struct {
	content string
	calls   []openrouter.ToolCall
	finish  string
}

func toolCall(id, name, args string) openrouter.ToolCall {
	c := openrouter.ToolCall{ID: id, Type: "function"}
	c.Function.Name, c.Function.Arguments = name, args
	return c
}

// scriptedModel answers each request with respond, which can make tool calls.
func scriptedModel(t *testing.T, respond func(r fakeRequest) fakeReply) *openrouter.Client {
	var mu sync.Mutex
	server := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		var req fakeRequest
		json.NewDecoder(r.Body).Decode(&req)
		mu.Lock()
		reply := respond(req)
		mu.Unlock()
		if reply.finish == "" {
			reply.finish = "stop"
		}
		msg := map[string]any{"role": "assistant", "content": reply.content}
		if reply.calls != nil {
			msg["tool_calls"], reply.finish = reply.calls, "tool_calls"
		}
		json.NewEncoder(rw).Encode(map[string]any{"choices": []any{map[string]any{"message": msg, "finish_reason": reply.finish}}})
	}))
	t.Cleanup(server.Close)
	return &openrouter.Client{URL: server.URL, HTTP: server.Client()}
}

func TestTheModelCanUseToolsBeforeAnswering(t *testing.T) {
	turn := 0
	ai := scriptedModel(t, func(r fakeRequest) fakeReply {
		turn++
		switch turn {
		case 1:
			if r.Tools == nil {
				t.Error("tools should be offered before the last turn")
			}
			for _, sheet := range r.images(t, r.Messages[0].Content) {
				if !hasGrid(sheet) {
					t.Error("a preview has no grid")
				}
			}
			return fakeReply{calls: []openrouter.ToolCall{
				toolCall("c1", "crop", `{"regions":[{"page":1,"bbox":[0,0,500,500]}]}`),
				toolCall("c2", "render_pages", `{"pages":[1,2]}`),
			}}
		default:
			if r.Tools != nil {
				t.Error("the last turn shouldn't offer tools")
			}
			// Tool results, then their pixels: a crop, then each rendered page at the inspect size.
			images := r.images(t, r.Messages[len(r.Messages)-2].Content)
			if len(images) != 3 {
				t.Fatalf("%d images in the feedback", len(images))
			}
			if hasGrid(images[0]) {
				t.Error("a crop has the grid")
			}
			for i, img := range images[1:] {
				gray, _, _, _ := img.At(0, 0).RGBA()
				if img.Bounds().Dx() != inspectSize || gray>>8 < byte10(i+1)-3 || gray>>8 > byte10(i+1)+3 || !hasGrid(img) {
					t.Errorf("render %d is %v, gray %d, grid %v", i+1, img.Bounds(), gray>>8, hasGrid(img))
				}
			}
			if !strings.Contains(r.last(), "PHYSICAL PDF PAGE 2") {
				t.Error("each render should be labeled with its page")
			}
			return fakeReply{content: "## Page 1\n\n![A diagram](asset:crop1)\n\n## Page 2\n\nText."}
		}
	})
	tr := testPDF(ai, 2)
	result, err := tr.Transcribe(context.Background(), "a.pdf", []byte("%PDF"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Assets) != 1 || result.Assets[0].ID != "crop1" || !strings.Contains(result.Markdown, "](asset:crop1)") {
		t.Errorf("result = %q with %d assets", result.Markdown, len(result.Assets))
	}
}

func TestAnIncompleteAnswerIsSentBack(t *testing.T) {
	turn := 0
	ai := scriptedModel(t, func(r fakeRequest) fakeReply {
		turn++
		if turn == 1 {
			return fakeReply{content: "## Page 1\n\nOnly the first."}
		}
		if !strings.Contains(r.last(), "pages [2] are missing") {
			t.Errorf("last message = %s", r.last())
		}
		return fakeReply{content: "## Page 1\n\nOne.\n\n## Page 2\n\nTwo."}
	})
	result, err := testPDF(ai, 2).Transcribe(context.Background(), "a.pdf", []byte("%PDF"), t.TempDir())
	if err != nil || !strings.Contains(result.Markdown, "Two.") {
		t.Errorf("result = %v, %v", result, err)
	}
}

func TestLinksToMissingImagesAreSentBack(t *testing.T) {
	turn := 0
	ai := scriptedModel(t, func(r fakeRequest) fakeReply {
		turn++
		switch turn {
		case 1:
			return fakeReply{content: "## Page 1\n\n![Planned](asset:crop??) ![Invented](crop9)"}
		case 2:
			if !strings.Contains(r.last(), "[crop?? crop9]") || r.Tools == nil {
				t.Errorf("last message = %s, tools = %s", r.last(), r.Tools)
			}
			return fakeReply{calls: []openrouter.ToolCall{toolCall("c1", "crop", `{"regions":[{"page":1,"bbox":[0,0,500,500]}]}`)}}
		default:
			return fakeReply{content: "## Page 1\n\n![A diagram](asset:crop1)"}
		}
	})
	tr := testPDF(ai, 1)
	tr.Config.Turns = 4
	result, err := tr.Transcribe(context.Background(), "a.pdf", []byte("%PDF"), t.TempDir())
	if err != nil || len(result.Assets) != 1 || !strings.Contains(result.Markdown, "asset:crop1") {
		t.Errorf("result = %v, %v", result, err)
	}
}

func TestAFailedImageFixKeepsTheAnswer(t *testing.T) {
	const draft = "## Page 1\n\n![Planned](crop9)\n\nOne."
	for name, test := range map[string]struct {
		fix  fakeReply
		want string
	}{
		"still broken":  {fakeReply{content: "## Page 1\n\n![Planned](crop9)\n\nNewer."}, "Newer."},
		"missing pages": {fakeReply{content: "No headings."}, "One."},
		"cut off":       {fakeReply{content: "## Page", finish: "length"}, "One."},
	} {
		t.Run(name, func(t *testing.T) {
			turn := 0
			ai := scriptedModel(t, func(fakeRequest) fakeReply {
				turn++
				if turn == 1 {
					return fakeReply{content: draft}
				}
				return test.fix
			})
			result, err := testPDF(ai, 1).Transcribe(context.Background(), "a.pdf", []byte("%PDF"), t.TempDir())
			if err != nil || strings.Contains(result.Markdown, "crop9") || !strings.Contains(result.Markdown, test.want) {
				t.Errorf("turns = %d, result = %v, %v", turn, result, err)
			}
		})
	}
}

func TestCancellingDuringAnImageFixDoesntKeepTheAnswer(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	turn := 0
	ai := scriptedModel(t, func(fakeRequest) fakeReply {
		turn++
		if turn == 2 {
			cancel()
		}
		return fakeReply{content: "## Page 1\n\n![Planned](crop9)"}
	})
	if result, err := testPDF(ai, 1).Transcribe(ctx, "a.pdf", []byte("%PDF"), t.TempDir()); !errors.Is(err, context.Canceled) {
		t.Errorf("result = %v, err = %v", result, err)
	}
}

func TestOneCallCanCropAndInspectSeveral(t *testing.T) {
	turn := 0
	ai := scriptedModel(t, func(r fakeRequest) fakeReply {
		turn++
		switch turn {
		case 1:
			return fakeReply{calls: []openrouter.ToolCall{toolCall("c1", "crop", `{"regions":[{"page":1,"bbox":[0,0,500,500]},{"page":9,"bbox":[0,0,1,1]},{"page":2,"bbox":[0,0,500,500]}]}`)}}
		case 2:
			images := r.images(t, r.Messages[len(r.Messages)-2].Content)
			if len(images) != 2 || !strings.Contains(r.last(), "page 9 doesn't exist") {
				t.Errorf("%d images, and the bad region wasn't reported", len(images))
			}
			return fakeReply{calls: []openrouter.ToolCall{toolCall("c2", "inspect_asset", `{"asset_ids":["crop1","crop2","nope"]}`)}}
		default:
			images := r.images(t, r.Messages[len(r.Messages)-2].Content)
			if len(images) != 2 || !strings.Contains(r.last(), "no asset") {
				t.Errorf("%d images, and the bad ID wasn't reported", len(images))
			}
			return fakeReply{content: "## Page 1\n\n![A](asset:crop1)\n\n## Page 2\n\n![B](asset:crop2)"}
		}
	})
	tr := testPDF(ai, 2)
	tr.Config.Turns = 4
	result, err := tr.Transcribe(context.Background(), "a.pdf", []byte("%PDF"), t.TempDir())
	if err != nil || len(result.Assets) != 2 {
		t.Fatalf("result = %v, %v", result, err)
	}
	// Crops come from a clean render, without the previews' grid.
	img, err := decodeImageFile(result.Assets[0].Path)
	if err != nil {
		t.Fatal(err)
	}
	b := img.Bounds()
	want := img.At(b.Min.X, b.Min.Y)
	for x := b.Min.X; x < b.Max.X; x++ {
		if img.At(x, b.Min.Y+b.Dy()/2) != want {
			t.Fatalf("the crop isn't clean at x = %d", x)
		}
	}
}

func TestTheModelIsOnlyToldOfItsTurnsNearTheEndWhichHaveNoTools(t *testing.T) {
	remaining := regexp.MustCompile(`You have (\d+) response turns`)
	var told []string
	var tools []bool
	ai := scriptedModel(t, func(r fakeRequest) fakeReply {
		count := ""
		if m := remaining.FindSubmatch(r.Messages[len(r.Messages)-1].Content); m != nil {
			count = string(m[1])
		}
		told = append(told, count)
		tools = append(tools, r.Tools != nil)
		switch {
		case len(told) < 4:
			return fakeReply{calls: []openrouter.ToolCall{toolCall("c", "render_pages", `{"pages":[1]}`)}}
		case len(told) == 4:
			return fakeReply{content: "No headings."}
		}
		return fakeReply{content: "## Page 1\n\nOne."}
	})
	tr := testPDF(ai, 1)
	tr.Config.Turns = 5
	if _, err := tr.Transcribe(context.Background(), "a.pdf", []byte("%PDF"), t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(told, []string{"", "", "3", "2", "1"}) || !reflect.DeepEqual(tools, []bool{true, true, true, false, false}) {
		t.Errorf("told = %q, tools = %v", told, tools)
	}
}

func TestContactSheetsOfOriginals(t *testing.T) {
	dir := t.TempDir()
	r := &pagesRun{assets: map[string]*Asset{}}
	for i := range 3 {
		data, _ := encodePNG(image.NewGray(image.Rect(0, 0, 900, 700)))
		id := fmt.Sprintf("img%d", i+1)
		path := filepath.Join(dir, id+".png")
		os.WriteFile(path, data, 0o600)
		r.assets[id] = &Asset{ID: id, seq: int64(i), Path: path}
	}
	parts, _ := json.Marshal(r.assetSheets(context.Background()))
	sheets := fakeRequest{}.images(t, parts)
	if len(sheets) != 2 {
		t.Fatalf("%d sheets", len(sheets))
	}
	for _, s := range sheets {
		if s.Bounds().Dx() != 1640 || s.Bounds().Dy() != 650 {
			t.Errorf("a sheet is %v", s.Bounds())
		}
	}
}

func TestACropOfAnAssetNamesIt(t *testing.T) {
	dir := t.TempDir()
	data, _ := encodePNG(image.NewGray(image.Rect(0, 0, 100, 100)))
	path := filepath.Join(dir, "a.png")
	os.WriteFile(path, data, 0o600)
	var ids, crops atomic.Int64
	r := &pagesRun{t: testPDF(nil, 1), dir: dir, ids: &ids, crops: &crops, assets: map[string]*Asset{"img1": {ID: "img1", page: 1, Path: path}}}
	result, _, err := r.crop(context.Background(), region{AssetID: "img1", BBox: []float64{0, 0, 500, 500}})
	if err != nil || result["source"] != "img1" {
		t.Errorf("result = %v, %v", result, err)
	}
}

func TestComposedHints(t *testing.T) {
	var seq int64
	placed := func(id string, page int, box [4]float64) *Asset {
		seq++
		return &Asset{ID: id, seq: seq, page: page, placements: []placement{{page, box}}}
	}
	r := &pagesRun{pages: 4, assets: map[string]*Asset{
		"img1": placed("img1", 1, [4]float64{100, 100, 500, 500}),
		"img2": placed("img2", 1, [4]float64{200, 200, 400, 400}),
		"img3": placed("img3", 1, [4]float64{600, 600, 900, 900}),
		"img8": placed("img8", 1, [4]float64{650, 650, 800, 800}),
		// A page's background and what's drawn on it aren't a composed figure.
		"img4": placed("img4", 2, [4]float64{0, 0, 1000, 1000}),
		"img5": placed("img5", 2, [4]float64{100, 100, 400, 400}),
		// Barely touching isn't overlapping.
		"img6": placed("img6", 3, [4]float64{0, 0, 500, 500}),
		"img7": placed("img7", 3, [4]float64{490, 490, 900, 900}),
		// Drawn twice, with only its second placement over another.
		"img9":  {ID: "img9", seq: 100, page: 4, placements: []placement{{4, [4]float64{0, 0, 100, 100}}, {4, [4]float64{500, 500, 600, 600}}}},
		"img10": placed("img10", 4, [4]float64{500, 500, 700, 700}),
	}}
	got := r.composedHints()
	if !strings.Contains(got, "Page 1 draws img1, img2 over each other") || !strings.Contains(got, "Page 1 draws img3, img8 over each other") || !strings.Contains(got, "img10") || strings.Contains(got, "Page 2") || strings.Contains(got, "Page 3") {
		t.Errorf("hints = %q", got)
	}
}

func TestFit(t *testing.T) {
	// Half black and half white columns average to gray.
	stripes := image.NewGray(image.Rect(0, 0, 4, 4))
	for i := range stripes.Pix {
		if i%2 == 1 {
			stripes.Pix[i] = 255
		}
	}
	got := fit(stripes, 2, 2).(*image.RGBA)
	if got.Bounds().Dx() != 2 || got.RGBAAt(0, 0) != (color.RGBA{128, 128, 128, 255}) {
		t.Errorf("%v: %v", got.Bounds(), got.RGBAAt(0, 0))
	}
	// A fractional ratio covers every source pixel once, so white stays white.
	white := image.NewGray(image.Rect(0, 0, 7, 5))
	for i := range white.Pix {
		white.Pix[i] = 255
	}
	for _, p := range fit(white, 3, 3).(*image.RGBA).Pix {
		if p != 255 {
			t.Fatalf("white scaled to %d", p)
		}
	}
	// Transparency goes on white, an image isn't scaled up, and its origin doesn't matter.
	transparent := image.NewNRGBA(image.Rect(10, 20, 12, 22))
	got = fit(transparent, 100, 100).(*image.RGBA)
	if got.Bounds() != image.Rect(0, 0, 2, 2) || got.RGBAAt(1, 1) != (color.RGBA{255, 255, 255, 255}) {
		t.Errorf("%v: %v", got.Bounds(), got.RGBAAt(1, 1))
	}
	// Scaling takes little beyond the result, however large the source.
	large := image.NewRGBA(image.Rect(0, 0, 4000, 3000))
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	fit(large, 800, 600)
	runtime.ReadMemStats(&after)
	if used := after.TotalAlloc - before.TotalAlloc; used > 3<<20 {
		t.Errorf("used %d MB", used>>20)
	}
}

func TestACropRendersOnlyItsRegion(t *testing.T) {
	var regions []image.Rectangle
	r := &pagesRun{t: &PDF{Tool: regionRecorder{&regions}, Config: config.Config{MaxCrops: 10}}, pages: 1, dir: t.TempDir(),
		assets: map[string]*Asset{}, ids: &atomic.Int64{}, crops: &atomic.Int64{}}
	meta, _, err := r.crop(context.Background(), region{Page: 1, BBox: []float64{100, 200, 500, 800}})
	if err != nil {
		t.Fatal(err)
	}
	// The page is twice as wide as it's tall, at the crop size.
	want := image.Rect(cropSize/10, cropSize/10, cropSize/2, cropSize*2/5)
	if len(regions) != 1 || regions[0] != want {
		t.Errorf("regions = %v, want %v", regions, want)
	}
	if size := meta["size"].([]int); size[0] != want.Dx() || size[1] != want.Dy() {
		t.Errorf("size = %v", size)
	}
}

func TestACropsBoxIsCheckedAgainstTheRealPage(t *testing.T) {
	var regions []image.Rectangle
	dir := t.TempDir()
	r := &pagesRun{t: &PDF{Tool: regionRecorder{&regions}, Config: config.Config{MaxCrops: 10}}, pages: 1, dir: dir,
		assets: map[string]*Asset{}, ids: &atomic.Int64{}, crops: &atomic.Int64{}}
	// Under one unit of 1000, but a pixel wide at the crop size.
	if _, _, err := r.crop(context.Background(), region{Page: 1, BBox: []float64{0, 0, 0.4, 1000}}); err != nil {
		t.Error(err)
	}
	// Empty even so; it doesn't use up the limit or leave a file.
	if _, _, err := r.crop(context.Background(), region{Page: 1, BBox: []float64{0, 0, 0.1, 1000}}); err == nil {
		t.Error("expected an error")
	}
	if r.crops.Load() != 1 {
		t.Errorf("%d crops counted", r.crops.Load())
	}
	files, _ := filepath.Glob(filepath.Join(dir, "crop*"))
	if len(files) != 1 {
		t.Errorf("files: %v", files)
	}
}

// failingOnce is a tool whose first render leaves a partial file and fails.
type failingOnce struct {
	regionRecorder
	failed *bool
}

func (f failingOnce) Render(ctx context.Context, pdf string, page, size int, out string) error {
	if !*f.failed {
		*f.failed = true
		os.WriteFile(out, []byte("\x89PNG"), 0o600)
		return fmt.Errorf("the disk is full")
	}
	return f.regionRecorder.Render(ctx, pdf, page, size, out)
}

func TestAFailedRenderDoesntBreakLaterCropsOfThePage(t *testing.T) {
	var regions []image.Rectangle
	var failed bool
	r := &pagesRun{t: &PDF{Tool: failingOnce{regionRecorder{&regions}, &failed}, Config: config.Config{MaxCrops: 10}}, pages: 1, dir: t.TempDir(),
		assets: map[string]*Asset{}, ids: &atomic.Int64{}, crops: &atomic.Int64{}}
	box := region{Page: 1, BBox: []float64{0, 0, 500, 500}}
	if _, _, err := r.crop(context.Background(), box); err == nil {
		t.Fatal("expected the first crop to fail")
	}
	if _, _, err := r.crop(context.Background(), box); err != nil {
		t.Errorf("the second crop failed: %v", err)
	}
}

// regionRecorder is a tool for a page twice as wide as it's tall, recording the regions it renders.
type regionRecorder struct{ regions *[]image.Rectangle }

func (regionRecorder) PageCount(context.Context, string) (int, error)        { return 1, nil }
func (regionRecorder) Split(context.Context, string, int, int, string) error { return nil }
func (regionRecorder) Images(context.Context, string, int, int, string) ([]pdf.PlacedImage, error) {
	return nil, nil
}
func (regionRecorder) Render(_ context.Context, _ string, _, size int, out string) error {
	data, err := encodePNG(image.NewGray(image.Rect(0, 0, size, size/2)))
	if err != nil {
		return err
	}
	return os.WriteFile(out, data, 0o600)
}
func (r regionRecorder) RenderRegion(_ context.Context, _ string, _, _ int, region image.Rectangle, out string) error {
	*r.regions = append(*r.regions, region)
	data, err := encodePNG(image.NewGray(image.Rect(0, 0, region.Dx(), region.Dy())))
	if err != nil {
		return err
	}
	return os.WriteFile(out, data, 0o600)
}

func TestWithGrid(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 1000, 1000))
	for i := range src.Pix {
		src.Pix[i] = 255
	}
	got := withGrid(src)
	if got.At(500, 700) == src.At(500, 700) || got.At(550, 750) != src.At(550, 750) {
		t.Errorf("at the 500 line: %v; between lines: %v", got.At(500, 700), got.At(550, 750))
	}
	if src.At(500, 700) != (color.RGBA{255, 255, 255, 255}) {
		t.Error("withGrid drew on its source")
	}
}

func TestCropsOfACutOffAttemptAreRefunded(t *testing.T) {
	ai := scriptedModel(t, func(r fakeRequest) fakeReply {
		cropped := strings.Contains(r.last(), "tool_call_id") || len(r.Messages) > 2
		switch {
		case r.file() == "pages-2-2.pdf":
			return fakeReply{content: "## Page 1\n\nTwo."}
		case !cropped:
			return fakeReply{calls: []openrouter.ToolCall{toolCall("c", "crop", `{"regions":[{"page":1,"bbox":[0,0,500,500]}]}`)}}
		case r.file() == "pages-1-2.pdf":
			return fakeReply{content: "## Page 1\n\nPartial", finish: "length"}
		case strings.Contains(r.last(), "crop limit"):
			t.Error("the abandoned attempt's crop should be refunded")
		}
		return fakeReply{content: "## Page 1\n\n![A](asset:crop2)"}
	})
	tr := testPDF(ai, 2)
	tr.Config.MaxCrops, tr.Config.Turns = 1, 3
	result, err := tr.Transcribe(context.Background(), "a.pdf", []byte("%PDF"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if want := "## Page 1\n\n![A](asset:crop2)\n\n## Page 2\n\nTwo.\n"; result.Markdown != want || len(result.Assets) != 1 {
		t.Errorf("result = %q with %d assets", result.Markdown, len(result.Assets))
	}
}

func TestCheckPages(t *testing.T) {
	for md, ok := range map[string]bool{
		"## Page 1\n\nA\n\n## Page 2\n\nB":                   true,
		"## Page 1\n\nA":                                     false,
		"## Page 2\n\nB\n\n## Page 1\n\nA":                   false,
		"## Page 1\n\nA\n\n## Page 1\n\nA\n\n## Page 2\n\nB": false,
		"## Page 1\n\nA\n\n## Page 2\n\nB\n\n## Page 3\n\nC": false,
	} {
		if err := checkPages(md, 2); (err == nil) != ok {
			t.Errorf("checkPages(%q) = %v", md, err)
		}
	}
}

func TestAnIncompleteLastAnswerFails(t *testing.T) {
	ai := scriptedModel(t, func(fakeRequest) fakeReply { return fakeReply{content: "## Page 1\n\nOnly the first."} })
	_, err := testPDF(ai, 2).Transcribe(context.Background(), "a.pdf", []byte("%PDF"), t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "incomplete") {
		t.Errorf("err = %v", err)
	}
}

func TestFailuresPreparingImagesArentFatal(t *testing.T) {
	square := func(dir, name string, shade byte) pdf.PlacedImage {
		img := image.NewGray(image.Rect(0, 0, 40, 40))
		for i := range img.Pix {
			img.Pix[i] = shade
		}
		data, _ := encodePNG(img)
		path := filepath.Join(dir, name)
		os.WriteFile(path, data, 0o600)
		return pdf.PlacedImage{Page: 1, Path: path, Box: [4]float64{0, 0, 500, 500}}
	}
	for name, images := range map[string]func(dir string) ([]pdf.PlacedImage, error){
		"some originals are broken": func(dir string) ([]pdf.PlacedImage, error) {
			corrupt := filepath.Join(dir, "corrupt.png")
			os.WriteFile(corrupt, []byte("\x89PNG not really"), 0o600)
			// Its header reads, so it gets an ID, but its pixels don't.
			truncated := square(dir, "truncated.png", 100)
			data, _ := os.ReadFile(truncated.Path)
			os.WriteFile(truncated.Path, data[:len(data)/2], 0o600)
			return []pdf.PlacedImage{
				square(dir, "a.png", 50),
				{Page: 1, Path: filepath.Join(dir, "missing.png")},
				{Page: 1, Path: corrupt},
				truncated,
				square(dir, "b.png", 150),
			}, nil
		},
		"extraction fails": func(string) ([]pdf.PlacedImage, error) { return nil, fmt.Errorf("pdftohtml failed") },
	} {
		t.Run(name, func(t *testing.T) {
			ai := scriptedModel(t, func(r fakeRequest) fakeReply {
				first := string(r.Messages[0].Content)
				if !strings.Contains(first, "Previews of pages [2]") {
					t.Error("the model should be told which previews are missing")
				}
				if strings.Contains(first, `\"img2\"`) {
					t.Error("an original that can't be decoded shouldn't be in the inventory")
				}
				return fakeReply{content: "## Page 1\n\n![A](asset:img1) ![T](asset:img2) ![B](asset:img3)\n\n## Page 2\n\nText."}
			})
			tr := testPDF(ai, 2)
			tr.Tool = fakePDF{pages: 2, images: images, broken: 2}
			result, err := tr.Transcribe(context.Background(), "a.pdf", []byte("%PDF"), t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			want := 2
			if name == "extraction fails" {
				want = 0
			}
			if len(result.Assets) != want || want > 0 && (result.Assets[0].ID != "img1" || result.Assets[1].ID != "img3") {
				t.Errorf("assets = %v, want %d", result.Assets, want)
			}
		})
	}
}

func TestAPDFWithAnImageTooLargeIsRefusedBeforeAnythingIsSpent(t *testing.T) {
	ai := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("the model shouldn't be asked")
	}))
	defer ai.Close()
	tr := &PDF{Config: config.Config{MaxPages: 75, RangePages: 25, Turns: 3, Parallel: 1},
		AI:   &openrouter.Client{URL: ai.URL, HTTP: http.DefaultClient},
		Tool: fakePDF{pages: 1, largest: pdf.MaxImagePixels + 1}}
	_, err := tr.Transcribe(context.Background(), "a.pdf", []byte("%PDF"), t.TempDir())
	var user UserError
	if !errors.As(err, &user) || !strings.Contains(err.Error(), "41 megapixels") {
		t.Errorf("err = %v", err)
	}
}

func TestLargeImagesAreDecodedOneAtATime(t *testing.T) {
	write := func(side int) string {
		data, err := encodePNG(image.NewGray(image.Rect(0, 0, side, side)))
		if err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(t.TempDir(), "image.png")
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatal(err)
		}
		return path
	}
	large, small := write(3000), write(100)
	ctx := context.Background()

	var at, most atomic.Int64
	var wg sync.WaitGroup
	for range 4 {
		wg.Go(func() {
			err := withImageFile(ctx, large, func(img image.Image) error {
				n := at.Add(1)
				for m := most.Load(); n > m && !most.CompareAndSwap(m, n); m = most.Load() {
				}
				time.Sleep(10 * time.Millisecond)
				at.Add(-1)
				return nil
			})
			if err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if most.Load() != 1 {
		t.Errorf("%d large images at once", most.Load())
	}

	// With another large image held, a small one doesn't wait, and a cancelled job stops waiting.
	largeImages <- struct{}{}
	defer func() { <-largeImages }()
	if err := withImageFile(ctx, small, func(image.Image) error { return nil }); err != nil {
		t.Error(err)
	}
	cancelled, cancel := context.WithTimeout(ctx, 10*time.Millisecond)
	defer cancel()
	err := withImageFile(cancelled, large, func(image.Image) error {
		t.Error("a cancelled job shouldn't use the image")
		return nil
	})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("err = %v", err)
	}
}
