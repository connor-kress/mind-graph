import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { MAX_LABEL_LENGTH, nodeValidator, type MapNode } from "./model";

const MAX_BATCH = 2000;

export const list = query({
  args: { mapId: v.id("maps") },
  handler: async (ctx, { mapId }): Promise<MapNode[]> => {
    const docs = await ctx.db
      .query("nodes")
      .withIndex("by_map_key", (q) => q.eq("mapId", mapId))
      .collect();
    return docs.map(({ key, label, parentKey, order, x, y, isRoot }) => ({
      key,
      label,
      parentKey,
      order,
      x,
      y,
      isRoot,
    }));
  },
});

/**
 * Applies a batch of node changes atomically. Every edit in the editor
 * (including undo and redo) is expressed as one of these batches. The batch is
 * rejected if it would break the structure around the nodes it touches (one
 * tree plus floating nodes), e.g. when concurrent edits would create a cycle
 * or an orphan. Only touched nodes are checked, so one bad row can't block
 * every later edit.
 */
export const apply = mutation({
  args: {
    mapId: v.id("maps"),
    upserts: v.array(nodeValidator),
    removes: v.array(v.string()),
  },
  handler: async (ctx, { mapId, upserts, removes }) => {
    if (upserts.length + removes.length > MAX_BATCH) {
      throw new ConvexError("Too many changes at once");
    }
    if (!(await ctx.db.get(mapId))) {
      throw new ConvexError("Map not found");
    }
    const upsertKeys = new Set(upserts.map((n) => n.key));
    if (upsertKeys.size !== upserts.length || removes.some((key) => upsertKeys.has(key))) {
      throw new ConvexError("Each node can only change once per batch");
    }
    const docs = await ctx.db
      .query("nodes")
      .withIndex("by_map_key", (q) => q.eq("mapId", mapId))
      .collect();
    const docByKey = new Map(docs.map((doc) => [doc.key, doc]));
    // The map as it will be after this batch.
    const nodes = new Map<string, MapNode>(docs.map((doc) => [doc.key, doc]));
    const touched = new Set<string>();

    for (const key of removes) {
      const doc = docByKey.get(key);
      if (!doc || doc.isRoot) continue;
      await ctx.db.delete(doc._id);
      nodes.delete(key);
      touched.add(key);
    }
    for (const node of upserts) {
      if (node.label.length > MAX_LABEL_LENGTH) {
        throw new ConvexError("Label is too long");
      }
      const doc = docByKey.get(node.key);
      // The root is fixed at the origin and never has a parent.
      const next = doc?.isRoot
        ? { ...node, parentKey: undefined, x: undefined, y: undefined, isRoot: true }
        : { ...node, isRoot: false };
      if (doc) await ctx.db.replace(doc._id, { mapId, ...next });
      else await ctx.db.insert("nodes", { mapId, ...next });
      nodes.set(node.key, next);
      touched.add(node.key);
    }

    // Check touched nodes and their children (whose parent may have changed).
    const toCheck = new Set([...touched].filter((key) => nodes.has(key)));
    for (const node of nodes.values()) {
      if (node.parentKey !== undefined && touched.has(node.parentKey)) toCheck.add(node.key);
    }
    for (const key of toCheck) assertPlaced(nodes, key);
  },
});

/** A node must be the root, floating, or reach the root through its ancestors. */
function assertPlaced(nodes: Map<string, MapNode>, key: string) {
  const seen = new Set<string>();
  let current = nodes.get(key);
  while (current && !current.isRoot && current.parentKey !== undefined) {
    if (seen.has(current.key)) throw new ConvexError("That change would create a cycle");
    seen.add(current.key);
    const parent = nodes.get(current.parentKey);
    if (!parent) throw new ConvexError("That node's parent no longer exists");
    if (!parent.isRoot && parent.parentKey === undefined) {
      throw new ConvexError("Floating nodes can't have children");
    }
    current = parent;
  }
}
