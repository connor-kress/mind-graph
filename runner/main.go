// Command runner transcribes Mind Graph's source files into Markdown notes.
//
//	runner [run]                       work on sources queued in Convex
//	runner transcribe [-o DIR] FILE    transcribe a local file, e.g. to tune the prompts
//
// Settings come from the environment and .env.local; see .env.example.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/connor-kress/mind-graph/runner/internal/config"
	"github.com/connor-kress/mind-graph/runner/internal/convex"
	"github.com/connor-kress/mind-graph/runner/internal/openrouter"
	"github.com/connor-kress/mind-graph/runner/internal/pdf"
	"github.com/connor-kress/mind-graph/runner/internal/transcribe"
	"github.com/connor-kress/mind-graph/runner/internal/worker"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))
	envFile := flag.String("env", ".env.local", "file of settings to load, if it exists")
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "usage:\n  runner [-env FILE] [run]\n  runner [-env FILE] transcribe [-o DIR] FILE\n")
		flag.PrintDefaults()
	}
	flag.Parse()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	var err error
	switch args := flag.Args(); {
	case len(args) == 0 || args[0] == "run" && len(args) == 1:
		err = runWorker(ctx, *envFile)
	case args[0] == "transcribe":
		err = transcribeFile(ctx, *envFile, args[1:])
	default:
		flag.Usage()
		os.Exit(2)
	}
	if err != nil {
		slog.Error(err.Error())
		os.Exit(1)
	}
}

func setup(envFile string) (config.Config, transcribe.ByKind, error) {
	cfg, err := config.Load(envFile)
	if err != nil {
		return cfg, nil, err
	}
	prompts, err := transcribe.LoadPrompts(cfg.PromptsDir)
	if err != nil {
		return cfg, nil, err
	}
	tool, err := pdf.New(cfg.PDFTool)
	if err != nil {
		return cfg, nil, err
	}
	ai := &openrouter.Client{URL: cfg.OpenRouterURL, Key: cfg.OpenRouterKey, Model: cfg.OpenRouterModel, HTTP: &http.Client{}}
	return cfg, transcribe.ByKind{
		"pdf":  &transcribe.PDF{Config: cfg, AI: ai, Tool: tool, Prompts: prompts},
		"docx": &transcribe.Word{Config: cfg, AI: ai, Prompt: prompts.Document},
		"pptx": &transcribe.Slides{Config: cfg, AI: ai, Prompt: prompts.Slides},
	}, nil
}

func runWorker(ctx context.Context, envFile string) error {
	cfg, t, err := setup(envFile)
	if err != nil {
		return err
	}
	if err := cfg.CheckConvex(); err != nil {
		return err
	}
	client := &convex.Client{SiteURL: cfg.ConvexSiteURL, Secret: cfg.RunnerSecret, HTTP: &http.Client{Timeout: 2 * time.Minute}}
	slog.Info("asking for work", "convex", cfg.ConvexSiteURL, "every", cfg.PollInterval, "model", cfg.OpenRouterModel)
	w := &worker.Worker{Convex: client, Transcriber: t, Config: cfg}
	return w.Run(ctx)
}

// transcribeFile writes note.md, with its images in images/, as the Markdown download will be.
func transcribeFile(ctx context.Context, envFile string, args []string) error {
	flags := flag.NewFlagSet("transcribe", flag.ExitOnError)
	out := flags.String("o", "", "output directory (default out/NAME)")
	flags.Parse(args)
	if flags.NArg() != 1 {
		return fmt.Errorf("usage: runner transcribe [-o DIR] FILE")
	}
	path := flags.Arg(0)
	_, t, err := setup(envFile)
	if err != nil {
		return err
	}
	kind := strings.ToLower(strings.TrimPrefix(filepath.Ext(path), "."))
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if *out == "" {
		*out = filepath.Join("out", strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)))
	}
	work := filepath.Join(*out, "work")
	if err := clearOutput(*out); err != nil {
		return err
	}
	if err := os.MkdirAll(work, 0o755); err != nil {
		return err
	}

	started := time.Now()
	ctx, spent := openrouter.WithSpending(ctx)
	result, err := t.Transcribe(ctx, filepath.Base(path), kind, data, work)
	if err != nil {
		return err
	}
	images := filepath.Join(*out, "images")
	if err := os.MkdirAll(images, 0o755); err != nil {
		return err
	}
	files := map[string]string{}
	for _, a := range result.Assets {
		name := a.ID + filepath.Ext(a.Path)
		files[a.ID] = "images/" + name
		data, err := os.ReadFile(a.Path)
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(images, name), data, 0o644); err != nil {
			return err
		}
	}
	md := transcribe.LocalAssets(result.Markdown, func(id string) string { return files[id] })
	if err := os.WriteFile(filepath.Join(*out, "note.md"), []byte(md), 0o644); err != nil {
		return err
	}
	slog.Info("transcribed", "out", *out, "pages", result.Pages, "images", len(result.Assets),
		"seconds", time.Since(started).Round(time.Second).Seconds(), "cost_usd", spent.USD())
	return nil
}

// clearOutput empties a directory for new output, refusing one that holds anything but an earlier run's.
func clearOutput(dir string) error {
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return err
	}
	for _, e := range entries {
		if name := e.Name(); name != "note.md" && name != "images" && name != "work" {
			return fmt.Errorf("%s has other files, such as %s; choose another directory with -o", dir, name)
		}
	}
	for _, name := range []string{"note.md", "images", "work"} {
		if err := os.RemoveAll(filepath.Join(dir, name)); err != nil {
			return err
		}
	}
	return nil
}
