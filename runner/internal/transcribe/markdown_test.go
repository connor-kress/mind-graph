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

func TestMergeFigures(t *testing.T) {
	text := "## Page 1\n\nIntro.\n\n## Page 2\n\nBody.\n"
	figures := "## Page 2\n\n![Cell](asset:img1)\n\n## Page 3\n\n![Late](asset:img2)\n## Page 1\n"
	got := mergeFigures(text, figures)
	want := "## Page 1\n\nIntro.\n\n## Page 2\n\nBody.\n\n![Cell](asset:img1)\n\n## Page 3\n\n![Late](asset:img2)\n"
	if got != want {
		t.Errorf("mergeFigures =\n%q\nwant\n%q", got, want)
	}
	if got := mergeFigures(text, "## Page 0\n\nOdd."); got != text+"\n## Page 0\n\nOdd.\n" {
		t.Errorf("a page the text doesn't have should go at the end: %q", got)
	}
	if got := mergeFigures(text, "No pages here."); got != text {
		t.Errorf("figures without pages should be ignored: %q", got)
	}
}

func TestLinkAssets(t *testing.T) {
	md := `![A](asset:img1) ![B](asset:missing) ![A again](asset:img1 "title") ![C](asset:crop2) ![D](https://x.test/d.png)`
	got, used := linkAssets(md, func(id string) bool { return id != "missing" })
	if strings.Contains(got, "missing") || !strings.Contains(got, "https://x.test/d.png") {
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
