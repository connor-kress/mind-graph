package pdf

import (
	"bytes"
	"context"
	"fmt"
	"image"
	_ "image/png"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestParsePdftohtml(t *testing.T) {
	xml := `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE pdf2xml SYSTEM "pdf2xml.dtd">
<pdf2xml producer="poppler" version="26.01.0">
<page number="1" position="absolute" top="0" left="0" height="800" width="500">
<text top="10" left="10" width="50" height="12" font="0">Hi &amp; bye</text>
<image top="400" left="250" width="250" height="400" src="/tmp/x/img-1_1.jpg"/>
</page>
<page number="2" position="absolute" top="0" left="0" height="800" width="500">
<image top="-80" left="0" width="500" height="160" src="img-2_1.png"/>
</page>
</pdf2xml>`
	got, err := parsePdftohtml(strings.NewReader(xml), "/work")
	if err != nil {
		t.Fatal(err)
	}
	want := []PlacedImage{
		{Page: 1, Path: "/work/img-1_1.jpg", Box: [4]float64{500, 500, 1000, 1000}},
		{Page: 2, Path: "/work/img-2_1.png", Box: [4]float64{0, -100, 1000, 100}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("parsePdftohtml = %+v", got)
	}
}

// TestPoppler runs the real tools on a PDF from the eval, when they're available.
func TestPoppler(t *testing.T) {
	pdf, _ := filepath.Abs("../../../.document-eval.local/luna-optimization/fixtures/mixed-fixtures.pdf")
	if _, err := exec.LookPath("pdftohtml"); err != nil {
		t.Skip("poppler-utils isn't installed")
	}
	if _, err := os.Stat(pdf); err != nil {
		t.Skip("no eval fixture")
	}
	ctx, dir, tool := context.Background(), t.TempDir(), poppler{}
	pages, err := tool.PageCount(ctx, pdf)
	if err != nil || pages != 3 {
		t.Fatalf("PageCount = %d, %v", pages, err)
	}
	part := filepath.Join(dir, "part.pdf")
	if err := tool.Split(ctx, pdf, 2, 3, part); err != nil {
		t.Fatal(err)
	}
	if n, _ := tool.PageCount(ctx, part); n != 2 {
		t.Errorf("split has %d pages", n)
	}
	page := filepath.Join(dir, "page.png")
	if err := tool.Render(ctx, pdf, 1, 50, page); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(page); err != nil || !bytes.HasPrefix(data, []byte("\x89PNG")) {
		t.Errorf("render: %v", err)
	}
	region := filepath.Join(dir, "region.png")
	if err := tool.RenderRegion(ctx, pdf, 1, 50, image.Rect(5, 10, 25, 20), region); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(region)
	if err != nil {
		t.Fatal(err)
	}
	if size, _, err := image.DecodeConfig(bytes.NewReader(data)); err != nil || size.Width != 20 || size.Height != 10 {
		t.Errorf("region: %+v, %v", size, err)
	}
	images, err := tool.Images(ctx, pdf, 1, 3, dir)
	if err != nil || len(images) == 0 {
		t.Fatalf("Images = %v, %v", images, err)
	}
	for _, img := range images {
		if _, err := os.Stat(img.Path); err != nil {
			t.Error(err)
		}
	}
}

func TestHugeImage(t *testing.T) {
	list := `page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio
--------------------------------------------------------------------------------------------
   6     0 image     481   303  rgb     3   8  jpeg   yes       51  0   154   154 15.2K 3.6%
`
	if hugeImage([]byte(list)) {
		t.Error("a small image isn't huge")
	}
	if !hugeImage([]byte(list + "   7     1 image   20000 20000  rgb     3   8  jpeg   yes       52  0   154   154 15.2K 0.1%\n")) {
		t.Error("a 400 MP image is huge")
	}
	images := func(n, w, h int) []byte {
		return []byte(list[:strings.Index(list, "   6")] +
			strings.Repeat(fmt.Sprintf("   1     0 image %d %d rgb 3 8 jpeg yes 51 0 154 154 15K 3%%\n", w, h), n))
	}
	if hugeImage(images(300, 100, 100)) || !hugeImage(images(301, 100, 100)) {
		t.Error("more than 300 bitmaps is too many")
	}
	if hugeImage(images(20, 5000, 4000)) || !hugeImage(images(21, 5000, 4000)) {
		t.Error("more than 400 MP in all is too many")
	}
}

// testPDF writes a one-page PDF with a dark bar off to one side, so a region taken
// from the wrong place doesn't match, on a page with the given rotation.
func testPDF(t *testing.T, rotate int) string {
	t.Helper()
	content := "0 0 0 rg 100 500 200 150 re f"
	objects := []string{
		"<</Type/Catalog/Pages 2 0 R>>",
		"<</Type/Pages/Kids[3 0 R]/Count 1>>",
		fmt.Sprintf("<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Rotate %d/Contents 4 0 R>>", rotate),
		fmt.Sprintf("<</Length %d>>stream\n%s\nendstream", len(content), content),
	}
	var b bytes.Buffer
	b.WriteString("%PDF-1.4\n")
	var offsets []int
	for i, o := range objects {
		offsets = append(offsets, b.Len())
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", i+1, o)
	}
	xref := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(objects)+1)
	for _, o := range offsets {
		fmt.Fprintf(&b, "%010d 00000 n \n", o)
	}
	fmt.Fprintf(&b, "trailer<</Size %d/Root 1 0 R>>\nstartxref\n%d\n%%%%EOF\n", len(objects)+1, xref)
	path := filepath.Join(t.TempDir(), "test.pdf")
	if err := os.WriteFile(path, b.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func decodePNG(t *testing.T, path string) image.Image {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	return img
}

func TestARegionMatchesThatPartOfTheFullRender(t *testing.T) {
	if _, err := exec.LookPath("pdftoppm"); err != nil {
		t.Skip("poppler-utils isn't installed")
	}
	for _, rotate := range []int{0, 90} {
		ctx, dir, tool, pdf := context.Background(), t.TempDir(), poppler{}, testPDF(t, rotate)
		fullPath, regionPath := filepath.Join(dir, "full.png"), filepath.Join(dir, "region.png")
		if err := tool.Render(ctx, pdf, 1, 400, fullPath); err != nil {
			t.Fatal(err)
		}
		full := decodePNG(t, fullPath)
		// Across the bar's edges, so it holds both dark and light pixels.
		var dark image.Point
		for y := range full.Bounds().Dy() {
			for x := range full.Bounds().Dx() {
				if r, _, _, _ := full.At(x, y).RGBA(); r < 1<<15 && dark == (image.Point{}) {
					dark = image.Pt(x, y)
				}
			}
		}
		box := image.Rect(dark.X-10, dark.Y-10, dark.X+30, dark.Y+20)
		if err := tool.RenderRegion(ctx, pdf, 1, 400, box, regionPath); err != nil {
			t.Fatal(err)
		}
		region := decodePNG(t, regionPath)
		if region.Bounds().Dx() != box.Dx() || region.Bounds().Dy() != box.Dy() {
			t.Fatalf("rotate %d: region is %v, want %v", rotate, region.Bounds(), box)
		}
		for y := range box.Dy() {
			for x := range box.Dx() {
				got, want := fmt.Sprint(region.At(x, y)), fmt.Sprint(full.At(box.Min.X+x, box.Min.Y+y))
				if got != want {
					t.Fatalf("rotate %d: pixel %d,%d is %v, want %v", rotate, x, y, got, want)
				}
			}
		}
	}
}
