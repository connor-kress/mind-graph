package openrouter

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
