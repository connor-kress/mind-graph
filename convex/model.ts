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

export const MAX_SOURCE_BYTES = 15 * 1024 * 1024;

export const MAX_SOURCE_NAME_LENGTH = 255;

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

export type ListItem = { text: string; items?: ListItem[] };

/**
 * A source's text with its structure, as extracted from the file. Stored as a
 * JSON file rather than in the database, since it can exceed document limits.
 */
export type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: ListItem[] }
  | { type: "table"; rows: string[][] };

/** Bumped when extraction improves, so older sources can be read again. */
export const EXTRACTOR_VERSION = 1;
