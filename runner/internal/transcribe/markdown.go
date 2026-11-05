package transcribe

import (
	"fmt"
	"regexp"
	"slices"
	"strconv"
)

var (
	fence       = regexp.MustCompile("(?s)^\\s*```(?:markdown|md)?\\s*\n(.*?)\n```\\s*$")
	pageHeading = regexp.MustCompile(`(?m)^## Page (\d+)[ \t]*$`)
	assetImage  = regexp.MustCompile(`!\[([^\]]*)\]\(asset:([^\s)]+)(?:\s+"[^"]*")?\)`)
	bareImage   = regexp.MustCompile(`(!\[[^\]]*\]\()([^\s):]+(?:\s+"[^"]*")?\))`)
)

// unfence removes a code fence around the whole response, which the prompts ask the model not to add.
func unfence(md string) string {
	if m := fence.FindStringSubmatch(md); m != nil {
		return m[1]
	}
	return md
}

// renumber shifts "## Page N" headings by offset, for a range that starts after page 1.
func renumber(md string, offset int) string {
	if offset == 0 {
		return md
	}
	return pageHeading.ReplaceAllStringFunc(md, func(h string) string {
		n, _ := strconv.Atoi(pageHeading.FindStringSubmatch(h)[1])
		return "## Page " + strconv.Itoa(n+offset)
	})
}

// linkAssets keeps image links to known assets, removing any others, and
// returns the assets linked to, in order of first use. A link with no scheme is
// treated as an asset's, since the model can leave out the prefix and nothing
// else would resolve in a note.
func linkAssets(md string, known func(id string) bool) (string, []string) {
	var used []string
	seen := map[string]bool{}
	out := assetImage.ReplaceAllStringFunc(bareImage.ReplaceAllString(md, "${1}asset:$2"), func(link string) string {
		id := assetImage.FindStringSubmatch(link)[2]
		if !known(id) {
			return ""
		}
		if !seen[id] {
			seen[id] = true
			used = append(used, id)
		}
		return link
	})
	return out, used
}

// LocalAssets points asset links at files, for Markdown saved next to its images.
func LocalAssets(md string, path func(id string) string) string {
	return assetImage.ReplaceAllStringFunc(md, func(link string) string {
		m := assetImage.FindStringSubmatch(link)
		return "![" + m[1] + "](" + path(m[2]) + ")"
	})
}

// checkPages reports how md's "## Page N" headings differ from pages 1 to n,
// each once and in order.
func checkPages(md string, n int) error {
	var got []int
	for _, m := range pageHeading.FindAllStringSubmatch(md, -1) {
		p, _ := strconv.Atoi(m[1])
		got = append(got, p)
	}
	if len(got) > n {
		return fmt.Errorf("it has %d page headings, but only %d physical pages exist, so a page's slides all belong under its one heading", len(got), n)
	}
	var missing []int
	for p := 1; p <= n; p++ {
		if !slices.Contains(got, p) {
			missing = append(missing, p)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("pages %v are missing", missing)
	}
	for i, p := range got {
		if p != i+1 {
			return fmt.Errorf("the pages are repeated or out of order")
		}
	}
	return nil
}
