import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { MAX_SOURCE_BYTES, MAX_SOURCE_TITLE_LENGTH, titleFromFileName } from "../convex/model";
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

describe("note titles", () => {
  test("come from the file name, without its extension or underscores", () => {
    expect(titleFromFileName("Lecture_3 - cells.pdf")).toBe("Lecture 3 - cells");
    expect(titleFromFileName("well-known_facts.md")).toBe("well-known facts");
    expect(titleFromFileName("Ch. 2.1 notes.v2.docx")).toBe("Ch. 2.1 notes.v2");
    expect(titleFromFileName("  Week__1 \t summary_ .txt")).toBe("Week 1 summary");
  });

  test("fall back to the name as written when nothing else is left", () => {
    expect(titleFromFileName("___.pdf")).toBe("___");
    expect(titleFromFileName(".md")).toBe(".md");
    expect(titleFromFileName(" _ .txt")).toBe("_");
  });

  test("are given to uploads and imported notes", async () => {
    const { t, alice, projectId } = await fixture();
    const { result } = await upload(t, alice, projectId, "Lecture_3 - cells.pdf", "%PDF-1.4");
    // An import names its own title.
    await t.action(internal.sources.importText, {
      projectId,
      name: "Demo_notes.md",
      title: "Lecture 1: Demo",
      text: "# Demo",
    });
    const sources = await alice.query(api.sources.list, { projectId });
    expect(sources.map(({ name, title }) => ({ name, title }))).toEqual([
      { name: "Lecture_3 - cells.pdf", title: "Lecture 3 - cells" },
      { name: "Demo_notes.md", title: "Lecture 1: Demo" },
    ]);
    expect(await alice.query(api.sources.open, { sourceId: result.sourceId! })).toMatchObject({
      name: "Lecture_3 - cells.pdf",
      title: "Lecture 3 - cells",
    });
  });

  test("can be changed by any member, keeping the file name", async () => {
    const { t, alice, bob, projectId } = await fixture();
    await t.run((ctx) =>
      ctx.db.insert("projectMembers", {
        projectId,
        userId: "https://clerk.test|bob",
        role: "member",
      }),
    );
    const { result } = await upload(t, alice, projectId, "Lecture_3.md", "# Cells");
    const sourceId = result.sourceId!;
    await bob.mutation(api.sources.rename, { sourceId, title: "  Cell biology  " });
    expect(await alice.query(api.sources.open, { sourceId })).toMatchObject({
      name: "Lecture_3.md",
      title: "Cell biology",
    });
  });

  test("must have something in them and not be too long", async () => {
    const { t, alice, projectId } = await fixture();
    const { result } = await upload(t, alice, projectId, "Notes.md", "# Hi");
    const sourceId = result.sourceId!;
    await expect(alice.mutation(api.sources.rename, { sourceId, title: "   " })).rejects.toThrow(
      "Title can't be empty",
    );
    await expect(
      alice.mutation(api.sources.rename, {
        sourceId,
        title: "x".repeat(MAX_SOURCE_TITLE_LENGTH + 1),
      }),
    ).rejects.toThrow("Title is too long");
    const longest = "x".repeat(MAX_SOURCE_TITLE_LENGTH);
    await alice.mutation(api.sources.rename, { sourceId, title: longest });
    expect((await alice.query(api.sources.open, { sourceId }))?.title).toBe(longest);
    // Kept on one line.
    await alice.mutation(api.sources.rename, { sourceId, title: " Cells\n and\t tissues " });
    expect((await alice.query(api.sources.open, { sourceId }))?.title).toBe("Cells and tissues");
  });

  test("of a deleted note can't be changed", async () => {
    const { t, alice, projectId } = await fixture();
    const { result } = await upload(t, alice, projectId, "Notes.md", "# Hi");
    const sourceId = result.sourceId!;
    await alice.mutation(api.sources.remove, { sourceId });
    await expect(alice.mutation(api.sources.rename, { sourceId, title: "New" })).rejects.toThrow(
      "This note was deleted",
    );
  });

  test("given by an import are tidied, or come from the file name if empty", async () => {
    const { t, alice, projectId } = await fixture();
    for (const title of [" Week\n 2 ", "   ", "y".repeat(MAX_SOURCE_TITLE_LENGTH + 10)])
      await t.action(internal.sources.importText, {
        projectId,
        name: "Week_2.md",
        title,
        text: "",
      });
    const titles = (await alice.query(api.sources.list, { projectId })).map((s) => s.title);
    expect(titles).toEqual(["Week 2", "Week 2", "y".repeat(MAX_SOURCE_TITLE_LENGTH)]);
  });

  test("cut to fit end without a space or half an emoji, from a title or a long name", async () => {
    const { t, alice, projectId } = await fixture();
    const max = MAX_SOURCE_TITLE_LENGTH;
    const imports = [
      { name: "A.md", title: `${"a".repeat(max - 1)} b` },
      { name: "B.md", title: `${"b".repeat(max - 1)}😀` },
      { name: `${"c".repeat(max + 45)}.md`, title: "" },
    ];
    for (const fields of imports)
      await t.action(internal.sources.importText, { projectId, ...fields, text: "" });
    const titles = (await alice.query(api.sources.list, { projectId })).map((s) => s.title);
    expect(titles).toEqual(["a".repeat(max - 1), "b".repeat(max - 1), "c".repeat(max)]);
  });
});

describe("source notes", () => {
  test("Markdown and text files are notes as soon as they're added", async () => {
    const { t, alice, projectId } = await fixture();
    const { storageId, result } = await upload(t, alice, projectId, "Lecture 1.md", "# Cells");
    const sourceId = result.sourceId!;
    expect(await alice.query(api.sources.list, { projectId })).toEqual([
      {
        _id: sourceId,
        name: "Lecture 1.md",
        title: "Lecture 1",
        kind: "md",
        size: 7,
        status: "ready",
      },
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
    await expect(t.mutation(api.sources.rename, { sourceId, title: "Mine" })).rejects.toThrow(
      "Sign in to continue",
    );
    for (const call of [
      () => bob.query(api.sources.list, { projectId }),
      () => bob.query(api.sources.open, { sourceId }),
      () => bob.mutation(api.sources.remove, { sourceId }),
      () => bob.mutation(api.sources.retry, { sourceId }),
      () => bob.mutation(api.sources.rename, { sourceId, title: "Mine now" }),
    ]) {
      await expect(call()).rejects.toThrow("Project not found");
    }
    const intruder = await upload(t, bob, projectId, "Mine.txt", "Bob's");
    expect(intruder.result).toEqual({ error: "Project not found" });
    expect(await alice.query(api.sources.list, { projectId })).toMatchObject([{ title: "Notes" }]);
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
      expect(job.args[0].text).toMatch(/^# /);
    }
    // Titled like the notes' headings, in files any system can save.
    expect(imports.map((job) => [job.args[0].title, job.args[0].name])).toEqual([
      ["Lecture 7: Cellular respiration", "Lecture 7 - Cellular respiration.md"],
      ["Week 5: Hypothesis testing", "Week 5 - Hypothesis testing.md"],
    ]);
  });

  test("an import that can't be attached leaves nothing stored", async () => {
    const { t, alice, projectId } = await fixture();
    await expect(
      t.action(internal.sources.importText, {
        projectId,
        name: "unsupported.exe",
        title: "Unsupported",
        text: "x",
      }),
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
    expect(source).toMatchObject({ name: "Lecture 1.md", title: "Lecture 1", status: "ready" });
    // A heading that isn't a valid file name keeps its punctuation in the title only.
    await t.run((ctx) =>
      ctx.db.insert("topics", {
        projectId,
        title: "Old map 2",
        notes: { heading: "Week 2: A/B tests?", paragraphs: [] },
      }),
    );
    await t.mutation(internal.migrations.notesToSources);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const second = (await alice.query(api.sources.list, { projectId }))[1];
    expect(second).toMatchObject({
      name: "Week 2 - A - B tests.md",
      title: "Week 2: A/B tests?",
    });
    expect(await markdownOf(t, source._id)).toBe("# Lecture 1\n\nFirst.\n\nSecond.\n");
  });
});
