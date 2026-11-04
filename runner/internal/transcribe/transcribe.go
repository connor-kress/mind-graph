// Package transcribe turns PDF, Word and PowerPoint files into Markdown notes
// and the images they link to.
package transcribe

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
)

// Transcriber turns one kind of file into Markdown and the images it links to.
// It works in dir, which it may fill with intermediate files.
type Transcriber interface {
	Transcribe(ctx context.Context, name string, data []byte, dir string) (*Result, error)
}

// ByKind picks the transcriber for each kind of source, such as "pdf" or "docx".
type ByKind map[string]Transcriber

func (b ByKind) Transcribe(ctx context.Context, name, kind string, data []byte, dir string) (*Result, error) {
	t, ok := b[kind]
	if !ok {
		return nil, UserError(fmt.Sprintf("%s files can't be transcribed.", strings.ToUpper(kind)))
	}
	return t.Transcribe(ctx, name, data, dir)
}

// UserError is a reason a file can't be transcribed that the user can act on.
type UserError string

func (e UserError) Error() string { return string(e) }

// Result is a transcription. Its Markdown links to assets as asset:ID.
type Result struct {
	Markdown string
	// Pages or slides, if the file has them.
	Pages int
	// The assets the Markdown links to, in order of first use.
	Assets []*Asset
}

// Asset is an image found or cropped while transcribing, saved in the work directory.
type Asset struct {
	ID          string
	seq         int64
	Path        string
	ContentType string

	// Physical page, counting from 1 within its range.
	page   int
	width  int
	height int
	kind   string // "original" or "crop"
	// Where it's drawn on each page that shows it, from 0 to 1000, for originals.
	placements []placement
}

type placement struct {
	Page int        `json:"page"`
	Box  [4]float64 `json:"bbox"`
}

// Output tokens per text request.
const textMaxTokens = 32000

// forEach runs fn for 0 to n-1, at most parallel at once. The first error
// cancels the rest, and is returned.
func forEach(ctx context.Context, n, parallel int, fn func(ctx context.Context, i int) error) error {
	ctx, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)
	limit := make(chan struct{}, parallel)
	var wg sync.WaitGroup
	for i := range n {
		wg.Go(func() {
			select {
			case limit <- struct{}{}:
			case <-ctx.Done():
				return
			}
			defer func() { <-limit }()
			if ctx.Err() != nil {
				return
			}
			if err := fn(ctx, i); err != nil {
				cancel(err)
			}
		})
	}
	wg.Wait()
	if err := context.Cause(ctx); err != nil && !errors.Is(err, context.Canceled) {
		return err
	}
	return ctx.Err()
}
