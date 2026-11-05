// Package config reads the runner's settings from the environment.
package config

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config is read from the environment, after loading .env.local if there is one.
// Variables already set in the environment win over the file.
type Config struct {
	// The Convex deployment's HTTP actions URL, e.g. https://name.convex.site.
	ConvexSiteURL string
	// Shared with the deployment's RUNNER_SECRET, to sign requests both ways.
	RunnerSecret string

	OpenRouterKey   string
	OpenRouterModel string
	OpenRouterURL   string

	// How often to ask for work. Zero only waits for nudges.
	PollInterval time.Duration
	// Exit after this long without work. Zero never exits; meant for development.
	IdleExit time.Duration
	// How long a job can take before it's failed. Zero has no limit.
	JobTimeout time.Duration
	// Where to listen for nudges from Convex, e.g. 127.0.0.1:8090. Empty doesn't listen.
	Listen string

	PDFTool string
	// Optional directory of prompts that replace the built-in ones, for tuning without a rebuild.
	PromptsDir string

	MaxPages int
	// Pages per conversation with the model, or slides per request.
	RangePages int
	// Responses per conversation about a PDF's pages, including the final one.
	Turns int
	// Crops per document, to limit what they cost.
	MaxCrops int
	// Requests in flight at once, per document.
	Parallel int
}

// pageLimit matches MAX_SOURCE_PAGES in convex/model.ts.
const pageLimit = 75

// Load reads the settings, after loading envFile if it exists.
func Load(envFile string) (Config, error) {
	if err := loadEnvFile(envFile); err != nil {
		return Config{}, err
	}
	c := Config{
		ConvexSiteURL:   strings.TrimRight(os.Getenv("CONVEX_SITE_URL"), "/"),
		RunnerSecret:    os.Getenv("RUNNER_SECRET"),
		OpenRouterKey:   os.Getenv("OPENROUTER_API_KEY"),
		OpenRouterModel: env("OPENROUTER_MODEL", "openai/gpt-6-luna"),
		OpenRouterURL:   env("OPENROUTER_URL", "https://openrouter.ai/api/v1"),
		Listen:          os.Getenv("LISTEN"),
		PDFTool:         env("PDF_TOOL", "poppler"),
		PromptsDir:      os.Getenv("PROMPTS_DIR"),
	}
	var err error
	durations := []struct {
		name string
		def  string
		dst  *time.Duration
	}{
		{"POLL_INTERVAL", "5s", &c.PollInterval},
		{"IDLE_EXIT", "0", &c.IdleExit},
		{"JOB_TIMEOUT", "30m", &c.JobTimeout},
	}
	for _, d := range durations {
		if *d.dst, err = time.ParseDuration(env(d.name, d.def)); err != nil || *d.dst < 0 {
			return c, fmt.Errorf("%s: expected a duration such as 5s", d.name)
		}
	}
	ints := []struct {
		name string
		def  int
		dst  *int
	}{
		{"MAX_PAGES", pageLimit, &c.MaxPages},
		{"RANGE_PAGES", 25, &c.RangePages},
		{"TURNS", 16, &c.Turns},
		{"MAX_CROPS", 40, &c.MaxCrops},
		{"PARALLEL", 3, &c.Parallel},
	}
	for _, i := range ints {
		if *i.dst, err = strconv.Atoi(env(i.name, strconv.Itoa(i.def))); err != nil || *i.dst < 0 {
			return c, fmt.Errorf("%s: expected a whole number", i.name)
		}
	}
	// Convex refuses results with more pages than it allows.
	if c.MaxPages < 1 || c.MaxPages > pageLimit {
		return c, fmt.Errorf("MAX_PAGES must be from 1 to %d", pageLimit)
	}
	if c.RangePages < 1 || c.Turns < 1 || c.Parallel < 1 {
		return c, fmt.Errorf("RANGE_PAGES, TURNS and PARALLEL must be at least 1")
	}
	if c.OpenRouterKey == "" {
		return c, fmt.Errorf("OPENROUTER_API_KEY is not set")
	}
	return c, nil
}

// CheckConvex checks the settings `run` needs to talk to Convex.
func (c Config) CheckConvex() error {
	if c.ConvexSiteURL == "" || c.RunnerSecret == "" {
		return fmt.Errorf("CONVEX_SITE_URL and RUNNER_SECRET must be set")
	}
	if c.PollInterval == 0 && c.Listen == "" {
		return fmt.Errorf("with POLL_INTERVAL=0, set LISTEN so Convex can nudge the runner")
	}
	return nil
}

func env(name, def string) string {
	if v, ok := os.LookupEnv(name); ok && v != "" {
		return v
	}
	return def
}

// loadEnvFile sets variables from KEY=value lines, skipping blank lines and comments.
// A missing file is fine.
func loadEnvFile(path string) error {
	f, err := os.Open(path)
	if os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return err
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for n := 1; scanner.Scan(); n++ {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(strings.TrimPrefix(line, "export "), "=")
		if !ok {
			return fmt.Errorf("%s:%d: expected KEY=value", path, n)
		}
		key, value = strings.TrimSpace(key), strings.TrimSpace(value)
		if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[len(value)-1] == value[0] {
			value = value[1 : len(value)-1]
		}
		if _, set := os.LookupEnv(key); !set {
			os.Setenv(key, value)
		}
	}
	return scanner.Err()
}
