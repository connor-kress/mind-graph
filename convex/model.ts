import { v, type Infer } from "convex/values";

/**
 * A node as the client sees it. `key` is generated on the client so that
 * optimistic updates, selection, and undo can refer to a node before the
 * server has acknowledged it.
 *
 * - The root has `isRoot: true` and no parent.
 * - Tree nodes have a `parentKey`; their position is computed by the layout.
 * - Floating nodes have neither, and store `x`/`y` relative to the root.
 */
export const nodeFields = {
  key: v.string(),
  label: v.string(),
  parentKey: v.optional(v.string()),
  order: v.number(),
  x: v.optional(v.number()),
  y: v.optional(v.number()),
  isRoot: v.boolean(),
};

export const MAX_LABEL_LENGTH = 500;

export const nodeValidator = v.object(nodeFields);

export type MapNode = Infer<typeof nodeValidator>;

export const mapKind = v.union(v.literal("reference"), v.literal("recall"));

/**
 * A recall node the student linked by hand to a reference node it didn't
 * match, e.g. a misspelling. `correct` says whether it counts as recalled or
 * is only associated, so its children are still compared.
 */
export const linkValidator = v.object({
  nodeKey: v.string(),
  refKey: v.string(),
  correct: v.boolean(),
});

export type ManualLink = Infer<typeof linkValidator>;

/** File types that can be added as source notes, by extension. */
export const SOURCE_KINDS = {
  md: "md",
  markdown: "md",
  txt: "txt",
  docx: "docx",
  pdf: "pdf",
  pptx: "pptx",
} as const;

export type SourceKind = (typeof SOURCE_KINDS)[keyof typeof SOURCE_KINDS];

export const sourceKind = v.union(
  v.literal("md"),
  v.literal("txt"),
  v.literal("docx"),
  v.literal("pdf"),
  v.literal("pptx"),
);

/**
 * Where a source is in becoming a Markdown note. Markdown and text files are
 * ready immediately; other files wait for the document runner to transcribe them.
 */
export const sourceStatus = v.union(
  v.literal("queued"),
  v.literal("processing"),
  v.literal("ready"),
  v.literal("failed"),
);

/** Files that are already notes, so they need no transcription. */
export function isNoteFile(kind: SourceKind) {
  return kind === "md" || kind === "txt";
}

export const MAX_SOURCE_BYTES = 15 * 1024 * 1024;

/** Pages (or slides) the document runner transcribes at most. It enforces its own copy. */
export const MAX_SOURCE_PAGES = 75;

/** Files whose text is transcribed but not their images. */
export function losesImages(kind: SourceKind | undefined) {
  return kind === "docx" || kind === "pptx";
}

export const MAX_SOURCE_NAME_LENGTH = 255;

/** Matches file names, so a title taken from an uploaded file's name always fits. */
export const MAX_SOURCE_TITLE_LENGTH = MAX_SOURCE_NAME_LENGTH;

/** An open tab in the notes panel: a note, or without one, the project's files. */
export const noteTabValidator = v.object({
  id: v.string(),
  sourceId: v.optional(v.id("sources")),
});

export type NoteTab = Infer<typeof noteTabValidator>;

/** Tabs someone can have open at once on a map. */
export const MAX_NOTE_TABS = 20;

/**
 * A note's title from its file name, e.g. "Lecture_3 - cells.pdf" becomes
 * "Lecture 3 - cells". Falls back to the name as written if that leaves nothing.
 */
export function titleFromFileName(name: string) {
  const dot = name.lastIndexOf(".");
  const stem = dot === -1 ? name : name.slice(0, dot);
  return tidyTitle(stem.replaceAll("_", " ")) || tidyTitle(stem) || tidyTitle(name);
}

/** A title as it's kept: on one line, with runs of spaces collapsed. */
export function tidyTitle(title: string) {
  return title.replace(/\s+/g, " ").trim();
}

/** A tidy title cut to fit, without ending in a space or half a character such as an emoji. */
export function fitTitle(title: string) {
  let fitted = tidyTitle(title).slice(0, MAX_SOURCE_TITLE_LENGTH);
  if (/[\uD800-\uDBFF]$/.test(fitted)) fitted = fitted.slice(0, -1);
  return fitted.trimEnd();
}

/** The kind of a file, from its name, or undefined if it isn't supported. */
export function kindOfFile(name: string): SourceKind | undefined {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return Object.hasOwn(SOURCE_KINDS, ext)
    ? SOURCE_KINDS[ext as keyof typeof SOURCE_KINDS]
    : undefined;
}

/** Why a file can't be added as a source, or null if it can. */
export function fileProblem(name: string, size: number) {
  if (!kindOfFile(name)) return `${name} isn't a supported file type`;
  if (size > MAX_SOURCE_BYTES) return `${name} is larger than ${MAX_SOURCE_BYTES / 1024 / 1024} MB`;
  if (name.length > MAX_SOURCE_NAME_LENGTH) return "That file name is too long";
  return null;
}
