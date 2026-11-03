import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { MAX_SOURCE_BYTES } from "../convex/model";
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
  const projectId = await alice.mutation(api.library.createProject, { name: "Biology" });
  const topicId = await alice.mutation(api.library.createMap, { projectId, title: "Glycolysis" });
  return { t, alice, bob, projectId, topicId };
}

type T = Awaited<ReturnType<typeof fixture>>["t"];
type User = Awaited<ReturnType<typeof fixture>>["alice"];

/** Uploads a file the way the client does. */
async function upload(
  t: T,
  user: User,
  projectId: Id<"projects">,
  name: string,
  data: string | Uint8Array<ArrayBuffer>,
) {
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob([data])));
  const result = await user.mutation(api.sources.add, { projectId, storageId, name });
  return { storageId, result };
}

function storedFiles(t: T) {
  return t.run(async (ctx) => (await ctx.db.system.query("_storage").collect()).length);
}

function markdownOf(t: T, sourceId: Id<"sources">) {
  return t.run(async (ctx) => {
    const source = await ctx.db.get(sourceId);
    const blob = source?.markdownId && (await ctx.storage.get(source.markdownId));
    return blob ? blob.text() : null;
  });
}

describe("source notes", () => {
  test("Markdown and text files are notes as soon as they're added", async () => {
    const { t, alice, projectId } = await fixture();
    const { storageId, result } = await upload(t, alice, projectId, "Lecture 1.md", "# Cells");
    const sourceId = result.sourceId!;
    expect(await alice.query(api.sources.list, { projectId })).toEqual([
      { _id: sourceId, name: "Lecture 1.md", kind: "md", size: 7, status: "ready" },
    ]);
    const source = await alice.query(api.sources.open, { sourceId });
    expect(source).toMatchObject({ status: "ready", originalUrl: null });
    expect(source?.markdownUrl).toBeTruthy();
    // The file is its own note: nothing else is stored.
    expect(await t.run((ctx) => ctx.db.get(sourceId))).toMatchObject({ markdownId: storageId });
    expect(await storedFiles(t)).toBe(1);
  });

  test("other files wait to be transcribed, with a link to the original", async () => {
    const { t, alice, projectId } = await fixture();
    const { result } = await upload(t, alice, projectId, "Chapter 7.pdf", "%PDF-1.4");
    const source = await alice.query(api.sources.open, { sourceId: result.sourceId! });
    expect(source).toMatchObject({ kind: "pdf", status: "queued", markdownUrl: null });
    expect(source?.originalUrl).toBeTruthy();
  });

  test("a failed source can be queued again", async () => {
    const { t, alice, projectId } = await fixture();
    const { result } = await upload(t, alice, projectId, "Slides.pptx", "PK");
    const sourceId = result.sourceId!;
    await t.run((ctx) => ctx.db.patch(sourceId, { status: "failed", error: "Too many pages" }));
    await alice.mutation(api.sources.retry, { sourceId });
    const queued = await alice.query(api.sources.open, { sourceId });
    expect(queued?.status).toBe("queued");
    expect(queued?.error).toBeUndefined();
    // Only a failed source is queued again.
    await t.run((ctx) => ctx.db.patch(sourceId, { status: "ready" }));
    await alice.mutation(api.sources.retry, { sourceId });
    expect((await alice.query(api.sources.open, { sourceId }))?.status).toBe("ready");
  });

  test("unsupported and oversized files are deleted instead of added", async () => {
    const { t, alice, projectId } = await fixture();
    const exe = await upload(t, alice, projectId, "setup.exe", "MZ");
    expect(exe.result).toEqual({ error: "setup.exe isn't a supported file type" });
    const big = await upload(t, alice, projectId, "Big.txt", "x".repeat(MAX_SOURCE_BYTES + 1));
    expect(big.result.error).toMatch(/larger than 15 MB/);
    expect(await alice.query(api.sources.list, { projectId })).toEqual([]);
    expect(await storedFiles(t)).toBe(0);
  });

  test("other accounts and signed-out callers can't use a project's sources", async () => {
    const { t, alice, bob, projectId } = await fixture();
    const { result } = await upload(t, alice, projectId, "Notes.txt", "Private");
    const sourceId = result.sourceId!;

    await expect(t.mutation(api.sources.generateUploadUrl)).rejects.toThrow("Sign in to continue");
    await expect(t.query(api.sources.list, { projectId })).rejects.toThrow("Sign in to continue");
    for (const call of [
      () => bob.query(api.sources.list, { projectId }),
      () => bob.query(api.sources.open, { sourceId }),
      () => bob.mutation(api.sources.remove, { sourceId }),
      () => bob.mutation(api.sources.retry, { sourceId }),
    ]) {
      await expect(call()).rejects.toThrow("Project not found");
    }
    const intruder = await upload(t, bob, projectId, "Mine.txt", "Bob's");
    expect(intruder.result).toEqual({ error: "Project not found" });
    expect(await alice.query(api.sources.list, { projectId })).toHaveLength(1);
  });

  test("every member of the project shares its notes", async () => {
    const { t, alice, bob, projectId } = await fixture();
    await t.run((ctx) =>
      ctx.db.insert("projectMembers", {
        projectId,
        userId: "https://clerk.test|bob",
        role: "member",
      }),
    );
    const { result } = await upload(t, bob, projectId, "Bob's.md", "# Hi");
    const sourceId = result.sourceId!;
    expect(await alice.query(api.sources.list, { projectId })).toHaveLength(1);
    expect(await alice.query(api.sources.open, { sourceId })).toMatchObject({ name: "Bob's.md" });
    await alice.mutation(api.sources.remove, { sourceId });
    expect(await bob.query(api.sources.list, { projectId })).toEqual([]);
  });

  test("a project's maps share its notes, which outlive a deleted map", async () => {
    const { t, alice, projectId, topicId } = await fixture();
    const first = await upload(t, alice, projectId, "One.md", "# One");
    await upload(t, alice, projectId, "Two.md", "# Two");
    expect(await storedFiles(t)).toBe(2);

    await alice.mutation(api.sources.remove, { sourceId: first.result.sourceId! });
    expect(await storedFiles(t)).toBe(1);

    await alice.mutation(api.library.deleteMap, { topicId });
    const names = (await alice.query(api.sources.list, { projectId })).map((s) => s.name);
    expect(names).toEqual(["Two.md"]);

    await alice.mutation(api.library.deleteProject, { projectId, confirmation: "Biology" });
    expect(await t.run((ctx) => ctx.db.query("sources").collect())).toEqual([]);
    expect(await storedFiles(t)).toBe(0);
  });

  test("the demo library imports each map's notes into its project", async () => {
    const { t } = await fixture();
    // Seeding skips accounts that already have projects.
    const carol = t.withIdentity({ subject: "carol", issuer: "https://clerk.test" });
    await carol.mutation(api.workspace.seed);
    const projects = await carol.query(api.library.list);
    // Checked as scheduled rather than run: convex-test can't store files from
    // concurrent actions. The migration test covers the import itself.
    const imports = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(imports.map((job) => job.name).every((name) => name === "sources:importText")).toBe(
      true,
    );
    expect(imports).toHaveLength(projects.flatMap((project) => project.maps).length);
    const projectIds = new Set(projects.map((project) => project._id));
    for (const job of imports) {
      expect(projectIds.has(job.args[0].projectId)).toBe(true);
      expect(job.args[0].name).toMatch(/\.md$/);
      expect(job.args[0].text).toMatch(/^# /);
    }
  });

  test("an import that can't be attached leaves nothing stored", async () => {
    const { t, alice, projectId } = await fixture();
    await expect(
      t.action(internal.sources.importText, { projectId, name: "unsupported.exe", text: "x" }),
    ).rejects.toThrow("Unsupported file");
    expect(await alice.query(api.sources.list, { projectId })).toEqual([]);
    expect(await storedFiles(t)).toBe(0);
  });

  test("the migration moves inline notes into a project source", async () => {
    const { t, alice, projectId } = await fixture();
    const topicId = await t.run((ctx) =>
      ctx.db.insert("topics", {
        projectId,
        title: "Old map",
        notes: { heading: "Lecture 1", paragraphs: ["First.", "Second."] },
      }),
    );
    await t.mutation(internal.migrations.notesToSources);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(topicId)))?.notes).toBeUndefined();
    const [source] = await alice.query(api.sources.list, { projectId });
    expect(source).toMatchObject({ name: "Lecture 1.md", status: "ready" });
    expect(await markdownOf(t, source._id)).toBe("# Lecture 1\n\nFirst.\n\nSecond.\n");
  });
});
