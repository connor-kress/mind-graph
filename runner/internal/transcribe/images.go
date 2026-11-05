package transcribe

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"

	"golang.org/x/image/draw"
	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
)

func decodeImageFile(path string) (image.Image, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	return img, err
}

func encodePNG(img image.Image) ([]byte, error) {
	var b bytes.Buffer
	err := png.Encode(&b, img)
	return b.Bytes(), err
}

func encodeJPEG(img image.Image) ([]byte, error) {
	var b bytes.Buffer
	err := jpeg.Encode(&b, img, &jpeg.Options{Quality: 85})
	return b.Bytes(), err
}

// fit scales an image down, keeping its proportions, to fit within w by h.
func fit(img image.Image, w, h int) image.Image {
	b := img.Bounds()
	scale := min(float64(w)/float64(b.Dx()), float64(h)/float64(b.Dy()), 1)
	out := image.NewRGBA(image.Rect(0, 0, max(1, int(float64(b.Dx())*scale)), max(1, int(float64(b.Dy())*scale))))
	draw.Draw(out, out.Bounds(), image.White, image.Point{}, draw.Src)
	draw.CatmullRom.Scale(out, out.Bounds(), img, b, draw.Over, nil)
	return out
}

// crop cuts out a box given from 0 to 1000 of the image's width and height.
func crop(img image.Image, box [4]float64) (image.Image, error) {
	if !(0 <= box[0] && box[0] < box[2] && box[2] <= 1000 && 0 <= box[1] && box[1] < box[3] && box[3] <= 1000) {
		return nil, fmt.Errorf("bbox must be [left, top, right, bottom] within 0..1000, with left < right and top < bottom")
	}
	b := img.Bounds()
	r := image.Rect(
		b.Min.X+int(box[0]*float64(b.Dx())/1000), b.Min.Y+int(box[1]*float64(b.Dy())/1000),
		b.Min.X+int(box[2]*float64(b.Dx())/1000+0.5), b.Min.Y+int(box[3]*float64(b.Dy())/1000+0.5),
	)
	if r.Dx() < 1 || r.Dy() < 1 {
		return nil, fmt.Errorf("the crop is empty")
	}
	out := image.NewRGBA(image.Rect(0, 0, r.Dx(), r.Dy()))
	draw.Draw(out, out.Bounds(), img, r.Min, draw.Src)
	return out, nil
}

// withGrid copies an image with lines and labels every 100 of its 0 to 1000
// coordinates, so crops of it can be placed by reading them.
func withGrid(img image.Image) image.Image {
	b := img.Bounds()
	out := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(out, out.Bounds(), img, b.Min, draw.Src)
	line := image.NewUniform(color.NRGBA{0, 90, 200, 70})
	ink := image.NewUniform(color.RGBA{0, 60, 170, 255})
	back := image.NewUniform(color.White)
	label := func(s string, x, y int) {
		box := image.Rect(x, y, x+7*len(s)+2, y+13)
		draw.Draw(out, box, back, image.Point{}, draw.Src)
		d := font.Drawer{Dst: out, Src: ink, Face: basicfont.Face7x13, Dot: fixed.P(x+1, y+11)}
		d.DrawString(s)
	}
	for v := 100; v < 1000; v += 100 {
		x, y := v*b.Dx()/1000, v*b.Dy()/1000
		draw.Draw(out, image.Rect(x, 0, x+1, b.Dy()), line, image.Point{}, draw.Over)
		draw.Draw(out, image.Rect(0, y, b.Dx(), y+1), line, image.Point{}, draw.Over)
		label(fmt.Sprint(v), x+2, 0)
		label(fmt.Sprint(v), 0, y+1)
	}
	return out
}

// tile is an image on a contact sheet, with lines of text above it.
type tile struct {
	img   image.Image
	label []string
}

// sheet lays tiles out in a grid of cols columns, each cell w by h including its label.
func sheet(tiles []tile, cols, w, h int) image.Image {
	rows := (len(tiles) + cols - 1) / cols
	out := image.NewRGBA(image.Rect(0, 0, cols*w, rows*h))
	draw.Draw(out, out.Bounds(), image.White, image.Point{}, draw.Src)
	const lineHeight = 15
	for i, t := range tiles {
		x, y := (i%cols)*w, (i/cols)*h
		labelHeight := 6 + lineHeight*len(t.label)
		for n, line := range t.label {
			d := font.Drawer{
				Dst:  out,
				Src:  image.NewUniform(color.Black),
				Face: basicfont.Face7x13,
				Dot:  fixed.P(x+8, y+lineHeight*(n+1)),
			}
			d.DrawString(line)
		}
		thumb := fit(t.img, w-20, h-labelHeight-10)
		tb := thumb.Bounds()
		at := image.Pt(x+(w-tb.Dx())/2, y+labelHeight+(h-labelHeight-tb.Dy())/2)
		draw.Draw(out, tb.Add(at), thumb, image.Point{}, draw.Src)
	}
	return out
}
