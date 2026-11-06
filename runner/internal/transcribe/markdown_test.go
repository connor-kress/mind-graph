package transcribe

import (
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestUnfence(t *testing.T) {
	if got := unfence("```markdown\n## Page 1\n\nHi\n```\n"); got != "## Page 1\n\nHi" {
		t.Errorf("unfence = %q", got)
	}
	if got := unfence("Some `code` here"); got != "Some `code` here" {
		t.Errorf("unfence changed unfenced text: %q", got)
	}
}

func TestRenumber(t *testing.T) {
	got := renumber("## Page 1\n\nA\n\n## Page 2\n\nB\n## Page 10 is a phrase", 25)
	want := "## Page 26\n\nA\n\n## Page 27\n\nB\n## Page 10 is a phrase"
	if got != want {
		t.Errorf("renumber = %q", got)
	}
}

func TestFenceMath(t *testing.T) {
	for _, c := range []struct{ name, in, want string }{
		{"spanning lines", "$$a,\\qquad\nb$$", "$$\na,\\qquad\nb\n$$"},
		{"in a list item", "- x\n\n  $$a,\n  b,\n  c$$\n\n  y", "- x\n\n  $$\n  a,\n  b,\n  c\n  $$\n\n  y"},
		{"starting a list item", "- $$a,\n  b$$", "- $$\n  a,\n  b\n  $$"},
		{"starting a numbered item", "12. $$a,\n    b$$", "12. $$\n    a,\n    b\n    $$"},
		{"closing on its own line", "$$a,\nb\n$$", "$$\na,\nb\n$$"},
		{"already fenced", "$$\na\nb\n$$", "$$\na\nb\n$$"},
		{"on one line", "$$a$$\n\n$$b$$", "$$a$$\n\n$$b$$"},
		{"inline, then one line", "$a$ and\n$$b$$", "$a$ and\n$$b$$"},
		{"with a blank line inside", "$$a\n\nb\n$$", "$$\na\n\nb\n$$"},
		{"with Windows line endings", "$$a,\r\nb$$\r\n", "$$\na,\nb\n$$\n"},
		{"in a quote", "> $$a\n> b$$", "> $$\n> a\n> b\n> $$"},
		{"in a code block", "```\n$$a\nb$$\n```\n$$c\nd$$", "```\n$$a\nb$$\n```\n$$\nc\nd\n$$"},
		{"in a code block holding another fence", "~~~\n```\n$$a\nb$$\n~~~", "~~~\n```\n$$a\nb$$\n~~~"},
		{"never closed", "$$a\nb", "$$\na\nb"},
		{"in a longer code fence", "````\n```\n$$a\nb$$\n````", "````\n```\n$$a\nb$$\n````"},
		{"in code opening a list item", "- ```text\n  $$a\n  b$$\n  ```", "- ```text\n  $$a\n  b$$\n  ```"},
		{"after a code fence that has closed", "```go\nx\n```\n\n$$a\nb$$", "```go\nx\n```\n\n$$\na\nb\n$$"},
		{"not closed in a quote, before code", "> $$a\n> b\n\n```\n$$c\nd$$\n```", "> $$\n> a\n> b\n\n```\n$$c\nd$$\n```"},
		{"not closed in a list, before more text", "- $$a\n  b\n\nText\n\n$$c\nd$$", "- $$\n  a\n  b\n\nText\n\n$$\nc\nd\n$$"},
		{"with longer delimiters", "$$$\nx\n$$$", "$$$\nx\n$$$"},
		{"closing with a longer delimiter", "$$\na\n$$$", "$$\na\n$$$"},
		{"each of two", "$$a\nb$$\n\n$$c\nd$$", "$$\na\nb\n$$\n\n$$\nc\nd\n$$"},
	} {
		if got := fenceMath(c.in); got != c.want {
			t.Errorf("%s: fenceMath(%q) = %q, want %q", c.name, c.in, got, c.want)
		}
	}
}

func TestLinkAssets(t *testing.T) {
	md := `![A](asset:img1) ![B](asset:missing) ![A again](asset:img1 "title") ![C](asset:crop2) ![D](https://x.test/d.png) ![Bare](img1 "title") ![Invented](crop9) ![Logo](logo) ![Path](d.png) ![Placeholder](crop? )`
	known := func(id string) bool { return id == "img1" || id == "crop2" }
	got, used := linkAssets(md, known)
	want := `![A](asset:img1)  ![A again](asset:img1 "title") ![C](asset:crop2) ![D](https://x.test/d.png) ![Bare](asset:img1 "title")    `
	if got != want {
		t.Errorf("linkAssets = %q", got)
	}
	if !reflect.DeepEqual(used, []string{"img1", "crop2"}) {
		t.Errorf("used = %v", used)
	}
	local := LocalAssets(got, func(id string) string { return "images/" + id + ".png" })
	if !strings.Contains(local, "![A again](images/img1.png)") {
		t.Errorf("LocalAssets = %q", local)
	}
}

func TestChunkUnits(t *testing.T) {
	slides := chunkUnits([]string{"a", "b", "c"}, 2)
	if !reflect.DeepEqual(slides, [][]string{{"a", "b"}, {"c"}}) {
		t.Errorf("by count = %q", slides)
	}
	long := strings.Repeat("x", 30_000)
	if doc := chunkUnits([]string{long, long, "end"}, 25); len(doc) != 2 {
		t.Errorf("by size = %d chunks", len(doc))
	}
	// One paragraph longer than a chunk is split, at a line break where it can be.
	huge := strings.Repeat("y", 30_000) + "\n" + strings.Repeat("z", 30_000)
	chunks := chunkUnits([]string{huge}, 25)
	if len(chunks) != 2 || chunks[0][0] != strings.Repeat("y", 30_000) {
		t.Errorf("oversized unit = %d chunks", len(chunks))
	}
}

func TestSplitText(t *testing.T) {
	// Never inside a character.
	for _, piece := range splitText(strings.Repeat("é", 50), 15) {
		if !utf8.ValidString(piece) || len(piece) > 15 {
			t.Errorf("piece %q", piece)
		}
	}
	if got := splitText("short", 15); !reflect.DeepEqual(got, []string{"short"}) {
		t.Errorf("splitText = %q", got)
	}
}
