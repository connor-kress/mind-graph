package convex

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSignMatchesConvex(t *testing.T) {
	// The same vector is in tests/runner.test.ts.
	got := Sign("secret", "1700000000000", "POST", "/runner/claim", []byte(`{"a":1}`))
	if want := "5bd32f63b6def04edb8516178f00b246a3dd53a79b3163179b445debb2430b59"; got != want {
		t.Fatalf("Sign = %s, want %s", got, want)
	}
}

func TestDownloadRefusesAnOversizedFile(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, _ *http.Request) {
		rw.Write([]byte("%PDF"))
	}))
	defer server.Close()
	c := &Client{HTTP: http.DefaultClient}
	if _, err := c.Download(context.Background(), &Job{FileURL: server.URL, Size: 2}); err == nil {
		t.Error("expected an error for a file larger than its size")
	}
}
