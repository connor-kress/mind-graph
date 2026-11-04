package office

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func zipOf(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	for name, content := range files {
		w, err := z.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		w.Write([]byte(content))
	}
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

const w = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`

func TestDocumentText(t *testing.T) {
	doc := zipOf(t, map[string]string{"word/document.xml": `<w:document ` + w + `><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Cells</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Mitochondria </w:t></w:r><w:r><w:t>make ATP.</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Glycolysis</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Stage</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>ATP</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p></w:p>
</w:body></w:document>`})
	got, err := DocumentText(doc)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"## Cells", "Mitochondria make ATP.", "- Glycolysis", "| Stage | ATP |"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("DocumentText = %q", got)
	}
}

const (
	p = `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`
	a = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`
	r = `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`
)

func slide(texts ...string) string {
	var b strings.Builder
	b.WriteString(`<p:sld ` + p + ` ` + a + `><p:cSld><p:spTree>`)
	for _, t := range texts {
		b.WriteString(`<p:sp><p:txBody><a:p><a:r><a:t>` + t + `</a:t></a:r></a:p></p:txBody></p:sp>`)
	}
	b.WriteString(`</p:spTree></p:cSld></p:sld>`)
	return b.String()
}

func TestSlidesText(t *testing.T) {
	deck := zipOf(t, map[string]string{
		"ppt/presentation.xml": `<p:presentation ` + p + ` ` + r + `><p:sldIdLst>
<p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`,
		"ppt/_rels/presentation.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>`,
		"ppt/slides/slide1.xml": slide("Second slide"),
		"ppt/slides/slide2.xml": slide("First slide", "A point"),
		"ppt/slides/_rels/slide2.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
</Relationships>`,
		"ppt/notesSlides/notesSlide1.xml": `<p:notes ` + p + ` ` + a + `><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>1</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Say this.</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:notes>`,
	})
	got, err := SlidesText(deck, 75)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"First slide\nA point\n\nNotes:\nSay this.", "Second slide"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("SlidesText = %q", got)
	}
}

func TestDocumentTextKeepsNestedTables(t *testing.T) {
	cell := func(text string) string { return `<w:tc><w:p><w:r><w:t>` + text + `</w:t></w:r></w:p></w:tc>` }
	doc := zipOf(t, map[string]string{"word/document.xml": `<w:document ` + w + `><w:body><w:tbl><w:tr>` +
		cell("Outer") +
		`<w:tc><w:p><w:r><w:t>Before</w:t></w:r></w:p><w:tbl><w:tr>` + cell("Inner A") + cell("Inner B") + `</w:tr></w:tbl></w:tc>` +
		cell("Last") +
		`</w:tr></w:tbl></w:body></w:document>`})
	got, err := DocumentText(doc)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"| Outer | Before Inner A Inner B | Last |"}; !reflect.DeepEqual(got, want) {
		t.Errorf("DocumentText = %q", got)
	}
}

func TestDocumentTextKeepsTextBoxesAndNotes(t *testing.T) {
	run := func(text string) string { return `<w:r><w:t xml:space="preserve">` + text + `</w:t></w:r>` }
	doc := zipOf(t, map[string]string{
		"word/document.xml": `<w:document ` + w + `><w:body><w:p>` + run("Before ") +
			`<w:r><w:txbxContent><w:p>` + run("Inside") + `</w:p></w:txbxContent></w:r>` +
			run("after.") + `<w:r><w:footnoteReference w:id="2"/></w:r></w:p></w:body></w:document>`,
		"word/footnotes.xml": `<w:footnotes ` + w + `>
<w:footnote w:type="separator" w:id="-1"><w:p>` + run("----") + `</w:p></w:footnote>
<w:footnote w:id="2"><w:p>` + run("A source.") + `</w:p></w:footnote></w:footnotes>`,
		"word/endnotes.xml": `<w:endnotes ` + w + `><w:endnote w:id="1"><w:p>` + run("The end.") + `</w:p></w:endnote></w:endnotes>`,
	})
	got, err := DocumentText(doc)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"Before  Inside after.[^f2]", "[^f2]: A source.", "[^e1]: The end."}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("DocumentText = %q", got)
	}
}

func TestDocumentTextCountsTextAsItsRead(t *testing.T) {
	// All in one cell, so no row ever finishes.
	para := `<w:p><w:r><w:t>` + strings.Repeat("x", 1000) + `</w:t></w:r></w:p>`
	doc := zipOf(t, map[string]string{"word/document.xml": `<w:document ` + w + `><w:body><w:tbl><w:tr><w:tc>` +
		strings.Repeat(para, maxDocumentChars/1000+1) + `</w:tc></w:tr></w:tbl></w:body></w:document>`})
	if _, err := DocumentText(doc); !errors.Is(err, ErrTooMuchText) {
		t.Errorf("err = %v", err)
	}
}

func TestSlidesTextReportsBrokenNotes(t *testing.T) {
	deck := zipOf(t, map[string]string{
		"ppt/presentation.xml": `<p:presentation ` + p + ` ` + r + `><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>`,
		"ppt/_rels/presentation.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`,
		"ppt/slides/slide1.xml": slide("Only slide"),
		"ppt/slides/_rels/slide1.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/missing.xml"/></Relationships>`,
	})
	if _, err := SlidesText(deck, 75); err == nil {
		t.Error("expected an error for notes that can't be read")
	}
}

func TestDocumentTextReadsOneCompatibilityBranch(t *testing.T) {
	box := func(text string) string {
		return `<w:txbxContent><w:p><w:r><w:t>` + text + `</w:t></w:r></w:p></w:txbxContent>`
	}
	doc := zipOf(t, map[string]string{"word/document.xml": `<w:document ` + w +
		` xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body><w:p><w:r>` +
		`<mc:AlternateContent><mc:Choice Requires="wps">` + box("Boxed") + `</mc:Choice>` +
		`<mc:Fallback>` + box("Boxed") + `</mc:Fallback></mc:AlternateContent>` +
		`</w:r></w:p></w:body></w:document>`})
	got, err := DocumentText(doc)
	if err != nil || len(got) != 1 || strings.Count(got[0], "Boxed") != 1 {
		t.Errorf("DocumentText = %q, %v", got, err)
	}
}

func TestDocumentTextCountsNestedParagraphs(t *testing.T) {
	nested := `<w:txbxContent><w:p><w:r><w:t>x</w:t></w:r></w:p></w:txbxContent>`
	doc := zipOf(t, map[string]string{"word/document.xml": `<w:document ` + w + `><w:body><w:p><w:r>` +
		strings.Repeat(nested, maxDocumentChars/3+1) + `</w:r></w:p></w:body></w:document>`})
	if _, err := DocumentText(doc); !errors.Is(err, ErrTooMuchText) {
		t.Errorf("err = %v", err)
	}
}

func TestSlidesTextKeepsATableAfterASlideNumber(t *testing.T) {
	deck := zipOf(t, map[string]string{
		"ppt/presentation.xml": `<p:presentation ` + p + ` ` + r + `><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>`,
		"ppt/_rels/presentation.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`,
		"ppt/slides/slide1.xml": `<p:sld ` + p + ` ` + a + `><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>4</a:t></a:r></a:p></p:txBody></p:sp>
<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Cell</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>
</p:spTree></p:cSld></p:sld>`,
	})
	got, err := SlidesText(deck, 75)
	if err != nil || !reflect.DeepEqual(got, []string{"Cell"}) {
		t.Errorf("SlidesText = %q, %v", got, err)
	}
}

func TestSlidesTextRefusesTooManySlidesUnread(t *testing.T) {
	var ids strings.Builder
	for i := range 80 {
		fmt.Fprintf(&ids, `<p:sldId id="%d" r:id="rId%d"/>`, 256+i, i)
	}
	deck := zipOf(t, map[string]string{
		"ppt/presentation.xml":            `<p:presentation ` + p + ` ` + r + `><p:sldIdLst>` + ids.String() + `</p:sldIdLst></p:presentation>`,
		"ppt/_rels/presentation.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
	})
	if _, err := SlidesText(deck, 75); err != TooManySlidesError(80) {
		t.Errorf("err = %v", err)
	}
}

func TestDocumentTextCountsReferencesAndBreaks(t *testing.T) {
	doc := zipOf(t, map[string]string{"word/document.xml": `<w:document ` + w + `><w:body><w:p>` +
		strings.Repeat(`<w:r><w:footnoteReference w:id="12345"/><w:br/></w:r>`, maxDocumentChars/8) +
		`</w:p></w:body></w:document>`})
	if _, err := DocumentText(doc); !errors.Is(err, ErrTooMuchText) {
		t.Errorf("err = %v", err)
	}
}

func TestOfficeTextRejectsNonZip(t *testing.T) {
	if _, err := DocumentText([]byte("not a zip")); err == nil {
		t.Error("expected an error")
	}
}
