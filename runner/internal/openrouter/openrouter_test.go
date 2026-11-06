package openrouter

import (
	"bytes"
	"context"
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
