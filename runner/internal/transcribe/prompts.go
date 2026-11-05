package transcribe

import (
	"embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

//go:embed prompts
var builtInPrompts embed.FS

// Prompts are built in, but any file in PROMPTS_DIR replaces its built-in copy.
type Prompts struct {
	// Transcribes a PDF's pages, text and figures, with Tools.
	PDF   string
	Tools json.RawMessage
	// Formats text extracted from a presentation or a Word document.
	Slides   string
	Document string
}

func LoadPrompts(dir string) (Prompts, error) {
	read := func(name string) (string, error) {
		if dir != "" {
			data, err := os.ReadFile(filepath.Join(dir, name))
			if err == nil {
				return strings.TrimSpace(string(data)), nil
			} else if !os.IsNotExist(err) {
				return "", err
			}
		}
		data, err := builtInPrompts.ReadFile("prompts/" + name)
		return strings.TrimSpace(string(data)), err
	}
	var p Prompts
	var tools string
	for name, dst := range map[string]*string{
		"pdf.txt":      &p.PDF,
		"tools.json":   &tools,
		"slides.txt":   &p.Slides,
		"document.txt": &p.Document,
	} {
		var err error
		if *dst, err = read(name); err != nil {
			return p, err
		}
	}
	if !json.Valid([]byte(tools)) {
		return p, fmt.Errorf("tools.json isn't valid JSON")
	}
	p.Tools = json.RawMessage(tools)
	return p, nil
}
