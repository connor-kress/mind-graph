// Package office reads the text of Word and PowerPoint files.
//
// They're zipped XML, so their text is read directly. Their images aren't
// used: without a renderer, there's no way to tell how they're cropped,
// layered or placed.
package office

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"path"
	"strconv"
	"strings"
)

// Characters of text a document can have, to limit what transcribing it costs.
const maxDocumentChars = 300_000

// ErrTooMuchText means a file has more text than can be transcribed.
var ErrTooMuchText = fmt.Errorf("more than %d characters of text", maxDocumentChars)

// Bytes any one part of a file may unzip to.
const maxPartBytes = 64 << 20

func openZip(data []byte) (*zip.Reader, error) {
	return zip.NewReader(bytes.NewReader(data), int64(len(data)))
}

func readPart(z *zip.Reader, name string) ([]byte, error) {
	f, err := z.Open(name)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxPartBytes+1))
	if err == nil && len(data) > maxPartBytes {
		err = fmt.Errorf("%s is too large", name)
	}
	return data, err
}

// DocumentText returns a Word document's paragraphs, with headings, list
// items, table rows and footnotes marked as in Markdown.
func DocumentText(data []byte) ([]string, error) {
	z, err := openZip(data)
	if err != nil {
		return nil, err
	}
	doc, err := readPart(z, "word/document.xml")
	if err != nil {
		return nil, err
	}
	w := &wordText{}
	if err := w.parse(doc); err != nil {
		return nil, err
	}
	for _, name := range []string{"word/footnotes.xml", "word/endnotes.xml"} {
		notes, err := readPart(z, name)
		if errors.Is(err, fs.ErrNotExist) {
			continue
		} else if err != nil {
			return nil, err
		}
		if err := w.parse(notes); err != nil {
			return nil, err
		}
	}
	return w.out, nil
}

// wordText collects paragraphs from WordprocessingML parts.
type wordText struct {
	out []string
	// Characters written so far, including references and separators, against maxDocumentChars.
	total int
}

// write adds text to a paragraph, counting it.
func (w *wordText) write(para *wordParagraph, text string) error {
	if w.total += len(text); w.total > maxDocumentChars {
		return ErrTooMuchText
	}
	if para != nil {
		para.text.WriteString(text)
	}
	return nil
}

type wordParagraph struct {
	text     strings.Builder
	heading  int
	listItem bool
}

// noteLabel is how a footnote (f) or endnote (e) is referred to in Markdown.
func noteLabel(kind, id string) string { return "[^" + kind + id + "]" }

func (w *wordText) parse(data []byte) error {
	// A paragraph can hold others, e.g. in a text box, so each level has its own.
	var paras []*wordParagraph
	// Cells of the outermost table's current row. A table within a cell becomes more of that cell's text.
	var cells []*strings.Builder
	var tableDepth int
	// The footnote or endnote being read, if any.
	var note *strings.Builder
	var inNote bool
	var noteKind, noteID string
	emit := func(text string) { w.out = append(w.out, text) }
	d := xml.NewDecoder(bytes.NewReader(data))
	for {
		tok, err := d.Token()
		if err == io.EOF {
			return nil
		} else if err != nil {
			return err
		}
		var para *wordParagraph
		if len(paras) > 0 {
			para = paras[len(paras)-1]
		}
		switch e := tok.(type) {
		case xml.StartElement:
			switch e.Name.Local {
			case "Fallback":
				// The same content as its mc:Choice, for older readers, which would repeat it.
				if err := d.Skip(); err != nil {
					return err
				}
			case "footnote", "endnote":
				inNote = true
				// Separators are the lines above notes, not notes.
				if t := attr(e, "type"); t == "" || t == "normal" {
					note, noteKind, noteID = &strings.Builder{}, e.Name.Local[:1], attr(e, "id")
				}
			case "footnoteReference", "endnoteReference":
				if err := w.write(para, noteLabel(e.Name.Local[:1], attr(e, "id"))); err != nil {
					return err
				}
			case "p":
				paras = append(paras, &wordParagraph{})
			case "pStyle":
				style := strings.ToLower(attr(e, "val"))
				if para == nil {
					break
				}
				if n, err := strconv.Atoi(strings.TrimPrefix(style, "heading")); err == nil && strings.HasPrefix(style, "heading") {
					para.heading = min(max(n, 1), 6)
				} else if style == "title" {
					para.heading = 1
				}
			case "numPr":
				if para != nil {
					para.listItem = true
				}
			case "tab", "br", "cr":
				sep := "\n"
				if e.Name.Local == "tab" {
					sep = "\t"
				}
				if err := w.write(para, sep); err != nil {
					return err
				}
			case "tbl":
				tableDepth++
			case "tr":
				if tableDepth == 1 {
					cells = nil
				}
			case "tc":
				if tableDepth == 1 {
					cells = append(cells, &strings.Builder{})
				}
			case "t":
				var text string
				if err := d.DecodeElement(&text, &e); err != nil {
					return err
				}
				if err := w.write(para, text); err != nil {
					return err
				}
			}
		case xml.EndElement:
			switch e.Name.Local {
			case "p":
				if para == nil {
					break
				}
				paras = paras[:len(paras)-1]
				text := strings.TrimSpace(para.text.String())
				switch {
				case text == "", inNote && note == nil:
				case len(paras) > 0:
					// E.g. a text box, kept where it is in the paragraph around it.
					// Its text was counted; the spaces around it weren't.
					if err := w.write(nil, "  "); err != nil {
						return err
					}
					paras[len(paras)-1].text.WriteString(" " + text + " ")
				case note != nil:
					if note.Len() > 0 {
						note.WriteString(" ")
					}
					note.WriteString(text)
				case tableDepth > 0 && len(cells) > 0:
					cell := cells[len(cells)-1]
					if cell.Len() > 0 {
						cell.WriteString(" ")
					}
					cell.WriteString(text)
				case para.heading > 0:
					emit(strings.Repeat("#", para.heading) + " " + text)
				case para.listItem:
					emit("- " + text)
				default:
					emit(text)
				}
			case "footnote", "endnote":
				if note != nil && note.Len() > 0 {
					emit(noteLabel(noteKind, noteID) + ": " + note.String())
				}
				note, inNote = nil, false
			case "tr":
				if tableDepth == 1 {
					row := make([]string, len(cells))
					for i, c := range cells {
						row[i] = c.String()
					}
					if len(row) > 0 {
						emit("| " + strings.Join(row, " | ") + " |")
					}
					cells = nil
				}
			case "tbl":
				tableDepth--
			}
		}
	}
}

type relationship struct {
	ID     string `xml:"Id,attr"`
	Type   string `xml:"Type,attr"`
	Target string `xml:"Target,attr"`
}

// relationships maps a part's relationship IDs to the parts they point to.
func relationships(z *zip.Reader, part string) (map[string]relationship, error) {
	data, err := readPart(z, path.Join(path.Dir(part), "_rels", path.Base(part)+".rels"))
	if err != nil {
		return nil, err
	}
	var rels struct {
		List []relationship `xml:"Relationship"`
	}
	if err := xml.Unmarshal(data, &rels); err != nil {
		return nil, err
	}
	out := map[string]relationship{}
	for _, r := range rels.List {
		r.Target = path.Join(path.Dir(part), r.Target)
		out[r.ID] = r
	}
	return out, nil
}

// TooManySlidesError is a presentation with more slides than can be transcribed.
type TooManySlidesError int

func (e TooManySlidesError) Error() string { return fmt.Sprintf("%d slides", int(e)) }

// SlidesText returns each slide's text in presentation order, followed by its
// speaker notes. Presentations of more than maxSlides are refused unread.
func SlidesText(data []byte, maxSlides int) ([]string, error) {
	z, err := openZip(data)
	if err != nil {
		return nil, err
	}
	const presentation = "ppt/presentation.xml"
	pres, err := readPart(z, presentation)
	if err != nil {
		return nil, err
	}
	rels, err := relationships(z, presentation)
	if err != nil {
		return nil, err
	}
	var list struct {
		Slides []struct {
			RID string `xml:"http://schemas.openxmlformats.org/officeDocument/2006/relationships id,attr"`
		} `xml:"sldIdLst>sldId"`
	}
	if err := xml.Unmarshal(pres, &list); err != nil {
		return nil, err
	}
	if len(list.Slides) > maxSlides {
		return nil, TooManySlidesError(len(list.Slides))
	}
	var out []string
	total := 0
	for _, s := range list.Slides {
		slide, ok := rels[s.RID]
		if !ok {
			return nil, fmt.Errorf("missing slide %s", s.RID)
		}
		data, err := readPart(z, slide.Target)
		if err != nil {
			return nil, err
		}
		text, err := shapesText(data, false)
		if err != nil {
			return nil, err
		}
		slideRels, err := relationships(z, slide.Target)
		if err != nil && !errors.Is(err, fs.ErrNotExist) {
			return nil, err
		}
		for _, r := range slideRels {
			if !strings.HasSuffix(r.Type, "/notesSlide") {
				continue
			}
			data, err := readPart(z, r.Target)
			if err != nil {
				return nil, err
			}
			notes, err := shapesText(data, true)
			if err != nil {
				return nil, err
			}
			if notes != "" {
				text += "\n\nNotes:\n" + notes
			}
		}
		out = append(out, text)
		if total += len(text); total > maxDocumentChars {
			return nil, ErrTooMuchText
		}
	}
	return out, nil
}

// shapesText returns a slide's paragraphs. For a notes page, only the notes
// themselves count, not its slide number or other placeholders.
func shapesText(data []byte, notes bool) (string, error) {
	var lines []string
	var para strings.Builder
	var placeholder string
	d := xml.NewDecoder(bytes.NewReader(data))
	for {
		tok, err := d.Token()
		if err == io.EOF {
			break
		} else if err != nil {
			return "", err
		}
		switch e := tok.(type) {
		case xml.StartElement:
			switch e.Name.Local {
			case "sp":
				placeholder = ""
			case "ph":
				placeholder = attr(e, "type")
			case "p":
				para.Reset()
			case "br":
				para.WriteString("\n")
			case "t":
				var text string
				if err := d.DecodeElement(&text, &e); err != nil {
					return "", err
				}
				para.WriteString(text)
			}
		case xml.EndElement:
			if e.Name.Local == "sp" {
				placeholder = ""
			}
			if e.Name.Local != "p" {
				continue
			}
			text := strings.TrimSpace(para.String())
			keep := text != "" && placeholder != "sldNum"
			if notes {
				keep = keep && placeholder == "body"
			}
			if keep {
				lines = append(lines, text)
			}
		}
	}
	return strings.Join(lines, "\n"), nil
}

func attr(e xml.StartElement, name string) string {
	for _, a := range e.Attr {
		if a.Name.Local == name {
			return a.Value
		}
	}
	return ""
}
