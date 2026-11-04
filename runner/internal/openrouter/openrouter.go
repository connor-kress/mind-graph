// Package openrouter sends chat completions through OpenRouter.
package openrouter

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

// Client sends chat completions, retrying ones that fail for reasons that may pass.
type Client struct {
	URL   string
	Key   string
	Model string
	HTTP  *http.Client

	mu   sync.Mutex
	cost float64
}

type Message struct {
	Role string `json:"role"`
	// A string, or []Part.
	Content    any        `json:"content,omitempty"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
}

type Part struct {
	Type     string    `json:"type"`
	Text     string    `json:"text,omitempty"`
	ImageURL *imageURL `json:"image_url,omitempty"`
	File     *filePart `json:"file,omitempty"`
}

type imageURL struct {
	URL    string `json:"url"`
	Detail string `json:"detail,omitempty"`
}

type filePart struct {
	Filename string `json:"filename"`
	FileData string `json:"file_data"`
}

type ToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

func TextPart(text string) Part { return Part{Type: "text", Text: text} }

func ImagePart(contentType string, data []byte) Part {
	url := "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(data)
	return Part{Type: "image_url", ImageURL: &imageURL{URL: url, Detail: "high"}}
}

func PDFPart(name string, data []byte) Part {
	url := "data:application/pdf;base64," + base64.StdEncoding.EncodeToString(data)
	return Part{Type: "file", File: &filePart{Filename: name, FileData: url}}
}

type Request struct {
	MaxTokens int
	Messages  []Message
	// Tools as JSON, or nil for none.
	Tools json.RawMessage
	// Whether the messages include a PDF, which the model reads natively.
	PDF bool
}

type Completion struct {
	Message      Message
	FinishReason string
}

// ErrTooLong means the model ran out of output tokens before it finished.
var ErrTooLong = errors.New("the response was cut off")

func (o *Client) Complete(ctx context.Context, r Request) (Completion, error) {
	body := map[string]any{
		"model":       o.Model,
		"max_tokens":  r.MaxTokens,
		"temperature": 0,
		"reasoning":   map[string]any{"effort": "none"},
		"messages":    r.Messages,
	}
	if r.PDF {
		body["plugins"] = []any{map[string]any{"id": "file-parser", "pdf": map[string]any{"engine": "native"}}}
	}
	if r.Tools != nil {
		body["tools"] = r.Tools
		body["tool_choice"] = "auto"
		body["parallel_tool_calls"] = true
	}
	data, err := json.Marshal(body)
	if err != nil {
		return Completion{}, err
	}
	var last error
	for attempt, wait := range []time.Duration{0, 5 * time.Second, 30 * time.Second} {
		if attempt > 0 {
			slog.Warn("retrying OpenRouter", "error", last, "in", wait)
			select {
			case <-ctx.Done():
				return Completion{}, ctx.Err()
			case <-time.After(wait):
			}
		}
		var retry bool
		var c Completion
		c, retry, last = o.once(ctx, data)
		if last == nil || !retry {
			return c, last
		}
	}
	return Completion{}, last
}

func (o *Client) once(ctx context.Context, body []byte) (c Completion, retry bool, err error) {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, o.URL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return c, false, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+o.Key)
	resp, err := o.HTTP.Do(req)
	if err != nil {
		return c, ctx.Err() == nil || errors.Is(err, context.DeadlineExceeded), err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return c, true, err
	}
	var out struct {
		Choices []struct {
			Message      Message `json:"message"`
			FinishReason string  `json:"finish_reason"`
		} `json:"choices"`
		Usage struct {
			Cost float64 `json:"cost"`
		} `json:"usage"`
		Error *struct {
			Code    any    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return c, resp.StatusCode >= 500, fmt.Errorf("OpenRouter: %s: unexpected response", resp.Status)
	}
	o.mu.Lock()
	o.cost += out.Usage.Cost
	o.mu.Unlock()
	if out.Error != nil || resp.StatusCode != http.StatusOK || len(out.Choices) == 0 {
		message := resp.Status
		if out.Error != nil {
			message = fmt.Sprintf("%s: %v %s", resp.Status, out.Error.Code, out.Error.Message)
		}
		retry = resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 || resp.StatusCode == http.StatusOK
		return c, retry, fmt.Errorf("OpenRouter: %s", message)
	}
	choice := out.Choices[0]
	c = Completion{Message: choice.Message, FinishReason: choice.FinishReason}
	switch choice.FinishReason {
	case "stop", "tool_calls", "":
		return c, false, nil
	case "length":
		return c, false, ErrTooLong
	}
	// E.g. a content filter or a provider error, with whatever was produced before it.
	return c, false, fmt.Errorf("OpenRouter: the response ended with %q", choice.FinishReason)
}

// Cost is what the requests so far have cost, in US dollars, as OpenRouter reports it.
func (o *Client) Cost() float64 {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.cost
}

// Text is a message's content as text.
func (m Message) Text() string {
	if s, ok := m.Content.(string); ok {
		return s
	}
	return ""
}
