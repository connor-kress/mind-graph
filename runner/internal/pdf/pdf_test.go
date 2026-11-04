package pdf

import (
	"bytes"
	"context"
	"fmt"
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
