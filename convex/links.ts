import { ConvexError, v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { linkValidator, type ManualLink } from "./model";

import { requireMap } from "./auth";

const MAX_LINKS = 2000;

/** A finished attempt's manual links. */
export const list = query({
  args: { mapId: v.id("maps") },
  handler: async (ctx, { mapId }): Promise<ManualLink[]> => {
    const map = await requireMap(ctx, mapId);
    return map?.links ?? [];
  },
});

/**
 * Replaces a finished attempt's manual links (so undo is just setting the
 * previous list). Links to nodes that no longer exist, or to floating nodes
 * (which aren't compared), are dropped.
 */
export const set = mutation({
  args: { mapId: v.id("maps"), links: v.array(linkValidator) },
  handler: async (ctx, { mapId, links }) => {
    if (links.length > MAX_LINKS) throw new ConvexError("Too many links");
    const map = await requireMap(ctx, mapId);
    if (!map || map.kind !== "recall") throw new ConvexError("Recall attempt not found");
    if (!map.finishedAt) throw new ConvexError("Finish the attempt before linking nodes");
    const reference = await ctx.db
      .query("maps")
      .withIndex("by_topic_kind", (q) => q.eq("topicId", map.topicId).eq("kind", "reference"))
      .first();
    if (!reference) throw new ConvexError("Reference map not found");

    const nodeKeys = new Set<string>();
    const refKeys = new Set<string>();
    for (const link of links) {
      if (nodeKeys.has(link.nodeKey) || refKeys.has(link.refKey)) {
        throw new ConvexError("Each node can only be linked once");
      }
      nodeKeys.add(link.nodeKey);
      refKeys.add(link.refKey);
    }

    const attemptNodes = await treeKeys(ctx, mapId);
    const referenceNodes = await treeKeys(ctx, reference._id);
    await ctx.db.patch(mapId, {
      links: links.filter((l) => attemptNodes.has(l.nodeKey) && referenceNodes.has(l.refKey)),
    });
  },
});

/** Keys of a map's non-root tree nodes. */
async function treeKeys(ctx: QueryCtx, mapId: Id<"maps">) {
  const nodes = await ctx.db
    .query("nodes")
    .withIndex("by_map_key", (q) => q.eq("mapId", mapId))
    .collect();
  return new Set(nodes.filter((n) => n.parentKey !== undefined).map((n) => n.key));
}
