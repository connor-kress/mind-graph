package transcribe

import (
	"maps"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

var (
	fence       = regexp.MustCompile("(?s)^\\s*```(?:markdown|md)?\\s*\n(.*?)\n```\\s*$")
	pageHeading = regexp.MustCompile(`(?m)^## Page (\d+)[ \t]*$`)
	assetImage  = regexp.MustCompile(`!\[([^\]]*)\]\(asset:([A-Za-z0-9_-]+)(?:\s+"[^"]*")?\)`)
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

// pageSections maps each page number to the text under its "## Page N" heading.
func pageSections(md string) map[int]string {
	sections := map[int]string{}
	locs := pageHeading.FindAllStringSubmatchIndex(md, -1)
	for i, loc := range locs {
		n, _ := strconv.Atoi(md[loc[2]:loc[3]])
		end := len(md)
		if i+1 < len(locs) {
			end = locs[i+1][0]
		}
		sections[n] += strings.TrimSpace(md[loc[1]:end])
	}
	return sections
}

// mergeFigures adds each page's figures after that page's text, which stays as transcribed.
// Figures for pages the text doesn't have are added at the end.
func mergeFigures(text, figures string) string {
	extra := pageSections(figures)
	if len(extra) == 0 {
		return text
	}
	var b strings.Builder
	locs := pageHeading.FindAllStringSubmatchIndex(text, -1)
	if len(locs) == 0 {
		b.WriteString(strings.TrimRight(text, "\n"))
	} else {
		b.WriteString(text[:locs[0][0]])
	}
	for i, loc := range locs {
		end := len(text)
		if i+1 < len(locs) {
			end = locs[i+1][0]
		}
		b.WriteString(strings.TrimRight(text[loc[0]:end], "\n"))
		n, _ := strconv.Atoi(text[loc[2]:loc[3]])
		if f := extra[n]; f != "" {
			b.WriteString("\n\n" + f)
		}
		delete(extra, n)
		b.WriteString("\n\n")
	}
	for _, n := range slices.Sorted(maps.Keys(extra)) {
		if f := extra[n]; f != "" {
			b.WriteString("## Page " + strconv.Itoa(n) + "\n\n" + f + "\n\n")
		}
	}
	return strings.TrimSpace(b.String()) + "\n"
}

// linkAssets keeps image links to known assets, removing any others, and
// returns the assets linked to, in order of first use.
func linkAssets(md string, known func(id string) bool) (string, []string) {
	var used []string
	seen := map[string]bool{}
	out := assetImage.ReplaceAllStringFunc(md, func(link string) string {
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
