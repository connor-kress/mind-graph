package openrouter

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestUnexpectedFinishReasonIsAnError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, _ *http.Request) {
		rw.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"Some of it"},"finish_reason":"content_filter"}]}`))
	}))
	defer server.Close()
	c := &Client{URL: server.URL, HTTP: server.Client()}
	_, err := c.Complete(context.Background(), Request{Messages: []Message{{Role: "user", Content: "Hi"}}})
	if err == nil || !strings.Contains(err.Error(), "content_filter") {
		t.Errorf("err = %v", err)
	}
}

func TestAJobThatEndsDuringAResponseIsNotRetried(t *testing.T) {
	var requests atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		rw.WriteHeader(http.StatusOK)
		rw.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer server.Close()
	var logs bytes.Buffer
	defer slog.SetDefault(slog.Default())
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	for name, ended := range map[string]func() (context.Context, context.CancelFunc){
		"cancelled": func() (context.Context, context.CancelFunc) {
			ctx, cancel := context.WithCancel(context.Background())
			time.AfterFunc(50*time.Millisecond, cancel)
			return ctx, cancel
		},
		"timed out": func() (context.Context, context.CancelFunc) {
			return context.WithTimeout(context.Background(), 50*time.Millisecond)
		},
	} {
		ctx, cancel := ended()
		c := &Client{URL: server.URL, HTTP: http.DefaultClient}
		if _, err := c.Complete(ctx, Request{}); err == nil {
			t.Errorf("%s: expected an error", name)
		}
		cancel()
	}
	if strings.Contains(logs.String(), "retrying") || requests.Load() != 2 {
		t.Errorf("%d requests, logged: %s", requests.Load(), logs.String())
	}
}

func TestRequestBodyIsValidJSON(t *testing.T) {
	var got map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Error(err)
		}
		rw.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}`))
	}))
	defer server.Close()
	c := &Client{URL: server.URL, Model: "m", HTTP: http.DefaultClient}
	_, err := c.Complete(context.Background(), Request{MaxTokens: 5, Messages: []Message{
		{Role: "user", Content: "Hi"},
		{Role: "user", Content: []Part{TextPart("Look"), ImagePart("image/png", []byte("x"))}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	messages, _ := got["messages"].([]any)
	if got["model"] != "m" || got["max_tokens"] != 5.0 || len(messages) != 2 {
		t.Errorf("body = %v", got)
	}
	// Without tools or a PDF, those settings aren't sent.
	if _, ok := got["tools"]; ok {
		t.Errorf("tools: %v", got["tools"])
	}
}

func TestARedirectSendsTheBodyAgain(t *testing.T) {
	var got string
	mux := http.NewServeMux()
	mux.HandleFunc("/old/chat/completions", func(rw http.ResponseWriter, r *http.Request) {
		http.Redirect(rw, r, "/new/chat/completions", http.StatusTemporaryRedirect)
	})
	mux.HandleFunc("/new/chat/completions", func(rw http.ResponseWriter, r *http.Request) {
		data, _ := io.ReadAll(r.Body)
		got = string(data)
		rw.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}`))
	})
	server := httptest.NewServer(mux)
	defer server.Close()
	c := &Client{URL: server.URL + "/old", Model: "m", HTTP: http.DefaultClient}
	if _, err := c.Complete(context.Background(), Request{Messages: []Message{{Role: "user", Content: "Hi"}}}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, `"Hi"`) {
		t.Errorf("body = %q", got)
	}
}

// noRead answers without reading or closing the request's body, or a replay of it.
type noRead struct{ bodies *[]io.Reader }

func (n noRead) RoundTrip(r *http.Request) (*http.Response, error) {
	replay, err := r.GetBody()
	if err != nil {
		return nil, err
	}
	*n.bodies = append(*n.bodies, r.Body, replay)
	return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(
		`{"choices":[{"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}`))}, nil
}

func TestABodyNobodyReadsEndsWithTheRequest(t *testing.T) {
	var bodies []io.Reader
	c := &Client{URL: "http://model.test", Model: "m", HTTP: &http.Client{Transport: noRead{&bodies}}}
	if _, err := c.Complete(context.Background(), Request{Messages: []Message{{Role: "user", Content: "Hi"}}}); err != nil {
		t.Fatal(err)
	}
	if len(bodies) != 2 {
		t.Fatalf("%d bodies", len(bodies))
	}
	// Each is closed by the time the request has ended, with nothing having read
	// it, so its writer has stopped. Reading any sooner would let the writer finish.
	time.Sleep(100 * time.Millisecond)
	for i, body := range bodies {
		if _, err := body.Read(make([]byte, 1)); !errors.Is(err, io.ErrClosedPipe) {
			t.Errorf("body %d is still open: %v", i, err)
		}
	}
}
