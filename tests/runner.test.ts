import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { LEASE_MS, MAX_ATTEMPTS, MAX_JOBS_PER_USER, sign } from "../convex/runner";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
const SECRET = "test-runner-secret";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("RUNNER_SECRET", SECRET);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function fixture() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice", issuer: "https://clerk.test" });
  const projectId = await alice.mutation(api.library.createProject, { name: "Biology" });
  await alice.mutation(api.library.createMap, { projectId, title: "Glycolysis" });
  return { t, alice, projectId };
}

type T = Awaited<ReturnType<typeof fixture>>["t"];

/** Adds a source as an upload would, without sending the bytes over HTTP. */
function addSource(
  t: T,
  projectId: Id<"projects">,
  name: string,
  text = "%PDF-1.7",
  queuedBy?: string,
) {
  return t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([text]));
    await ctx.runMutation(internal.sources.attach, { projectId, storageId, name, title: "" });
    const sources = await ctx.db.query("sources").collect();
    const { _id } = sources.find((source) => source.storageId === storageId)!;
    await ctx.db.patch(_id, { queuedBy });
    return _id;
  });
}

/** Posts a request signed as the runner signs it, or with the given headers. */
async function call(
  t: T,
  path: string,
  body: unknown = {},
  options: { headers?: Record<string, string>; contentType?: string } = {},
): Promise<{ status: number; json: Record<string, any> }> {
  // Uploads send their bytes as they are.
  const text = options.contentType ? String(body) : JSON.stringify(body);
  const timestamp = String(Date.now());
  const response = await t.fetch(path, {
    method: "POST",
    body: text,
    headers: options.headers ?? {
      "Content-Type": options.contentType ?? "application/json",
      "X-Runner-Timestamp": timestamp,
      "X-Runner-Signature": await sign(SECRET, timestamp, "POST", path, text),
    },
  });
  return { status: response.status, json: await response.json() };
}

const MARKDOWN = "text/markdown; charset=utf-8";

/** Uploads one file of a claim's result, returning its storage ID. */
async function upload(
  t: T,
  job: { sourceId: Id<"sources">; token: string },
  contentType: string,
  text: string,
) {
  const path = `/runner/upload?sourceId=${job.sourceId}&token=${job.token}`;
  const { status, json } = await call(t, path, text, { contentType });
  expect(status).toBe(200);
  return json.storageId as Id<"_storage">;
}

async function claim(t: T) {
  const { json } = await call(t, "/runner/claim");
  return json.job as {
    sourceId: Id<"sources">;
    token: string;
    name: string;
    fileUrl: string;
  } | null;
}

function store(t: T, text: string) {
  return t.run((ctx) => ctx.storage.store(new Blob([text])));
}

function source(t: T, sourceId: Id<"sources">) {
  return t.run((ctx) => ctx.db.get(sourceId));
}

function storedFiles(t: T) {
  return t.run(async (ctx) => (await ctx.db.system.query("_storage").collect()).length);
}

describe("runner requests", () => {
  test("are signed as the runner signs them", async () => {
    // The same vector is in runner/convex_test.go.
    expect(await sign("secret", "1700000000000", "POST", "/runner/claim", '{"a":1}')).toBe(
      "5bd32f63b6def04edb8516178f00b246a3dd53a79b3163179b445debb2430b59",
    );
  });

  test("must be signed with the deployment's secret, recently", async () => {
    const { t } = await fixture();
    expect((await call(t, "/runner/claim", {}, { headers: {} })).status).toBe(401);

    const timestamp = String(Date.now());
    const wrong = await sign("another-secret", timestamp, "POST", "/runner/claim", "{}");
    const forged = { "X-Runner-Timestamp": timestamp, "X-Runner-Signature": wrong };
    expect((await call(t, "/runner/claim", {}, { headers: forged })).status).toBe(401);

    const old = String(Date.now() - 10 * 60_000);
    const stale = {
      "X-Runner-Timestamp": old,
      "X-Runner-Signature": await sign(SECRET, old, "POST", "/runner/claim", "{}"),
    };
    expect((await call(t, "/runner/claim", {}, { headers: stale })).status).toBe(401);

    // Signed for another endpoint.
    const elsewhere = {
      "X-Runner-Timestamp": timestamp,
      "X-Runner-Signature": await sign(SECRET, timestamp, "POST", "/runner/fail", "{}"),
    };
    expect((await call(t, "/runner/claim", {}, { headers: elsewhere })).status).toBe(401);
  });

  test("are refused if they're too large, without reading more than the limit", async () => {
    const { t } = await fixture();
    const timestamp = String(Date.now());
    let sent = 0;
    // Streamed, so there's no Content-Length to go by.
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 64 * 1024;
        controller.enqueue(new Uint8Array(64 * 1024));
        if (sent > 4 * 1024 * 1024) controller.close();
      },
    });
    const response = await t.fetch("/runner/claim", {
      method: "POST",
      body,
      // @ts-expect-error Node needs this to send a stream.
      duplex: "half",
      headers: { "X-Runner-Timestamp": timestamp, "X-Runner-Signature": "0".repeat(64) },
    });
    expect(response.status).toBe(413);
    expect(sent).toBeLessThan(1024 * 1024);
  });

  test("are refused when no runner is configured", async () => {
    const { t } = await fixture();
    vi.stubEnv("RUNNER_SECRET", "");
    expect((await call(t, "/runner/claim")).status).toBe(503);
  });
});

describe("claiming", () => {
  test("takes the oldest queued file once, but never notes that are already Markdown", async () => {
    const { t, projectId } = await fixture();
    await addSource(t, projectId, "Notes.md", "# Notes");
    const first = await addSource(t, projectId, "First.pdf");
    const second = await addSource(t, projectId, "Second.docx");

    const job = await claim(t);
    expect(job).toMatchObject({ sourceId: first, name: "First.pdf" });
    expect(job!.fileUrl).toMatch(/^https?:/);
    expect((await source(t, first))?.status).toBe("processing");
    expect((await claim(t))?.sourceId).toBe(second);
    expect(await claim(t)).toBeNull();
  });

  test("runs a limited number of each user's files at once, without holding up others", async () => {
    const { t, projectId } = await fixture();
    const alices = [];
    for (let i = 0; i <= MAX_JOBS_PER_USER; i++) {
      alices.push(await addSource(t, projectId, `Alice ${i}.pdf`, undefined, "alice"));
    }
    const bobs = await addSource(t, projectId, "Bob.pdf", undefined, "bob");

    const jobs = [];
    for (let i = 0; i < MAX_JOBS_PER_USER; i++) {
      const job = (await claim(t))!;
      expect(job.sourceId).toBe(alices[i]);
      jobs.push(job);
    }
    // Alice's next one is older, but she's at her limit.
    expect((await claim(t))?.sourceId).toBe(bobs);
    expect(await claim(t)).toBeNull();

    // Finishing one makes room for her next.
    await call(t, "/runner/fail", {
      sourceId: jobs[0].sourceId,
      token: jobs[0].token,
      error: "No",
    });
    expect((await claim(t))?.sourceId).toBe(alices[MAX_JOBS_PER_USER]);
  });

  test("doesn't count a claim that ran out against its user", async () => {
    const { t, projectId } = await fixture();
    const sources = [];
    for (let i = 0; i <= MAX_JOBS_PER_USER; i++) {
      sources.push(await addSource(t, projectId, `${i}.pdf`, undefined, "alice"));
    }
    for (let i = 0; i < MAX_JOBS_PER_USER; i++) await claim(t);
    expect(await claim(t)).toBeNull();
    vi.advanceTimersByTime(LEASE_MS + 1);
    // All of them, in the order they were queued, though the leases ran out at once.
    expect((await claim(t))?.sourceId).toBe(sources[0]);
  });

  test("takes the oldest file across users, whatever their IDs", async () => {
    const { t, projectId } = await fixture();
    const zed = await addSource(t, projectId, "Zed.pdf", undefined, "zed");
    const amy = await addSource(t, projectId, "Amy.pdf", undefined, "amy");
    const old = await addSource(t, projectId, "Old.pdf");
    expect((await claim(t))?.sourceId).toBe(zed);
    expect((await claim(t))?.sourceId).toBe(amy);
    expect((await claim(t))?.sourceId).toBe(old);
    expect(await claim(t)).toBeNull();
  });

  test("counts older files without an uploader together", async () => {
    const { t, projectId } = await fixture();
    for (let i = 0; i <= MAX_JOBS_PER_USER; i++) await addSource(t, projectId, `${i}.pdf`);
    for (let i = 0; i < MAX_JOBS_PER_USER; i++) expect(await claim(t)).not.toBeNull();
    expect(await claim(t)).toBeNull();
  });

  test("limits members of a shared project separately", async () => {
    const { t, projectId } = await fixture();
    for (let i = 0; i <= MAX_JOBS_PER_USER; i++) {
      await addSource(t, projectId, `Alice ${i}.pdf`, undefined, "alice");
    }
    const bobs = await addSource(t, projectId, "Bob.pdf", undefined, "bob");
    for (let i = 0; i < MAX_JOBS_PER_USER; i++) await claim(t);
    expect((await claim(t))?.sourceId).toBe(bobs);
    expect(await claim(t)).toBeNull();
  });

  test("counts a file against whoever tried it again, not who uploaded it", async () => {
    const { t, projectId } = await fixture();
    const failed = await addSource(t, projectId, "Failed.pdf", undefined, "alice");
    const job = (await claim(t))!;
    await call(t, "/runner/fail", { sourceId: failed, token: job.token, error: "No" });
    for (let i = 0; i < MAX_JOBS_PER_USER; i++) {
      await addSource(t, projectId, `Alice ${i}.pdf`, undefined, "alice");
      await claim(t);
    }

    const bob = t.withIdentity({ subject: "bob", issuer: "https://clerk.test" });
    const bobsId = await bob.run(
      async (ctx) => (await ctx.auth.getUserIdentity())!.tokenIdentifier,
    );
    await t.run((ctx) =>
      ctx.db.insert("projectMembers", { projectId, userId: bobsId, role: "member" }),
    );
    await bob.mutation(api.sources.retry, { sourceId: failed });
    // Alice is at her limit, but it's Bob's now.
    expect((await source(t, failed))?.queuedBy).toBe(bobsId);
    expect((await claim(t))?.sourceId).toBe(failed);
  });

  test("keeps a file against the same user when it's given back", async () => {
    const { t, projectId } = await fixture();
    const sourceId = await addSource(t, projectId, "A.pdf", undefined, "alice");
    const job = (await claim(t))!;
    await call(t, "/runner/fail", { sourceId, token: job.token, error: "", release: true });
    expect(await source(t, sourceId)).toMatchObject({ status: "queued", queuedBy: "alice" });
  });

  test("doesn't record anyone for a note that needs no transcribing", async () => {
    const { t, projectId } = await fixture();
    const { userId } = await t.run(async (ctx) => (await ctx.db.query("projectMembers").first())!);
    const sourceId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["# A"]));
      const id: Id<"sources"> = await ctx.runMutation(internal.sources.completeUpload, {
        projectId,
        userId,
        name: "A.md",
        size: 3,
        storageId,
      });
      return id;
    });
    expect((await source(t, sourceId))?.queuedBy).toBeUndefined();
  });

  test("records who uploaded a file", async () => {
    const { t, projectId } = await fixture();
    const { userId, sourceId } = await t.run(async (ctx) => {
      const { userId } = (await ctx.db.query("projectMembers").first())!;
      const storageId = await ctx.storage.store(new Blob(["%PDF-1.7"]));
      const sourceId: Id<"sources"> = await ctx.runMutation(internal.sources.completeUpload, {
        projectId,
        userId,
        name: "A.pdf",
        size: 8,
        storageId,
      });
      return { userId, sourceId };
    });
    expect((await source(t, sourceId))?.queuedBy).toBe(userId);
  });

  test("goes back in the queue when heartbeats stop, and fails after too many tries", async () => {
    const { t, projectId } = await fixture();
    const sourceId = await addSource(t, projectId, "Slides.pdf");
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const job = await claim(t);
      expect(job?.sourceId).toBe(sourceId);
      vi.advanceTimersByTime(LEASE_MS + 1);
      await t.finishInProgressScheduledFunctions();
    }
    const failed = await source(t, sourceId);
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toMatch(/stopped/);
    expect(await claim(t)).toBeNull();

    // Trying again starts the count over.
    await t
      .withIdentity({ subject: "alice", issuer: "https://clerk.test" })
      .mutation(api.sources.retry, { sourceId });
    expect((await claim(t))?.sourceId).toBe(sourceId);
  });

  test("lasts while heartbeats renew it", async () => {
    const { t, projectId } = await fixture();
    const sourceId = await addSource(t, projectId, "Slides.pdf");
    const job = (await claim(t))!;
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(LEASE_MS / 2);
      const beat = await call(t, "/runner/heartbeat", { sourceId, token: job.token });
      expect(beat.status).toBe(200);
      await t.finishInProgressScheduledFunctions();
    }
    expect((await source(t, sourceId))?.status).toBe("processing");
    expect((await call(t, "/runner/heartbeat", { sourceId, token: "other" })).status).toBe(409);
  });
});

describe("finishing", () => {
  test("saves the Markdown and its images, which the reader can then show", async () => {
    const { t, alice, projectId } = await fixture();
    const sourceId = await addSource(t, projectId, "Slides.pdf");
    const job = (await claim(t))!;
    const markdownId = await upload(t, job, MARKDOWN, "## Page 1\n\n![Cell](asset:p1-a)");
    const imageId = await upload(t, job, "image/png", "png");
    const done = await call(t, "/runner/complete", {
      sourceId,
      token: job.token,
      markdownId,
      pageCount: 3,
      assets: [{ name: "p1-a", storageId: imageId }],
    });
    expect(done.status).toBe(200);

    const opened = await alice.query(api.sources.open, { sourceId });
    expect(opened).toMatchObject({ status: "ready", pageCount: 3 });
    expect(opened?.markdownUrl).toBeTruthy();
    expect(Object.keys(opened!.assetUrls)).toEqual(["p1-a"]);
    // The claim is over.
    expect((await call(t, "/runner/heartbeat", { sourceId, token: job.token })).status).toBe(409);

    // Sent again, e.g. after a response was lost, it changes nothing.
    const again = await call(t, "/runner/complete", {
      sourceId,
      token: job.token,
      markdownId,
      assets: [{ name: "p1-a", storageId: imageId }],
    });
    expect(again.status).toBe(409);
    expect(await storedFiles(t)).toBe(3);
    expect(Object.keys((await alice.query(api.sources.open, { sourceId }))!.assetUrls)).toEqual([
      "p1-a",
    ]);

    // Deleting the source deletes its original, Markdown and images.
    await alice.mutation(api.sources.remove, { sourceId });
    expect(await storedFiles(t)).toBe(0);
  });

  test("deletes uploads the result doesn't use", async () => {
    const { t, projectId } = await fixture();
    const sourceId = await addSource(t, projectId, "Slides.pdf");
    const job = (await claim(t))!;
    const markdownId = await upload(t, job, MARKDOWN, "# Notes");
    await upload(t, job, "image/png", "unused");
    await call(t, "/runner/complete", { sourceId, token: job.token, markdownId, assets: [] });
    expect((await source(t, sourceId))?.status).toBe("ready");
    expect(await storedFiles(t)).toBe(2);
  });

  test("only accepts files the claim uploaded", async () => {
    const { t, projectId } = await fixture();
    const other = await addSource(t, projectId, "Other.pdf");
    const sourceId = await addSource(t, projectId, "Slides.pdf");
    const otherJob = (await claim(t))!;
    expect(otherJob.sourceId).toBe(other);
    const job = (await claim(t))!;
    const theirs = await upload(t, otherJob, MARKDOWN, "# Theirs");
    const stray = await store(t, "# Not uploaded by a runner");
    await call(t, "/runner/complete", {
      sourceId,
      token: job.token,
      markdownId: stray,
      assets: [{ name: "a", storageId: theirs }],
    });
    expect((await source(t, sourceId))?.status).toBe("failed");
    // Neither the other claim's upload nor an unrelated file was touched.
    expect(await t.run((ctx) => ctx.db.system.get(theirs))).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.system.get(stray))).not.toBeNull();
  });

  test("refuses files of other types", async () => {
    const { t, projectId } = await fixture();
    await addSource(t, projectId, "Slides.pdf");
    const job = (await claim(t))!;
    const response = await call(
      t,
      `/runner/upload?sourceId=${job.sourceId}&token=${job.token}`,
      "<svg/>",
      {
        contentType: "image/svg+xml",
      },
    );
    expect(response.status).toBe(400);
  });

  test("fails a result whose Markdown is an image", async () => {
    const { t, projectId } = await fixture();
    const sourceId = await addSource(t, projectId, "Slides.pdf");
    const job = (await claim(t))!;
    const markdownId = await upload(t, job, "image/png", "png");
    await call(t, "/runner/complete", { sourceId, token: job.token, markdownId, assets: [] });
    expect((await source(t, sourceId))?.status).toBe("failed");
    expect(await storedFiles(t)).toBe(1);
  });

  test("fails a result with more pages than can be transcribed", async () => {
    const { t, projectId } = await fixture();
    const sourceId = await addSource(t, projectId, "Slides.pdf");
    const job = (await claim(t))!;
    const markdownId = await upload(t, job, MARKDOWN, "# Notes");
    await call(t, "/runner/complete", {
      sourceId,
      token: job.token,
      markdownId,
      pageCount: 76,
      assets: [],
    });
    expect((await source(t, sourceId))?.status).toBe("failed");
  });

  test("refuses a claim that ran out, even before Convex has requeued it", async () => {
    const { t, projectId } = await fixture();
    const sourceId = await addSource(t, projectId, "Slides.pdf");
    const job = (await claim(t))!;
    const markdownId = await upload(t, job, MARKDOWN, "# Notes");
    vi.advanceTimersByTime(LEASE_MS + 1);
    expect((await call(t, "/runner/heartbeat", { sourceId, token: job.token })).status).toBe(409);
    const late = await call(t, "/runner/complete", {
      sourceId,
      token: job.token,
      markdownId,
      assets: [],
    });
    expect(late.status).toBe(409);
    // Requeuing deletes what the claim uploaded.
    await t.finishInProgressScheduledFunctions();
    expect((await source(t, sourceId))?.status).toBe("queued");
    expect(await storedFiles(t)).toBe(1);
  });

  test("discards the files when the source is deleted", async () => {
    const { t, alice, projectId } = await fixture();
    const sourceId = await addSource(t, projectId, "Slides.pdf");
    const job = (await claim(t))!;
    const markdownId = await upload(t, job, MARKDOWN, "# Late");
    await alice.mutation(api.sources.remove, { sourceId });
    expect(await storedFiles(t)).toBe(0);
    const late = await call(t, "/runner/complete", {
      sourceId,
      token: job.token,
      markdownId,
      assets: [],
    });
    expect(late.status).toBe(409);
  });

  test("fails the source, discarding the files, when the result is invalid", async () => {
    const { t, projectId } = await fixture();
    const sourceId = await addSource(t, projectId, "Slides.pdf");
    const job = (await claim(t))!;
    const markdownId = await upload(t, job, MARKDOWN, "# Notes");
    const imageId = await upload(t, job, "image/png", "png");
    await call(t, "/runner/complete", {
      sourceId,
      token: job.token,
      markdownId,
      assets: [{ name: "../escape", storageId: imageId }],
    });
    expect((await source(t, sourceId))?.status).toBe("failed");
    // Only the original is left.
    expect(await storedFiles(t)).toBe(1);
  });

  test("a failure is shown to the user, and a released file is queued again without a try used", async () => {
    const { t, alice, projectId } = await fixture();
    const sourceId = await addSource(t, projectId, "Long.pdf");
    let job = (await claim(t))!;
    await upload(t, job, MARKDOWN, "# Partial");
    await call(t, "/runner/fail", { sourceId, token: job.token, error: "", release: true });
    expect(await source(t, sourceId)).toMatchObject({ status: "queued", attempts: 0 });
    expect(await storedFiles(t)).toBe(1);

    job = (await claim(t))!;
    const error = "This PDF has 80 pages. Notes can be transcribed from up to 75.";
    await call(t, "/runner/fail", { sourceId, token: job.token, error });
    expect(await alice.query(api.sources.open, { sourceId })).toMatchObject({
      status: "failed",
      error,
    });
  });
});
