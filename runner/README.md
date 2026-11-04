# Document runner

Transcribes source notes uploaded as PDF, Word or PowerPoint files into Markdown, using a vision model through [OpenRouter](https://openrouter.ai). Markdown and text uploads don't need it.

## How it works

The runner asks the Convex deployment for work over signed HTTP endpoints (`convex/runner.ts`). Convex never needs to reach it, so it runs the same way on a laptop or a server:

- **claim** takes the oldest queued source, with a link to download it, for a two-minute lease;
- **heartbeat** renews the lease while the runner works;
- **upload** stores one file of the result, which only that claim can use;
- **complete** saves the Markdown and its images, replacing any earlier ones, and deletes any uploads it didn't use;
- **fail** gives a reason the user sees, or releases the source back to the queue, e.g. on shutdown.

If the heartbeats stop, Convex puts the source back in the queue when the lease runs out, deleting what the claim uploaded, and fails it after three tries. The runner stops working on a source if it can't renew the lease in time. Each request is signed with HMAC-SHA256 over its time, method, path with query, and body, using a secret shared with the deployment's `RUNNER_SECRET`. Each deployment has its own secret.

A PDF is transcribed in two passes:

1. **Text:** the model reads the native PDF in ranges of 25 pages and transcribes each page under a `## Page N` heading. A range whose response is cut off is split in half.
2. **Figures:** the model gets the range again, with its original bitmaps, page previews and tools to inspect assets, render pages and crop regions, which return real pixels. It links each page's figures as `![caption](asset:ID)`, added after that page's text. If this pass fails, the text is kept on its own.

Word and PowerPoint files are read as XML, so only their text is transcribed. Up to 75 pages or slides are transcribed.

## Code

`main.go` reads the settings and starts the worker or a local transcription. The rest is in `internal/`:

- `config` reads the settings from the environment and `.env.local`;
- `worker` claims sources, renews their leases, and uploads the results;
- `convex` signs and sends the requests to Convex;
- `transcribe` turns a file into Markdown and images, with the prompts in `transcribe/prompts/`;
- `openrouter` sends the model requests;
- `pdf` splits, renders and extracts images from PDFs, using Poppler;
- `office` reads the text of Word and PowerPoint files.

## Development

Install Go 1.26 and Poppler (`sudo dnf install poppler-utils`), then:

```sh
cd runner
cp .env.example .env.local  # Then fill it in
pnpm exec convex env set --deployment dev RUNNER_SECRET <the same secret>  # Once, on your dev deployment
go run .
```

It asks for work every 5 seconds and exits after 30 minutes without any. Upload a PDF in the app to see it work.

To tune the prompts, transcribe a file locally, without Convex:

```sh
go run . transcribe -o out/lecture path/to/lecture.pdf
```

This writes `out/lecture/note.md` with its images in `out/lecture/images/`, and keeps intermediate files in `out/lecture/work/`. Set `PROMPTS_DIR=internal/transcribe/prompts` to read the prompts from disk instead of the copies built into the binary.

```sh
go test ./...
go vet ./...
```

## Production

On a server, set `LISTEN=127.0.0.1:8090`, `POLL_INTERVAL=60s` and `IDLE_EXIT=0`, and put a reverse proxy such as Caddy in front of it for TLS. Setting `RUNNER_URL` on the deployment to the runner's public address makes Convex nudge it when a source is queued, so it doesn't wait for its next poll.
