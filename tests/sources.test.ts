import { convexTest } from "convex-test";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { EXTRACTOR_VERSION, MAX_SOURCE_BYTES, type Block } from "../convex/model";
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
async function upload(
  t: T,
  user: User,
  topicId: Id<"topics">,
  name: string,
  data: string | Uint8Array<ArrayBuffer>,
) {
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

/** A PDF with Helvetica (F1) and Helvetica Bold (F2), one content stream per page. */
function pdf(pages: string[][]) {
  const font = (name: string) =>
    `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + 2 * i} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    font("Helvetica"),
    font("Helvetica-Bold"),
  ];
  for (const [i, lines] of pages.entries()) {
    const stream = lines.join("\n");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + 2 * i} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  let out = "%PDF-1.4\n";
  const offsets = objects.map((object, i) => {
    const offset = out.length;
    out += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return strToU8(out);
}

const NS = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;

/** A text shape; `ph` is its placeholder element, if any. */
function shape(ph: string, paragraphs: string[]) {
  const body = paragraphs.map((p) => `<a:p>${p}</a:p>`).join("");
  return `<p:sp><p:nvSpPr><p:cNvPr id="1" name=""/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${body}</p:txBody></p:sp>`;
}

const run = (text: string) => `<a:r><a:rPr lang="en-US"/><a:t>${text}</a:t></a:r>`;

const slide = (shapes: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${shapes}</p:spTree></p:cSld></p:sld>`;

/** A two-slide presentation whose slide files are listed out of order. */
function pptx() {
  const cell = (text: string) =>
    `<a:tc><a:txBody><a:bodyPr/><a:p>${run(text)}</a:p></a:txBody></a:tc>`;
  const row = (...cells: string[]) => `<a:tr h="1">${cells.map(cell).join("")}</a:tr>`;
  return zipSync({
    "ppt/presentation.xml": strToU8(
      `<p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`,
    ),
    "ppt/_rels/presentation.xml.rels": strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="slide" Target="slides/slide2.xml"/><Relationship Id="rId3" Type="slide" Target="slides/slide1.xml"/></Relationships>`,
    ),
    "ppt/slides/slide1.xml": strToU8(
      slide(
        shape(`<p:ph type="ctrTitle"/>`, [run("Photosynthesis")]) +
          shape(`<p:ph type="subTitle" idx="1"/>`, [run("Unit 3 &amp; ") + run("review")]),
      ),
    ),
    "ppt/slides/slide2.xml": strToU8(
      slide(
        shape(`<p:ph type="title"/>`, [run("Stages")]) +
          shape(`<p:ph idx="1"/>`, [
            run("Light reactions"),
            `<a:pPr lvl="1"/>${run("Thylakoid")}`,
            run("Calvin cycle"),
            `<a:pPr><a:buNone/></a:pPr>${run("Both happen in chloroplasts.")}`,
            "",
          ]) +
          shape("", [run("Remember this")]) +
          shape(`<p:ph type="sldNum" idx="12"/>`, [
            `<a:fld id="x" type="slidenum"><a:t>2</a:t></a:fld>`,
          ]) +
          `<p:graphicFrame><a:graphic><a:graphicData><a:tbl>${row("Stage", "Where")}${row("Light", "Thylakoid")}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`,
      ),
    ),
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

  test("PowerPoint slides are read in order, with titles as headings", async () => {
    const { t, alice, topicId } = await fixture();
    const { result } = await upload(t, alice, topicId, "Unit 3.pptx", pptx());
    const sourceId = result.sourceId!;
    expect(await blocksOf(t, sourceId)).toEqual([
      { type: "heading", level: 1, text: "Photosynthesis", page: 1 },
      { type: "paragraph", text: "Unit 3 & review", page: 1 },
      { type: "heading", level: 2, text: "Stages", page: 2 },
      {
        type: "list",
        ordered: false,
        items: [
          { text: "Light reactions", items: [{ text: "Thylakoid" }] },
          { text: "Calvin cycle" },
        ],
        page: 2,
      },
      { type: "paragraph", text: "Both happen in chloroplasts.", page: 2 },
      { type: "paragraph", text: "Remember this", page: 2 },
      {
        type: "table",
        rows: [
          ["Stage", "Where"],
          ["Light", "Thylakoid"],
        ],
        page: 2,
      },
    ]);
    expect(await alice.query(api.sources.open, { sourceId })).toMatchObject({ pageCount: 2 });
  });

  test("PDF text is read into headings by font, paragraphs, and lists", async () => {
    const { t, alice, topicId } = await fixture();
    const { result } = await upload(
      t,
      alice,
      topicId,
      "Cells.pdf",
      pdf([
        [
          "BT /F2 20 Tf 72 720 Td (Cell Biology) Tj ET",
          "BT /F1 11 Tf 72 690 Td (Cells are the basic unit) Tj 0 -13 Td (of life.) Tj ET",
          "BT /F1 11 Tf 72 650 Td (A second para-) Tj 0 -13 Td (graph here.) Tj ET",
          "BT /F2 11 Tf 72 610 Td (Organelles) Tj ET",
          "BT /F1 11 Tf 72 590 Td (\\225 Nucleus) Tj 0 -14 Td (\\225 Mitochondria, which make) Tj ET",
          "BT /F1 11 Tf 82 563 Td (energy) Tj ET",
          "BT /F1 11 Tf 72 549 Td (\\225 Ribosomes) Tj ET",
          "BT /F1 11 Tf 300 40 Td (1) Tj ET",
        ],
        ["BT /F1 11 Tf 72 720 Td (Page two text.) Tj ET"],
      ]),
    );
    const sourceId = result.sourceId!;
    expect(await blocksOf(t, sourceId)).toEqual([
      { type: "heading", level: 1, text: "Cell Biology", page: 1 },
      { type: "paragraph", text: "Cells are the basic unit of life.", page: 1 },
      { type: "paragraph", text: "A second paragraph here.", page: 1 },
      { type: "heading", level: 2, text: "Organelles", page: 1 },
      {
        type: "list",
        ordered: false,
        items: [
          { text: "Nucleus" },
          { text: "Mitochondria, which make energy" },
          { text: "Ribosomes" },
        ],
        page: 1,
      },
      { type: "paragraph", text: "Page two text.", page: 2 },
    ]);
    expect(await alice.query(api.sources.open, { sourceId })).toMatchObject({ pageCount: 2 });
  });

  test("a PDF without text is read as empty, and unreadable files fail", async () => {
    const { t, alice, topicId } = await fixture();
    const scan = await upload(t, alice, topicId, "Scan.pdf", pdf([["0 0 m 100 100 l S"]]));
    const broken = await upload(t, alice, topicId, "Broken.pdf", "%PDF-1.7");
    const docx = await upload(t, alice, topicId, "Broken.docx", "not a zip");
    expect(await alice.query(api.sources.list, { topicId })).toMatchObject([
      { _id: scan.result.sourceId, status: "ready" },
      { _id: broken.result.sourceId, status: "failed" },
      { _id: docx.result.sourceId, status: "failed" },
    ]);
    expect(await blocksOf(t, scan.result.sourceId!)).toEqual([]);

    await alice.mutation(api.sources.retry, { sourceId: docx.result.sourceId! });
    expect((await alice.query(api.sources.list, { topicId }))[2].status).toBe("processing");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await alice.query(api.sources.list, { topicId }))[2].status).toBe("failed");
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

  test("sources read by an older extractor are read again", async () => {
    const { t, topicId } = await fixture();
    // A presentation added before slides could be read.
    const sourceId = await t.run(async (ctx) =>
      ctx.db.insert("sources", {
        topicId,
        storageId: await ctx.storage.store(new Blob([pptx()])),
        name: "Unit 3.pptx",
        kind: "pptx",
        size: 1,
        status: "ready",
        extractorVersion: 1,
      }),
    );
    await t.mutation(internal.migrations.reextractSources);
    expect((await t.run((ctx) => ctx.db.get(sourceId)))?.status).toBe("processing");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.get(sourceId))).toMatchObject({
      status: "ready",
      pageCount: 2,
      extractorVersion: EXTRACTOR_VERSION,
    });
    expect(await blocksOf(t, sourceId)).toHaveLength(7);

    // Already current: nothing to do.
    await t.mutation(internal.migrations.reextractSources);
    expect((await t.run((ctx) => ctx.db.get(sourceId)))?.status).toBe("ready");
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
