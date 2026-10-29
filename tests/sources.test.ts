import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { MAX_SOURCE_BYTES, type Block } from "../convex/model";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function fixture() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice", issuer: "https://clerk.test" });
  const bob = t.withIdentity({ subject: "bob", issuer: "https://clerk.test" });
  const folderId = await alice.mutation(api.library.createFolder, { name: "Biology" });
  const topicId = await alice.mutation(api.library.createMap, { folderId });
  return { t, alice, bob, topicId };
}

type T = Awaited<ReturnType<typeof fixture>>["t"];
type User = Awaited<ReturnType<typeof fixture>>["alice"];

/** Uploads a file the way the client does, then runs extraction. */
async function upload(t: T, user: User, topicId: Id<"topics">, name: string, data: string) {
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob([data])));
  const result = await user.mutation(api.sources.add, { topicId, storageId, name });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return { storageId, result };
}

function storedFiles(t: T) {
  return t.run(async (ctx) => (await ctx.db.system.query("_storage").collect()).length);
}

function blocksOf(t: T, sourceId: Id<"sources">) {
  return t.run(async (ctx) => {
    const source = await ctx.db.get(sourceId);
    const blob = source?.contentId && (await ctx.storage.get(source.contentId));
    return blob ? (JSON.parse(await blob.text()) as Block[]) : null;
  });
}

describe("source notes", () => {
  test("Markdown is read into headings, lists, and tables", async () => {
    const { t, alice, topicId } = await fixture();
    const { result } = await upload(
      t,
      alice,
      topicId,
      "Lecture.md",
      "# Lecture\n\nSome\ntext.\n\n## Part\n\n- one\n  - nested\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n",
    );
    const sourceId = result.sourceId!;
    expect(await alice.query(api.sources.list, { topicId })).toMatchObject([
      { _id: sourceId, name: "Lecture.md", kind: "md", status: "ready" },
    ]);
    expect(await blocksOf(t, sourceId)).toEqual([
      { type: "heading", level: 1, text: "Lecture" },
      { type: "paragraph", text: "Some text." },
      { type: "heading", level: 2, text: "Part" },
      {
        type: "list",
        ordered: false,
        items: [{ text: "one", items: [{ text: "nested" }] }, { text: "two" }],
      },
      {
        type: "table",
        rows: [
          ["a", "b"],
          ["1", "2"],
        ],
      },
    ]);
    const opened = await alice.query(api.sources.open, { sourceId });
    expect(opened?.url).toBeTruthy();
    expect(opened?.contentUrl).toBeTruthy();
  });

  test("kinds without an extractor are ready to open, and unreadable files fail", async () => {
    const { t, alice, topicId } = await fixture();
    const pdf = await upload(t, alice, topicId, "Slides.pdf", "%PDF-1.7");
    const docx = await upload(t, alice, topicId, "Broken.docx", "not a zip");
    expect(await alice.query(api.sources.list, { topicId })).toMatchObject([
      { _id: pdf.result.sourceId, status: "ready" },
      { _id: docx.result.sourceId, status: "failed" },
    ]);
    expect(
      (await alice.query(api.sources.open, { sourceId: pdf.result.sourceId! }))?.contentUrl,
    ).toBeNull();

    await alice.mutation(api.sources.retry, { sourceId: docx.result.sourceId! });
    expect((await alice.query(api.sources.list, { topicId }))[1].status).toBe("processing");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await alice.query(api.sources.list, { topicId }))[1].status).toBe("failed");
  });

  test("unsupported and oversized files are deleted instead of added", async () => {
    const { t, alice, topicId } = await fixture();
    const exe = await upload(t, alice, topicId, "setup.exe", "MZ");
    expect(exe.result).toEqual({ error: "setup.exe isn't a supported file type" });
    const big = await upload(t, alice, topicId, "Big.txt", "x".repeat(MAX_SOURCE_BYTES + 1));
    expect(big.result.error).toMatch(/larger than 15 MB/);
    expect(await alice.query(api.sources.list, { topicId })).toEqual([]);
    expect(await storedFiles(t)).toBe(0);
  });

  test("other accounts and signed-out callers can't use a map's sources", async () => {
    const { t, alice, bob, topicId } = await fixture();
    const { result } = await upload(t, alice, topicId, "Notes.txt", "Private");
    const sourceId = result.sourceId!;

    await expect(t.mutation(api.sources.generateUploadUrl)).rejects.toThrow("Sign in to continue");
    await expect(t.query(api.sources.list, { topicId })).rejects.toThrow("Sign in to continue");
    for (const call of [
      () => bob.query(api.sources.list, { topicId }),
      () => bob.query(api.sources.open, { sourceId }),
      () => bob.mutation(api.sources.remove, { sourceId }),
      () => bob.mutation(api.sources.retry, { sourceId }),
    ]) {
      await expect(call()).rejects.toThrow("Map not found");
    }
    const intruder = await upload(t, bob, topicId, "Mine.txt", "Bob's");
    expect(intruder.result).toEqual({ error: "Map not found" });
    expect(await alice.query(api.sources.list, { topicId })).toHaveLength(1);
  });

  test("deleting a source or its map deletes the stored files", async () => {
    const { t, alice, topicId } = await fixture();
    const first = await upload(t, alice, topicId, "One.md", "# One");
    await upload(t, alice, topicId, "Two.md", "# Two");
    // Each extracted file has its original and its content.
    expect(await storedFiles(t)).toBe(4);

    await alice.mutation(api.sources.remove, { sourceId: first.result.sourceId! });
    expect(await alice.query(api.sources.list, { topicId })).toHaveLength(1);
    expect(await storedFiles(t)).toBe(2);

    await alice.mutation(api.library.deleteMap, { topicId });
    expect(await t.run((ctx) => ctx.db.query("sources").collect())).toEqual([]);
    expect(await storedFiles(t)).toBe(0);
  });

  test("the demo library imports each map's notes as a Markdown source", async () => {
    const { t } = await fixture();
    // Seeding skips accounts that already have folders.
    const carol = t.withIdentity({ subject: "carol", issuer: "https://clerk.test" });
    await carol.mutation(api.workspace.seed);
    const maps = (await carol.query(api.library.list)).flatMap((folder) => folder.maps);
    expect(maps.length).toBeGreaterThan(0);
    // Checked as scheduled rather than run: convex-test can't store files from
    // concurrent actions. The migration test covers the import itself.
    const imports = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(imports.map((job) => job.name).every((name) => name === "sources:importText")).toBe(
      true,
    );
    expect(imports.map((job) => job.args[0].topicId).sort()).toEqual(
      maps.map((map) => map._id).sort(),
    );
    for (const job of imports) {
      expect(job.args[0].name).toMatch(/\.md$/);
      expect(job.args[0].text).toMatch(/^# /);
    }
  });

  test("the migration moves inline notes into a source", async () => {
    const { t } = await fixture();
    const topicId = await t.run((ctx) =>
      ctx.db.insert("topics", {
        title: "Old map",
        notes: { heading: "Lecture 1", paragraphs: ["First.", "Second."] },
      }),
    );
    await t.mutation(internal.migrations.notesToSources);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(topicId)))?.notes).toBeUndefined();
    const source = await t.run((ctx) =>
      ctx.db
        .query("sources")
        .withIndex("by_topic", (q) => q.eq("topicId", topicId))
        .unique(),
    );
    expect(source).toMatchObject({ name: "Lecture 1.md", status: "ready" });
    expect(await blocksOf(t, source!._id)).toEqual([
      { type: "heading", level: 1, text: "Lecture 1" },
      { type: "paragraph", text: "First." },
      { type: "paragraph", text: "Second." },
    ]);
  });
});
