package transcribe

import (
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

var (
	fence       = regexp.MustCompile("(?s)^\\s*```(?:markdown|md)?\\s*\n(.*?)\n```\\s*$")
	pageHeading = regexp.MustCompile(`(?m)^## Page (\d+)[ \t]*$`)
	assetImage  = regexp.MustCompile(`!\[([^\]]*)\]\(asset:([^\s)]+)(?:\s+"[^"]*")?\s*\)`)
	bareImage   = regexp.MustCompile(`(!\[[^\]]*\]\()([^\s):]+(?:\s+"[^"]*")?\s*\))`)
	// A line starting with $$, after any quote or list markers.
	mathStart = regexp.MustCompile(`^((?:[ \t]*>)*[ \t]*)((?:[-*+]|\d+[.)])[ \t]+)?\$\$(.*)$`)
	// A code fence, after any quote or list markers, and what follows it.
	codeFence = regexp.MustCompile("^(?:[ \\t]*>)*[ \\t]*(?:(?:[-*+]|\\d+[.)])[ \\t]+)?(`{3,}|~{3,})(.*)$")
)

// fenceMath puts display math that spans lines between $$ lines of their own.
// Otherwise the note's renderer takes what follows the opening $$ for the
// fence's metadata, losing it, and doesn't see the fence close. Code is left as
// it is, apart from indented code, which can't be told from math in a list
// without parsing the Markdown.
func fenceMath(md string) string {
	var out []string
	var code, indent string
	inMath := false
	for _, line := range strings.Split(strings.ReplaceAll(md, "\r\n", "\n"), "\n") {
		// Math ends with the quote or list it's in, even if it wasn't closed.
		if inMath && !inContainer(line, indent) {
			inMath = false
		}
		if m := codeFence.FindStringSubmatch(line); m != nil && !inMath {
			switch {
			case code == "":
				code = m[1]
			// It closes with at least as many of the same character, and nothing after.
			case m[1][0] == code[0] && len(m[1]) >= len(code) && strings.TrimSpace(m[2]) == "":
				code = ""
				out = append(out, line)
				continue
			}
		}
		switch {
		case code != "":
			out = append(out, line)
		case inMath:
			body, closed := strings.CutSuffix(strings.TrimRight(line, " \t"), "$$")
			if !closed {
				out = append(out, line)
				continue
			}
			inMath = false
			// Only delimiters, of any length, which already closes it.
			if strings.Trim(body, " \t>$") == "" {
				out = append(out, line)
				continue
			}
			out = append(out, body, indent+"$$")
		default:
			m := mathStart.FindStringSubmatch(line)
			// Longer delimiters already work, and are left as they are.
			if m == nil || strings.Contains(m[3], "$$") || strings.HasPrefix(m[3], "$") {
				out = append(out, line)
				continue
			}
			inMath, indent = true, m[1]+strings.Repeat(" ", len(m[2]))
			out = append(out, m[1]+m[2]+"$$")
			if first := strings.TrimSpace(m[3]); first != "" {
				out = append(out, indent+first)
			}
		}
	}
	return strings.Join(out, "\n")
}

// inContainer reports whether line is still within the quote or list that a
// fence indented by indent is in. Only a quote ends at a blank line.
func inContainer(line, indent string) bool {
	if strings.TrimSpace(line) == "" {
		return !strings.Contains(indent, ">")
	}
	return strings.HasPrefix(line, indent)
}

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
