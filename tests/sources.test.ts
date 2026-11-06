import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  MAX_SOURCE_BYTES,
  MAX_SOURCE_NAME_LENGTH,
  MAX_SOURCE_TITLE_LENGTH,
  titleFromFileName,
} from "../convex/model";
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

type UploadResult = { sourceId?: Id<"sources">; error?: string };

/** Uploads a file the way the client does: asks for an upload URL, then posts to it. */
async function upload(
  t: T,
  user: User,
  projectId: Id<"projects">,
  name: string,
  data: string | Uint8Array<ArrayBuffer>,
): Promise<{ result: UploadResult; status?: number }> {
  const body = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let url;
  try {
    url = await user.mutation(api.sources.prepareUpload, { projectId, name, size: body.length });
  } catch (error) {
    return { result: { error: error instanceof ConvexError ? String(error.data) : String(error) } };
  }
  const response = await post(t, url, body);
  return { result: (await response.json()) as UploadResult, status: response.status };
}

/** Posts bytes to an upload URL from `prepareUpload`. */
function post(t: T, url: string, body: Uint8Array<ArrayBuffer> | string) {
  return t.fetch(url.slice(url.indexOf("/sources/upload")), { method: "POST", body });
}

function prepare(user: User, projectId: Id<"projects">, size: number) {
  return user.mutation(api.sources.prepareUpload, { projectId, name: "Notes.md", size });
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

  test("cut to fit end without a space or half an emoji", async () => {
    const { t, alice, projectId } = await fixture();
    const max = MAX_SOURCE_TITLE_LENGTH;
    for (const title of [`${"a".repeat(max - 1)} b`, `${"b".repeat(max - 1)}😀`])
      await t.action(internal.sources.importText, { projectId, name: "A.md", title, text: "" });
    const titles = (await alice.query(api.sources.list, { projectId })).map((s) => s.title);
    expect(titles).toEqual(["a".repeat(max - 1), "b".repeat(max - 1)]);
    // A file name too long for a title can't be added at all.
    await expect(
      t.action(internal.sources.importText, {
        projectId,
        name: `${"c".repeat(MAX_SOURCE_NAME_LENGTH)}.md`,
        title: "",
        text: "",
      }),
    ).rejects.toThrow("That file name is too long");
  });
});

describe("source notes", () => {
  test("Markdown and text files are notes as soon as they're added", async () => {
    const { t, alice, projectId } = await fixture();
    const { result } = await upload(t, alice, projectId, "Lecture 1.md", "# Cells");
    const sourceId = result.sourceId!;
    expect(await alice.query(api.sources.list, { projectId })).toEqual([
      {
        _id: sourceId,
        name: "Lecture 1.md",
        title: "Lecture 1",
        kind: "md",
        size: 7,
        status: "ready",
        runStats: null,
      },
    ]);
    const source = await alice.query(api.sources.open, { sourceId });
    expect(source).toMatchObject({ status: "ready", originalUrl: null });
    expect(source?.markdownUrl).toBeTruthy();
    // The file is its own note: nothing else is stored.
    const stored = await t.run((ctx) => ctx.db.get(sourceId));
    expect(stored?.markdownId).toBe(stored?.storageId);
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

  test("unsupported and oversized files are turned away before anything is stored", async () => {
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

    await expect(
      t.mutation(api.sources.prepareUpload, { projectId, name: "A.md", size: 1 }),
    ).rejects.toThrow("Sign in to continue");
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

  test("an upload stores only what its ticket allows, once", async () => {
    const { t, alice, projectId } = await fixture();
    // More, or less, than was asked for.
    expect((await post(t, await prepare(alice, projectId, 3), "12345")).status).toBe(400);
    expect((await post(t, await prepare(alice, projectId, 3), "12")).status).toBe(400);
    // Each ticket works once.
    const url = await prepare(alice, projectId, 3);
    expect((await post(t, url, "123")).status).toBe(200);
    const again = await post(t, url, "456");
    expect(again.status).toBe(403);
    expect(await again.json()).toEqual({ error: "This upload expired. Try again." });
    // An unknown or missing ticket.
    expect(
      (await t.fetch("/sources/upload?token=nope", { method: "POST", body: "1" })).status,
    ).toBe(403);
    expect((await t.fetch("/sources/upload", { method: "POST", body: "1" })).status).toBe(403);

    expect(await alice.query(api.sources.list, { projectId })).toHaveLength(1);
    expect(await storedFiles(t)).toBe(1);
    expect(await t.run((ctx) => ctx.db.query("sourceUploads").collect())).toEqual([]);
  });

  test("a ticket expires, and stops working if its user leaves the project", async () => {
    const { t, alice, bob, projectId } = await fixture();
    const expired = await prepare(alice, projectId, 1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.query("sourceUploads").collect())).toEqual([]);
    expect((await post(t, expired, "1")).status).toBe(403);

    const membershipId = await t.run((ctx) =>
      ctx.db.insert("projectMembers", {
        projectId,
        userId: "https://clerk.test|bob",
        role: "member",
      }),
    );
    const removed = await prepare(bob, projectId, 1);
    await t.run((ctx) => ctx.db.delete(membershipId));
    expect((await post(t, removed, "1")).status).toBe(403);

    // The project was deleted, which deletes its tickets too.
    const deleted = await prepare(alice, projectId, 1);
    await alice.mutation(api.library.deleteProject, { projectId, confirmation: "Biology" });
    expect(await t.run((ctx) => ctx.db.query("sourceUploads").collect())).toEqual([]);
    expect((await post(t, deleted, "1")).status).toBe(403);
    expect(await storedFiles(t)).toBe(0);
  });

  test("a file is added only if its user can still add to the project once it's stored", async () => {
    const { t, alice, projectId } = await fixture();
    const userId = "https://clerk.test|alice";
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["12"])));
    const complete = (fields: { size?: number; projectId?: Id<"projects"> } = {}) =>
      t.mutation(internal.sources.completeUpload, {
        projectId,
        userId,
        name: "A.md",
        size: 2,
        storageId,
        ...fields,
      });
    await expect(complete({ size: 3 })).rejects.toThrow("The upload didn't finish");
    // A member who has left the project, which still exists.
    const bob = "https://clerk.test|bob";
    const membershipId = await t.run((ctx) =>
      ctx.db.insert("projectMembers", { projectId, userId: bob, role: "member" }),
    );
    await t.run((ctx) => ctx.db.delete(membershipId));
    await expect(
      t.mutation(internal.sources.completeUpload, {
        projectId,
        userId: bob,
        name: "A.md",
        size: 2,
        storageId,
      }),
    ).rejects.toThrow("Project not found");
    await alice.mutation(api.library.deleteProject, { projectId, confirmation: "Biology" });
    await expect(complete()).rejects.toThrow("Project not found");
    expect(await t.run((ctx) => ctx.db.query("sources").collect())).toEqual([]);
  });

  test("a member who leaves while sending a file doesn't add it, and nothing is kept", async () => {
    const { t, bob, projectId } = await fixture();
    const membershipId = await t.run((ctx) =>
      ctx.db.insert("projectMembers", {
        projectId,
        userId: "https://clerk.test|bob",
        role: "member",
      }),
    );
    const url = await prepare(bob, projectId, 4);
    // The second half waits until the test lets it through.
    let sendRest!: () => void;
    const rest = new Promise<void>((resolve) => (sendRest = resolve));
    let started!: () => void;
    const sending = new Promise<void>((resolve) => (started = resolve));
    let piece = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        piece++;
        if (piece === 1) controller.enqueue(new TextEncoder().encode("12"));
        else if (piece === 2) {
          started();
          await rest;
          controller.enqueue(new TextEncoder().encode("34"));
        } else controller.close();
      },
    });
    const response = t.fetch(url.slice(url.indexOf("/sources/upload")), {
      method: "POST",
      body,
      // @ts-expect-error Node's fetch needs this for a streamed body.
      duplex: "half",
    });
    await sending;
    await t.run((ctx) => ctx.db.delete(membershipId));
    sendRest();
    const result = await response;
    expect(result.status).toBe(403);
    expect(result.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await result.json()).toEqual({ error: "Project not found" });
    expect(await t.run((ctx) => ctx.db.query("sources").collect())).toEqual([]);
    expect(await storedFiles(t)).toBe(0);
  });

  test("a body sent in pieces is read whole, and too much in a later piece is refused", async () => {
    const { t, alice, projectId } = await fixture();
    const stream = (...pieces: string[]) =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const piece of pieces) controller.enqueue(new TextEncoder().encode(piece));
          controller.close();
        },
      });
    const send = async (size: number, ...pieces: string[]) => {
      const url = await prepare(alice, projectId, size);
      return t.fetch(url.slice(url.indexOf("/sources/upload")), {
        method: "POST",
        body: stream(...pieces),
        // @ts-expect-error Node's fetch needs this for a streamed body.
        duplex: "half",
      });
    };
    const whole = await send(6, "# ", "Hi", "!\n");
    const { sourceId } = (await whole.json()) as UploadResult;
    expect(await markdownOf(t, sourceId!)).toBe("# Hi!\n");
    expect((await send(4, "12", "345")).status).toBe(400);
    expect((await send(0, "1")).status).toBe(400);
    expect(await storedFiles(t)).toBe(1);
  });

  test("an expired ticket is refused even before it's cleaned up", async () => {
    const { t, alice, projectId } = await fixture();
    const url = await prepare(alice, projectId, 1);
    // Later, without running the scheduled cleanup.
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect((await post(t, url, "1")).status).toBe(403);
  });

  test("a ticket can be claimed only once, even at the same time", async () => {
    const { t, alice, projectId } = await fixture();
    const url = await prepare(alice, projectId, 1);
    const token = new URL(url, "https://site.test").searchParams.get("token")!;
    const claims = await Promise.all([
      t.mutation(internal.sources.claimUpload, { token }),
      t.mutation(internal.sources.claimUpload, { token }),
    ]);
    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
  });

  test("an empty file can be added, but not a nonsense size", async () => {
    const { t, alice, projectId } = await fixture();
    const { result } = await upload(t, alice, projectId, "Empty.md", "");
    expect(result.sourceId).toBeDefined();
    for (const size of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      await expect(prepare(alice, projectId, size)).rejects.toThrow("Invalid file size");
  });

  test("the upload URL is on the deployment's site, which allows the app's requests", async () => {
    const { t, alice, projectId } = await fixture();
    vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
    try {
      expect(await prepare(alice, projectId, 1)).toMatch(
        /^https:\/\/example\.convex\.site\/sources\/upload\?token=[\w-]+$/,
      );
    } finally {
      vi.unstubAllEnvs();
    }
    const preflight = await t.fetch("/sources/upload", { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
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
    ).rejects.toThrow("unsupported.exe isn't a supported file type");
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
