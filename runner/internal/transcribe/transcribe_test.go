package transcribe

import (
	"archive/zip"
	"bytes"
	"context"
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
	"sync/atomic"
	"testing"
	"time"

	"github.com/connor-kress/mind-graph/runner/internal/config"
	"github.com/connor-kress/mind-graph/runner/internal/openrouter"
	"github.com/connor-kress/mind-graph/runner/internal/pdf"
)

// fakePDF is a PDF of some number of pages whose ranges are named by their pages.
type fakePDF struct{ pages int }

func (f fakePDF) PageCount(context.Context, string) (int, error) { return f.pages, nil }
func (fakePDF) Split(_ context.Context, _ string, first, last int, out string) error {
	return os.WriteFile(out, fmt.Appendf(nil, "%d-%d", first, last), 0o600)
}
func (fakePDF) Render(context.Context, string, int, int, string) error {
	return fmt.Errorf("no renders")
}
func (fakePDF) Images(context.Context, string, int, int, string) ([]pdf.PlacedImage, error) {
	return nil, nil
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
	return &PDF{
		Config:  config.Config{MaxPages: 75, TextRangePages: 4, Parallel: 2},
		AI:      ai,
		Tool:    fakePDF{pages},
		Prompts: Prompts{Text: "Transcribe."},
	}
}

func TestTextPassSplitsARangeThatsCutOff(t *testing.T) {
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
	word := &Word{Config: config.Config{TextRangePages: 25, Parallel: 2}, AI: ai, Prompt: "Document."}
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
