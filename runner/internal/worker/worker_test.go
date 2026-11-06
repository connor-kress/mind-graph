package worker

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/connor-kress/mind-graph/runner/internal/config"
	"github.com/connor-kress/mind-graph/runner/internal/convex"
	"github.com/connor-kress/mind-graph/runner/internal/openrouter"
	"github.com/connor-kress/mind-graph/runner/internal/transcribe"
)

func TestNudgesMustBeSigned(t *testing.T) {
	w := &Worker{Config: config.Config{RunnerSecret: "secret"}, nudges: make(chan struct{}, 1)}
	server := httptest.NewServer(w.handler())
	defer server.Close()
	nudge := func(secret string, at time.Time) int {
		ts := strconv.FormatInt(at.UnixMilli(), 10)
		req, _ := http.NewRequest("POST", server.URL+"/nudge", strings.NewReader("{}"))
		req.Header.Set("X-Runner-Timestamp", ts)
		req.Header.Set("X-Runner-Signature", convex.Sign(secret, ts, "POST", "/nudge", []byte("{}")))
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if code := nudge("wrong", time.Now()); code != http.StatusUnauthorized {
		t.Errorf("wrong secret: %d", code)
	}
	if code := nudge("secret", time.Now().Add(-10*time.Minute)); code != http.StatusUnauthorized {
		t.Errorf("stale: %d", code)
	}
	// Too large, though plausibly signed.
	ts := strconv.FormatInt(time.Now().UnixMilli(), 10)
	big := strings.Repeat("x", 65<<10)
	req, _ := http.NewRequest("POST", server.URL+"/nudge", strings.NewReader(big))
	req.Header.Set("X-Runner-Timestamp", ts)
	req.Header.Set("X-Runner-Signature", convex.Sign("secret", ts, "POST", "/nudge", []byte(big)))
	if resp, err := http.DefaultClient.Do(req); err != nil || resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("oversized: %v %v", resp, err)
	}
	select {
	case <-w.nudges:
		t.Error("a rejected nudge shouldn't wake the worker")
	default:
	}
	if code := nudge("secret", time.Now()); code != http.StatusNoContent {
		t.Errorf("signed: %d", code)
	}
	select {
	case <-w.nudges:
	default:
		t.Error("a signed nudge should wake the worker")
	}
}

// fakeConvex serves the runner endpoints, checking signatures, for one queued job.
type fakeConvex struct {
	t      *testing.T
	server *httptest.Server
	file   []byte
	// How long the job's claim lasts, in milliseconds.
	leaseMS int64
	// Whether claims are lost, as when the source was deleted.
	lost bool
	// Whether heartbeats find the claim lost.
	lostOnHeartbeat bool
	// How many jobs are queued, one if zero.
	jobs int
	// Whether a claim gets nothing, as when the user is at their limit. Optional.
	held func(claimed int) bool

	mu       sync.Mutex
	claimed  int
	uploads  map[string]string
	complete map[string]any
	failed   map[string]any
	// How many jobs have been completed or failed.
	completes, fails int
}

func newFakeConvex(t *testing.T, file []byte) *fakeConvex {
	f := &fakeConvex{t: t, file: file, uploads: map[string]string{}, leaseMS: 120_000}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /file", func(rw http.ResponseWriter, r *http.Request) { rw.Write(f.file) })
	mux.HandleFunc("POST /runner/{action}", func(rw http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if !convex.Verify("secret", r, body, time.Now()) {
			http.Error(rw, "bad signature", http.StatusUnauthorized)
			return
		}
		action := r.PathValue("action")
		in := map[string]any{"token": r.URL.Query().Get("token")}
		if action != "upload" {
			json.Unmarshal(body, &in)
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		if action != "claim" && (f.lost || !strings.HasPrefix(in["token"].(string), "token-") || action == "heartbeat" && f.lostOnHeartbeat) {
			http.Error(rw, "lost", http.StatusConflict)
			return
		}
		switch action {
		case "claim":
			var job any
			if f.claimed < max(f.jobs, 1) && (f.held == nil || !f.held(f.claimed)) {
				f.claimed++
				n := strconv.Itoa(f.claimed)
				job = convex.Job{SourceID: "source-" + n, Token: "token-" + n, Name: "Notes.pdf", Kind: "pdf",
					Size: int64(len(f.file)), FileURL: f.server.URL + "/file", LeaseMS: f.leaseMS}
			}
			json.NewEncoder(rw).Encode(map[string]any{"job": job})
		case "upload":
			id := "storage-" + strconv.Itoa(len(f.uploads)+1)
			f.uploads[id] = r.Header.Get("Content-Type") + ":" + string(body)
			json.NewEncoder(rw).Encode(map[string]string{"storageId": id})
		case "heartbeat":
			json.NewEncoder(rw).Encode(map[string]any{"expiresAt": 1})
		case "complete":
			f.complete = in
			f.completes++
			rw.Write([]byte("{}"))
		case "fail":
			f.failed = in
			f.fails++
			rw.Write([]byte("{}"))
		}
	})
	f.server = httptest.NewServer(mux)
	t.Cleanup(f.server.Close)
	return f
}

type fakeTranscriber func(ctx context.Context, dir string) (*transcribe.Result, error)

func (f fakeTranscriber) Transcribe(ctx context.Context, _, _ string, _ []byte, dir string) (*transcribe.Result, error) {
	return f(ctx, dir)
}

// runOnce has the worker take the fake's one job, then stop, or stop after stopAfter if it's set.
func runOnce(t *testing.T, f *fakeConvex, tr Transcriber, stopAfter ...time.Duration) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if len(stopAfter) > 0 {
		time.AfterFunc(stopAfter[0], cancel)
	}
	w := &Worker{
		Convex:      &convex.Client{SiteURL: f.server.URL, Secret: "secret", HTTP: http.DefaultClient},
		Transcriber: tr,
		Config:      config.Config{RunnerSecret: "secret", PollInterval: 10 * time.Millisecond, IdleExit: 50 * time.Millisecond, Parallel: 2},
		WorkDir:     t.TempDir(),
	}
	if err := w.Run(ctx); err != nil {
		t.Fatal(err)
	}
}

// untilCancelled is a transcription that only ends when it's cancelled.
var untilCancelled = fakeTranscriber(func(ctx context.Context, _ string) (*transcribe.Result, error) {
	<-ctx.Done()
	return nil, ctx.Err()
})

func TestWorkerStopsWhenAHeartbeatFindsTheClaimLost(t *testing.T) {
	f := newFakeConvex(t, []byte("%PDF"))
	f.leaseMS, f.lostOnHeartbeat = 80, true
	runOnce(t, f, untilCancelled)
	if f.complete != nil || f.failed != nil {
		t.Errorf("a lost claim shouldn't be finished: %v %v", f.complete, f.failed)
	}
}

func TestHeartbeatGivesUpBeforeAnUnrenewedClaimRunsOut(t *testing.T) {
	// Every heartbeat fails, but not because the claim was lost.
	down := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, _ *http.Request) {
		http.Error(rw, "unavailable", http.StatusServiceUnavailable)
	}))
	defer down.Close()
	w := &Worker{Convex: &convex.Client{SiteURL: down.URL, Secret: "secret", HTTP: http.DefaultClient}}
	ctx, cancel := context.WithCancelCause(context.Background())
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		w.heartbeat(ctx, cancel, &convex.Job{SourceID: "s", Token: "t", LeaseMS: 80}, time.Now().Add(80*time.Millisecond))
	}()
	select {
	case <-finished:
	case <-time.After(2 * time.Second):
		t.Fatal("heartbeat didn't give up")
	}
	if !errors.Is(context.Cause(ctx), convex.ErrLost) {
		t.Errorf("cause = %v", context.Cause(ctx))
	}
}

func TestWorkerGivesTheJobBackOnShutdown(t *testing.T) {
	f := newFakeConvex(t, []byte("%PDF"))
	runOnce(t, f, untilCancelled, 100*time.Millisecond)
	if f.failed["release"] != true {
		t.Errorf("failed with %v", f.failed)
	}
}

func TestWorkerUploadsTheResult(t *testing.T) {
	f := newFakeConvex(t, []byte("%PDF"))
	runOnce(t, f, fakeTranscriber(func(_ context.Context, dir string) (*transcribe.Result, error) {
		path := filepath.Join(dir, "img1.png")
		os.WriteFile(path, []byte("png"), 0o600)
		return &transcribe.Result{
			Markdown: "## Page 1\n\n![A](asset:img1)\n",
			Pages:    1,
			Assets:   []*transcribe.Asset{{ID: "img1", Path: path, ContentType: "image/png"}},
		}, nil
	}))
	if f.complete == nil {
		t.Fatalf("not completed; failed with %v", f.failed)
	}
	if f.uploads[f.complete["markdownId"].(string)] != "text/markdown; charset=utf-8:## Page 1\n\n![A](asset:img1)\n" {
		t.Errorf("markdown upload: %v", f.uploads)
	}
	assets := f.complete["assets"].([]any)
	if len(assets) != 1 || assets[0].(map[string]any)["name"] != "img1" {
		t.Errorf("assets: %v", assets)
	}
	if f.uploads[assets[0].(map[string]any)["storageId"].(string)] != "image/png:png" {
		t.Errorf("image upload: %v", f.uploads)
	}
	if f.complete["pageCount"] != 1.0 {
		t.Errorf("pageCount: %v", f.complete["pageCount"])
	}
}

func TestWorkerRunsEveryJobItIsGivenAtOnce(t *testing.T) {
	f := newFakeConvex(t, []byte("%PDF"))
	f.jobs = 5
	var started sync.WaitGroup
	started.Add(f.jobs)
	runOnce(t, f, fakeTranscriber(func(ctx context.Context, _ string) (*transcribe.Result, error) {
		// None finishes until all have started, which can't happen one at a time.
		started.Done()
		all := make(chan struct{})
		go func() { started.Wait(); close(all) }()
		select {
		case <-all:
			return &transcribe.Result{Markdown: "# Notes\n"}, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}))
	if f.completes != f.jobs || f.fails != 0 {
		t.Errorf("%d of %d completed, %d failed", f.completes, f.jobs, f.fails)
	}
}

func TestWorkerAsksForMoreWhenAJobFinishes(t *testing.T) {
	f := newFakeConvex(t, []byte("%PDF"))
	f.jobs = 2
	// The second is held back until the first is done, as Convex does for a user at their limit.
	f.held = func(claimed int) bool { return claimed == 1 && f.completes == 0 }
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	second := make(chan struct{})
	var calls atomic.Int64
	w := &Worker{
		Convex: &convex.Client{SiteURL: f.server.URL, Secret: "secret", HTTP: http.DefaultClient},
		Transcriber: fakeTranscriber(func(context.Context, string) (*transcribe.Result, error) {
			if calls.Add(1) == 2 {
				close(second)
			}
			return &transcribe.Result{Markdown: "# Notes\n"}, nil
		}),
		// Far longer than the test, so only the first job's finishing can ask again.
		Config:  config.Config{RunnerSecret: "secret", PollInterval: time.Hour, Parallel: 2},
		WorkDir: t.TempDir(),
	}
	done := make(chan error)
	go func() { done <- w.Run(ctx) }()
	select {
	case <-second:
	case <-ctx.Done():
		t.Error("the second job wasn't claimed when the first finished")
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestWorkerDoesntExitWhileAJobIsRunning(t *testing.T) {
	f := newFakeConvex(t, []byte("%PDF"))
	// Runs for longer than the idle timeout in runOnce.
	runOnce(t, f, fakeTranscriber(func(ctx context.Context, _ string) (*transcribe.Result, error) {
		select {
		case <-time.After(200 * time.Millisecond):
			return &transcribe.Result{Markdown: "# Notes\n"}, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}))
	if f.completes != 1 {
		t.Errorf("%d completed, failed with %v", f.completes, f.failed)
	}
}

func TestWorkerGivesEveryJobBackOnShutdown(t *testing.T) {
	f := newFakeConvex(t, []byte("%PDF"))
	f.jobs = 3
	runOnce(t, f, untilCancelled, 100*time.Millisecond)
	if f.fails != 3 || f.failed["release"] != true {
		t.Errorf("%d given back: %v", f.fails, f.failed)
	}
}

func TestEachJobLogsOnlyWhatItCost(t *testing.T) {
	// Two jobs at once, with a request of their own, each seeing its own total.
	ai := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		rw.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"cost":0.25}}`))
	}))
	defer ai.Close()
	client := &openrouter.Client{URL: ai.URL, HTTP: http.DefaultClient}
	var wg sync.WaitGroup
	for range 2 {
		wg.Go(func() {
			ctx, spent := openrouter.WithSpending(context.Background())
			if _, err := client.Complete(ctx, openrouter.Request{}); err != nil {
				t.Error(err)
			}
			if spent.USD() != 0.25 {
				t.Errorf("spent %v", spent.USD())
			}
		})
	}
	wg.Wait()
}

func TestWorkerReportsWhyAFileCantBeTranscribed(t *testing.T) {
	f := newFakeConvex(t, []byte("%PDF"))
	runOnce(t, f, fakeTranscriber(func(context.Context, string) (*transcribe.Result, error) {
		return nil, transcribe.UserError("This PDF has 80 pages.")
	}))
	if f.failed["error"] != "This PDF has 80 pages." || f.failed["release"] != false {
		t.Errorf("failed with %v", f.failed)
	}
}

func TestWorkerHidesInternalErrors(t *testing.T) {
	f := newFakeConvex(t, []byte("%PDF"))
	runOnce(t, f, fakeTranscriber(func(context.Context, string) (*transcribe.Result, error) {
		return nil, io.ErrUnexpectedEOF
	}))
	if f.failed["error"] != "Couldn't transcribe this file. Try again." {
		t.Errorf("failed with %v", f.failed)
	}
}

func TestWorkerStopsWhenTheClaimIsLost(t *testing.T) {
	f := newFakeConvex(t, []byte("%PDF"))
	f.lost = true
	runOnce(t, f, fakeTranscriber(func(context.Context, string) (*transcribe.Result, error) {
		return &transcribe.Result{Markdown: "# Notes\n"}, nil
	}))
	if f.complete != nil || f.failed != nil {
		t.Errorf("a lost claim shouldn't be finished: %v %v", f.complete, f.failed)
	}
}

func TestWorkerFailsAJobThatTakesTooLong(t *testing.T) {
	f := newFakeConvex(t, []byte("%PDF"))
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	w := &Worker{
		Convex:      &convex.Client{SiteURL: f.server.URL, Secret: "secret", HTTP: http.DefaultClient},
		Transcriber: untilCancelled,
		Config:      config.Config{RunnerSecret: "secret", PollInterval: 10 * time.Millisecond, IdleExit: 50 * time.Millisecond, JobTimeout: 50 * time.Millisecond, Parallel: 2},
		WorkDir:     t.TempDir(),
	}
	if err := w.Run(ctx); err != nil {
		t.Fatal(err)
	}
	if msg, _ := f.failed["error"].(string); !strings.Contains(msg, "too long") || f.failed["release"] != false {
		t.Errorf("failed with %v", f.failed)
	}
}

func TestWorkerReportsAListenerThatCantStart(t *testing.T) {
	taken, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer taken.Close()
	w := &Worker{Config: config.Config{Listen: taken.Addr().String()}}
	if err := w.Run(context.Background()); err == nil {
		t.Error("expected an error")
	}
}

func TestALateClaimIsConfirmedBeforeWorkStarts(t *testing.T) {
	var beats atomic.Int64
	slow := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		beats.Add(1)
		select {
		case <-slow:
		case <-r.Context().Done():
		}
	}))
	defer server.Close()
	// Before the server closes, which waits for its handlers.
	defer close(slow)
	w := &Worker{Convex: &convex.Client{SiteURL: server.URL, Secret: "secret", HTTP: http.DefaultClient}}
	// Asked for most of a lease ago; the renewal doesn't come back before the rest runs out.
	job := &convex.Job{SourceID: "s", Token: "t", LeaseMS: 400, Asked: time.Now().Add(-300 * time.Millisecond)}
	started := time.Now()
	if _, err := w.confirmClaim(context.Background(), job); err == nil {
		t.Error("expected an error")
	}
	if beats.Load() != 1 || time.Since(started) > 300*time.Millisecond {
		t.Errorf("%d heartbeats in %v", beats.Load(), time.Since(started))
	}
	// A renewal that comes back counts from when it was sent.
	ok := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, _ *http.Request) {
		rw.Write([]byte(`{"expiresAt":1}`))
	}))
	defer ok.Close()
	renewing := &Worker{Convex: &convex.Client{SiteURL: ok.URL, Secret: "secret", HTTP: http.DefaultClient}}
	job.Asked = time.Now().Add(-300 * time.Millisecond)
	if expires, err := renewing.confirmClaim(context.Background(), job); err != nil || time.Until(expires) < 300*time.Millisecond {
		t.Errorf("confirmClaim = %v, %v", time.Until(expires), err)
	}
	// One that arrived promptly isn't renewed first.
	job.Asked = time.Now()
	if _, err := w.confirmClaim(context.Background(), job); err != nil || beats.Load() != 1 {
		t.Errorf("err = %v after %d heartbeats", err, beats.Load())
	}
}
