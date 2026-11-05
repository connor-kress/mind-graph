package transcribe

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"io"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
}

func (f fakePDF) PageCount(context.Context, string) (int, error) { return f.pages, nil }
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
		Config:  config.Config{MaxPages: 75, RangePages: 4, Turns: 2, MaxCrops: 12, Parallel: 2},
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
	if err := shrinkAsset(a, dir); err != nil {
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
			return fakeReply{calls: []openrouter.ToolCall{
				toolCall("c1", "crop", `{"page":1,"bbox":[0,0,500,500],"reason":"diagram"}`),
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
			for i, img := range images[1:] {
				gray, _, _, _ := img.At(0, 0).RGBA()
				if img.Bounds().Dx() != inspectSize || gray>>8 < byte10(i+1)-3 || gray>>8 > byte10(i+1)+3 {
					t.Errorf("render %d is %v, gray %d", i+1, img.Bounds(), gray>>8)
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

func TestCropsOfACutOffAttemptAreRefunded(t *testing.T) {
	ai := scriptedModel(t, func(r fakeRequest) fakeReply {
		cropped := strings.Contains(r.last(), "tool_call_id") || len(r.Messages) > 2
		switch {
		case r.file() == "pages-2-2.pdf":
			return fakeReply{content: "## Page 1\n\nTwo."}
		case !cropped:
			return fakeReply{calls: []openrouter.ToolCall{toolCall("c", "crop", `{"page":1,"bbox":[0,0,500,500],"reason":"x"}`)}}
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
