// Package worker claims queued sources from Convex and transcribes them.
package worker

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/connor-kress/mind-graph/runner/internal/config"
	"github.com/connor-kress/mind-graph/runner/internal/convex"
	"github.com/connor-kress/mind-graph/runner/internal/openrouter"
	"github.com/connor-kress/mind-graph/runner/internal/transcribe"
)

// Transcriber is what the worker needs from transcribe.Transcriber, so tests can stand in for it.
type Transcriber interface {
	Transcribe(ctx context.Context, name, kind string, data []byte, dir string) (*transcribe.Result, error)
}

// Worker claims queued sources from Convex and transcribes them, as many at
// once as it's given. Convex limits how many each user has running.
type Worker struct {
	Convex      *convex.Client
	Transcriber Transcriber
	Config      config.Config
	// Where each job's files go while it runs. Empty uses the system's temporary directory.
	WorkDir string

	nudges chan struct{}
}

// Run works until ctx is cancelled or, if IdleExit is set, it has been idle that long.
func (w *Worker) Run(ctx context.Context) error {
	w.nudges = make(chan struct{}, 1)
	if w.Config.Listen != "" {
		listener, err := net.Listen("tcp", w.Config.Listen)
		if err != nil {
			return err
		}
		server := &http.Server{Handler: w.handler(), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 20 * time.Second}
		go func() {
			if err := server.Serve(listener); !errors.Is(err, http.ErrServerClosed) {
				slog.Error("nudge server stopped", "error", err)
			}
		}()
		defer server.Close()
		slog.Info("listening for nudges", "address", w.Config.Listen)
	}

	var tick <-chan time.Time
	if w.Config.PollInterval > 0 {
		ticker := time.NewTicker(w.Config.PollInterval)
		defer ticker.Stop()
		tick = ticker.C
	}
	var running, lastWork atomic.Int64
	lastWork.Store(time.Now().UnixNano())
	var jobs sync.WaitGroup
	// When shutting down, jobs still running give themselves back first.
	defer jobs.Wait()
	for {
		job, err := w.Convex.Claim(ctx)
		switch {
		case ctx.Err() != nil:
			if job != nil {
				w.release(ctx, job)
			}
			return nil
		case err != nil:
			slog.Warn("couldn't ask for work", "error", err)
		case job != nil:
			running.Add(1)
			jobs.Go(func() {
				w.process(ctx, job)
				lastWork.Store(time.Now().UnixNano())
				running.Add(-1)
				// Its user may have more waiting for this one to finish.
				w.wake()
			})
			// There may be more.
			continue
		}

		var idle <-chan time.Time
		if w.Config.IdleExit > 0 && running.Load() == 0 {
			left := w.Config.IdleExit - time.Since(time.Unix(0, lastWork.Load()))
			if left <= 0 {
				slog.Info("no work for a while; exiting", "idle", w.Config.IdleExit)
				return nil
			}
			idle = time.After(left)
		}
		select {
		case <-ctx.Done():
			return nil
		case <-tick:
		case <-w.nudges:
		case <-idle:
		}
	}
}

// wake has Run ask for work now rather than at its next poll.
func (w *Worker) wake() {
	select {
	case w.nudges <- struct{}{}:
	default:
	}
}

// handler takes signed nudges from Convex, so a runner that polls slowly starts promptly.
func (w *Worker) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(rw http.ResponseWriter, _ *http.Request) {
		rw.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST /nudge", func(rw http.ResponseWriter, r *http.Request) {
		// Checked before reading the body, so a request that can't be valid costs little.
		if !convex.PlausiblySigned(r, time.Now()) {
			http.Error(rw, "bad signature", http.StatusUnauthorized)
			return
		}
		const limit = 64 << 10
		body, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
		if err != nil || len(body) > limit || !convex.Verify(w.Config.RunnerSecret, r, body, time.Now()) {
			http.Error(rw, "bad signature", http.StatusUnauthorized)
			return
		}
		w.wake()
		rw.WriteHeader(http.StatusNoContent)
	})
	return mux
}

// errTimedOut ends a job that has run longer than JOB_TIMEOUT, e.g. on a PDF a tool hangs on.
var errTimedOut = errors.New("the job took too long")

func (w *Worker) process(ctx context.Context, job *convex.Job) {
	log := slog.With("source", job.SourceID, "name", job.Name)
	log.Info("transcribing", "kind", job.Kind, "bytes", job.Size)
	started := time.Now()

	jobCtx, spent := openrouter.WithSpending(ctx)
	jobCtx, cancel := context.WithCancelCause(jobCtx)
	defer cancel(nil)
	if w.Config.JobTimeout > 0 {
		var stop context.CancelFunc
		jobCtx, stop = context.WithTimeoutCause(jobCtx, w.Config.JobTimeout, errTimedOut)
		defer stop()
	}
	expires, err := w.confirmClaim(jobCtx, job)
	if ctx.Err() != nil {
		w.release(ctx, job)
		return
	} else if err != nil {
		// Another runner may have it by now, so it's left to its lease.
		log.Warn("couldn't confirm a claim that arrived late; leaving it", "error", err)
		return
	}
	beats := make(chan struct{})
	go func() {
		defer close(beats)
		w.heartbeat(jobCtx, cancel, job, expires)
	}()
	err = w.transcribe(jobCtx, job)
	cause := context.Cause(jobCtx)
	cancel(nil)
	<-beats

	attrs := []any{"seconds", time.Since(started).Round(time.Second).Seconds(), "cost_usd", spent.USD()}
	// The claim's last requests get time of their own, even when shutting down.
	finish, done := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer done()
	var user transcribe.UserError
	switch {
	case err == nil:
		log.Info("transcribed", attrs...)
		return
	case errors.Is(err, convex.ErrLost) || errors.Is(cause, convex.ErrLost):
		log.Warn("the claim was lost, e.g. the source was deleted; stopping", attrs...)
		return
	case ctx.Err() != nil:
		log.Info("shutting down; giving the job back", attrs...)
		w.release(ctx, job)
		return
	case errors.Is(cause, errTimedOut):
		log.Error("transcription took too long", attrs...)
		err = w.Convex.Fail(finish, job, "Transcription took too long. Try again, or try a shorter file.", false)
	case errors.As(err, &user):
		log.Info("can't transcribe this file", append(attrs, "reason", user.Error())...)
		err = w.Convex.Fail(finish, job, user.Error(), false)
	default:
		log.Error("transcription failed", append(attrs, "error", err)...)
		err = w.Convex.Fail(finish, job, "Couldn't transcribe this file. Try again.", false)
	}
	if err != nil && !errors.Is(err, convex.ErrLost) {
		log.Error("couldn't report the failure; the claim will run out instead", "error", err)
	}
}

// release gives a job back to the queue without using up one of its tries.
func (w *Worker) release(ctx context.Context, job *convex.Job) {
	finish, done := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer done()
	if err := w.Convex.Fail(finish, job, "", true); err != nil && !errors.Is(err, convex.ErrLost) {
		slog.Warn("couldn't give the job back; its claim will run out instead", "source", job.SourceID, "error", err)
	}
}

// confirmClaim returns when the claim is conservatively known to expire,
// counting from when it was asked for. One that arrived with less than half
// its lease left is renewed first, so no work starts on a claim that may be gone.
func (w *Worker) confirmClaim(ctx context.Context, job *convex.Job) (time.Time, error) {
	lease := time.Duration(job.LeaseMS) * time.Millisecond
	expires := job.Asked.Add(lease)
	if job.Asked.IsZero() {
		expires = time.Now().Add(lease)
	}
	left := time.Until(expires)
	if left >= lease/2 {
		return expires, nil
	}
	sent := time.Now()
	beat, done := context.WithTimeout(ctx, max(left, 0))
	defer done()
	if err := w.Convex.Heartbeat(beat, job); err != nil {
		return time.Time{}, err
	}
	return sent.Add(lease), nil
}

// heartbeat renews the claim until the job ends. It cancels the job if the
// claim is lost, or would run out before a renewal could be confirmed, so two
// runners never work on one source.
func (w *Worker) heartbeat(ctx context.Context, cancel context.CancelCauseFunc, job *convex.Job, expires time.Time) {
	lease := time.Duration(job.LeaseMS) * time.Millisecond
	every := max(lease/4, 10*time.Millisecond)
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		sent := time.Now()
		beat, done := context.WithTimeout(ctx, min(every, max(time.Until(expires), 0)))
		err := w.Convex.Heartbeat(beat, job)
		done()
		switch {
		case err == nil:
			expires = sent.Add(lease)
		case errors.Is(err, convex.ErrLost):
			cancel(convex.ErrLost)
			return
		case ctx.Err() != nil:
			return
		default:
			slog.Warn("heartbeat failed; trying again", "error", err)
		}
		if time.Until(expires) < every {
			slog.Error("couldn't renew the claim before it runs out; stopping")
			cancel(convex.ErrLost)
			return
		}
	}
}

func (w *Worker) transcribe(ctx context.Context, job *convex.Job) error {
	data, err := w.Convex.Download(ctx, job)
	if err != nil {
		return err
	}
	dir, err := os.MkdirTemp(w.WorkDir, "job-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	result, err := w.Transcriber.Transcribe(ctx, job.Name, job.Kind, data, dir)
	if err != nil {
		return err
	}
	markdownID, err := w.Convex.Upload(ctx, job, "text/markdown; charset=utf-8", []byte(result.Markdown))
	if err != nil {
		return err
	}
	assets := make([]convex.Asset, len(result.Assets))
	err = transcribe.ForEach(ctx, len(assets), w.Config.Parallel, func(ctx context.Context, i int) error {
		a := result.Assets[i]
		data, err := os.ReadFile(a.Path)
		if err != nil {
			return err
		}
		id, err := w.Convex.Upload(ctx, job, a.ContentType, data)
		assets[i] = convex.Asset{Name: a.ID, StorageID: id}
		return err
	})
	if err != nil {
		return err
	}
	return w.Convex.Complete(ctx, job, markdownID, result.Pages, assets)
}
