package transcribe

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/connor-kress/mind-graph/runner/internal/config"
	"github.com/connor-kress/mind-graph/runner/internal/office"
	"github.com/connor-kress/mind-graph/runner/internal/openrouter"
)

// Word transcribes a Word document's text. Its images aren't kept.
type Word struct {
	Config config.Config
	AI     *openrouter.Client
	// Turns the document's extracted text into Markdown.
	Prompt string
}

func (t *Word) Transcribe(ctx context.Context, _ string, data []byte, _ string) (*Result, error) {
	paragraphs, err := office.DocumentText(data)
	if errors.Is(err, office.ErrTooMuchText) {
		return nil, errTooMuchText
	} else if err != nil {
		slog.Warn("couldn't read the document", "error", err)
		return nil, errUnreadable
	}
	md, err := formatUnits(ctx, t.AI, t.Config, t.Prompt, paragraphs)
	if err != nil {
		return nil, err
	}
	return &Result{Markdown: md}, nil
}

// Slides transcribes a PowerPoint presentation's slides and speaker notes. Its images aren't kept.
type Slides struct {
	Config config.Config
	AI     *openrouter.Client
	// Turns the slides' extracted text into Markdown.
	Prompt string
}

func (t *Slides) Transcribe(ctx context.Context, _ string, data []byte, _ string) (*Result, error) {
	slides, err := office.SlidesText(data, t.Config.MaxPages)
	var tooMany office.TooManySlidesError
	if errors.As(err, &tooMany) {
		return nil, UserError(fmt.Sprintf("This presentation has %d slides. Presentations of up to %d slides can be transcribed.", int(tooMany), t.Config.MaxPages))
	} else if errors.Is(err, office.ErrTooMuchText) {
		return nil, errTooMuchText
	} else if err != nil {
		slog.Warn("couldn't read the presentation", "error", err)
		return nil, errUnreadable
	}
	for i, s := range slides {
		slides[i] = "## Slide " + strconv.Itoa(i+1) + "\n\n" + s
	}
	md, err := formatUnits(ctx, t.AI, t.Config, t.Prompt, slides)
	if err != nil {
		return nil, err
	}
	return &Result{Markdown: md, Pages: len(slides)}, nil
}

var (
	errTooMuchText = UserError("This file has too much text to transcribe. Try splitting it into smaller files.")
	errUnreadable  = UserError("Couldn't read this file. Try saving it again, or export it as a PDF.")
)

// formatUnits has the model turn slides or paragraphs into Markdown, a chunk at a time.
func formatUnits(ctx context.Context, ai *openrouter.Client, cfg config.Config, prompt string, units []string) (string, error) {
	chunks := chunkUnits(units, cfg.RangePages)
	if len(chunks) == 0 {
		return "", UserError("This file has no text to transcribe.")
	}
	out := make([]string, len(chunks))
	err := ForEach(ctx, len(chunks), cfg.Parallel, func(ctx context.Context, i int) error {
		var err error
		out[i], err = formatText(ctx, ai, prompt, chunks[i])
		return err
	})
	if err != nil {
		return "", err
	}
	// Nothing to link to, so any links the model made anyway are dropped.
	md, _ := linkAssets(fenceMath(strings.Join(out, "\n\n"))+"\n", func(string) bool { return false })
	return md, nil
}

// formatText has the model turn extracted text into Markdown, splitting it if the response would be too long.
func formatText(ctx context.Context, ai *openrouter.Client, prompt string, units []string) (string, error) {
	c, err := ai.Complete(ctx, openrouter.Request{
		MaxTokens: textMaxTokens,
		Messages:  []openrouter.Message{{Role: "user", Content: prompt + "\n\n---\n\n" + strings.Join(units, "\n\n")}},
	})
	if errors.Is(err, openrouter.ErrTooLong) && len(units) == 1 && len(units[0]) > minSplitChars {
		units = splitText(units[0], len(units[0])/2+1)
	}
	if errors.Is(err, openrouter.ErrTooLong) && len(units) > 1 {
		a, err := formatText(ctx, ai, prompt, units[:len(units)/2])
		if err != nil {
			return "", err
		}
		b, err := formatText(ctx, ai, prompt, units[len(units)/2:])
		return a + "\n\n" + b, err
	} else if err != nil {
		return "", err
	}
	text := strings.TrimSpace(unfence(c.Message.Text()))
	if text == "" {
		return "", fmt.Errorf("empty transcription (finish reason %q)", c.FinishReason)
	}
	return text, nil
}

// Characters of extracted text per request.
const maxChunkChars = 40_000

// Text shorter than this whose response is still cut off isn't split further.
const minSplitChars = 2_000

// chunkUnits groups slides or paragraphs into requests of at most perChunk
// units and maxChunkChars characters, splitting any unit that's too long alone.
func chunkUnits(units []string, perChunk int) [][]string {
	var chunks [][]string
	var chunk []string
	size := 0
	for _, unit := range units {
		for _, piece := range splitText(unit, maxChunkChars) {
			if len(chunk) > 0 && (len(chunk) == perChunk || size+len(piece) > maxChunkChars) {
				chunks = append(chunks, chunk)
				chunk, size = nil, 0
			}
			chunk = append(chunk, piece)
			size += len(piece)
		}
	}
	if len(chunk) > 0 {
		chunks = append(chunks, chunk)
	}
	return chunks
}

// splitText cuts text into pieces of at most limit bytes, at line breaks or
// spaces where it can, and never inside a character.
func splitText(text string, limit int) []string {
	var pieces []string
	for len(text) > limit {
		cut := strings.LastIndexByte(text[:limit], '\n')
		if cut <= 0 {
			cut = strings.LastIndexByte(text[:limit], ' ')
		}
		if cut <= 0 {
			cut = limit
			for cut > 0 && !utf8.RuneStart(text[cut]) {
				cut--
			}
		}
		pieces = append(pieces, text[:cut])
		text = strings.TrimLeft(text[cut:], "\n ")
	}
	if strings.TrimSpace(text) != "" {
		pieces = append(pieces, text)
	}
	return pieces
}
