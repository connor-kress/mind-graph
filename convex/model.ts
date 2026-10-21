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
