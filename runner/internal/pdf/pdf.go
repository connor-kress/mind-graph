// Package pdf does what the runner needs with a PDF, through command-line tools.
package pdf

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"image"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Tool does what the runner needs with a PDF. Each tool, such as Poppler or
// MuPDF, gets an adapter, so they can be compared on the same documents.
type Tool interface {
	PageCount(ctx context.Context, pdf string) (int, error)
	// LargestImage returns the pixels in the document's largest bitmap, without decoding any.
	LargestImage(ctx context.Context, pdf string) (int, error)
	// Split writes pages first to last, counting from 1, to a new PDF.
	Split(ctx context.Context, pdf string, first, last int, out string) error
	// Render writes a page as a PNG, scaled so its longer side is size pixels.
	Render(ctx context.Context, pdf string, page, size int, out string) error
	// RenderRegion writes part of a page as a PNG, given in the pixels of a Render at size.
	RenderRegion(ctx context.Context, pdf string, page, size int, region image.Rectangle, out string) error
	// Images extracts the bitmaps drawn on pages first to last into dir, at their own resolution.
	Images(ctx context.Context, pdf string, first, last int, dir string) ([]PlacedImage, error)
}

// Limits on bitmaps. A document with one past MaxImagePixels isn't transcribed.
// The rest are for the bitmaps in a range to be extracted, so extraction takes
// bounded memory and disk, and the model a bounded request.
const (
	MaxImagePixels = 40_000_000
	maxRangeImages = 300
	maxRangePixels = 400_000_000
)

// errHugeImage means a range has bitmaps too large or too many to extract.
var errHugeImage = errors.New("the bitmaps are too large to extract")

// PlacedImage is a bitmap where a page draws it.
type PlacedImage struct {
	Page int
	Path string
	// Left, top, right and bottom on the page, from 0 to 1000. May extend past the page.
	Box [4]float64
}

// New returns the tool named by PDF_TOOL.
func New(name string) (Tool, error) {
	switch name {
	case "poppler":
		return poppler{}, nil
	}
	return nil, fmt.Errorf("unknown PDF_TOOL %q", name)
}

// poppler uses poppler-utils: pdfinfo, pdfseparate, pdfunite, pdftoppm and pdftohtml.
type poppler struct{}

// toolTimeout bounds each command, so a PDF a tool hangs on can't hold up the queue.
const toolTimeout = 3 * time.Minute

func run(ctx context.Context, name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, toolTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("%s: %w: %s", name, err, strings.TrimSpace(stderr.String()))
	}
	return stdout.Bytes(), nil
}

var pagesLine = regexp.MustCompile(`(?m)^Pages:\s+(\d+)`)

func (poppler) PageCount(ctx context.Context, pdf string) (int, error) {
	out, err := run(ctx, "pdfinfo", pdf)
	if err != nil {
		return 0, err
	}
	m := pagesLine.FindSubmatch(out)
	if m == nil {
		return 0, fmt.Errorf("pdfinfo: no page count")
	}
	return strconv.Atoi(string(m[1]))
}

func (poppler) LargestImage(ctx context.Context, pdf string) (int, error) {
	list, err := run(ctx, "pdfimages", "-list", pdf)
	if err != nil {
		return 0, err
	}
	largest := 0
	for _, pixels := range bitmaps(list) {
		largest = max(largest, pixels)
	}
	return largest, nil
}

func (p poppler) Split(ctx context.Context, pdf string, first, last int, out string) error {
	// pdfunite repeats resources shared between pages, so a whole PDF is copied instead.
	if pages, err := p.PageCount(ctx, pdf); err == nil && first == 1 && last == pages {
		data, err := os.ReadFile(pdf)
		if err != nil {
			return err
		}
		return os.WriteFile(out, data, 0o600)
	}
	dir, err := os.MkdirTemp(filepath.Dir(out), "split-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	pattern := filepath.Join(dir, "page-%d.pdf")
	if _, err := run(ctx, "pdfseparate", "-f", strconv.Itoa(first), "-l", strconv.Itoa(last), pdf, pattern); err != nil {
		return err
	}
	if first == last {
		return os.Rename(fmt.Sprintf(pattern, first), out)
	}
	args := []string{}
	for p := first; p <= last; p++ {
		args = append(args, fmt.Sprintf(pattern, p))
	}
	_, err = run(ctx, "pdfunite", append(args, out)...)
	return err
}

// Render scales to a size rather than a resolution, so a page of any dimensions takes bounded memory.
func (poppler) Render(ctx context.Context, pdf string, page, size int, out string) error {
	n := strconv.Itoa(page)
	_, err := run(ctx, "pdftoppm", "-png", "-scale-to", strconv.Itoa(size), "-f", n, "-l", n, "-singlefile", pdf, strings.TrimSuffix(out, ".png"))
	return err
}

func (poppler) RenderRegion(ctx context.Context, pdf string, page, size int, region image.Rectangle, out string) error {
	n := strconv.Itoa(page)
	_, err := run(ctx, "pdftoppm", "-png", "-scale-to", strconv.Itoa(size), "-f", n, "-l", n, "-singlefile",
		"-x", strconv.Itoa(region.Min.X), "-y", strconv.Itoa(region.Min.Y), "-W", strconv.Itoa(region.Dx()), "-H", strconv.Itoa(region.Dy()),
		pdf, strings.TrimSuffix(out, ".png"))
	return err
}

// Images uses pdftohtml's XML output, which lists each image with where it's drawn.
func (poppler) Images(ctx context.Context, pdf string, first, last int, dir string) ([]PlacedImage, error) {
	// pdftohtml would decode and write every bitmap, however large, so their sizes are checked first.
	list, err := run(ctx, "pdfimages", "-list", "-f", strconv.Itoa(first), "-l", strconv.Itoa(last), pdf)
	if err != nil {
		return nil, err
	}
	if hugeImage(list) {
		return nil, errHugeImage
	}
	prefix := filepath.Join(dir, "img")
	_, err = run(ctx, "pdftohtml", "-xml", "-q", "-nodrm", "-zoom", "1", "-fmt", "png",
		"-f", strconv.Itoa(first), "-l", strconv.Itoa(last), pdf, prefix)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(prefix + ".xml")
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return parsePdftohtml(f, dir)
}

// hugeImage reports whether `pdfimages -list` shows bitmaps past the limits.
func hugeImage(list []byte) bool {
	count, total := 0, 0
	for _, pixels := range bitmaps(list) {
		count, total = count+1, total+pixels
		if pixels > MaxImagePixels || count > maxRangeImages || total > maxRangePixels {
			return true
		}
	}
	return false
}

// bitmaps returns the pixels in each bitmap that `pdfimages -list` shows.
func bitmaps(list []byte) []int {
	var out []int
	for _, line := range strings.Split(string(list), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		w, errW := strconv.Atoi(fields[3])
		h, errH := strconv.Atoi(fields[4])
		if errW == nil && errH == nil {
			out = append(out, w*h)
		}
	}
	return out
}

func parsePdftohtml(r io.Reader, dir string) ([]PlacedImage, error) {
	d := xml.NewDecoder(r)
	d.Strict = false
	var images []PlacedImage
	var page int
	var width, height float64
	num := func(e xml.StartElement, name string) float64 {
		v, _ := strconv.ParseFloat(attr(e, name), 64)
		return v
	}
	for {
		tok, err := d.Token()
		if err == io.EOF {
			return images, nil
		} else if err != nil {
			return nil, fmt.Errorf("pdftohtml XML: %w", err)
		}
		e, ok := tok.(xml.StartElement)
		if !ok {
			continue
		}
		switch e.Name.Local {
		case "page":
			page = int(num(e, "number"))
			width, height = num(e, "width"), num(e, "height")
		case "image":
			if width <= 0 || height <= 0 {
				continue
			}
			left, top := num(e, "left"), num(e, "top")
			images = append(images, PlacedImage{
				Page: page,
				Path: filepath.Join(dir, filepath.Base(attr(e, "src"))),
				Box: [4]float64{
					left / width * 1000, top / height * 1000,
					(left + num(e, "width")) / width * 1000, (top + num(e, "height")) / height * 1000,
				},
			})
		}
	}
}

func attr(e xml.StartElement, name string) string {
	for _, a := range e.Attr {
		if a.Name.Local == name {
			return a.Value
		}
	}
	return ""
}
