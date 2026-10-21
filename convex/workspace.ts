import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { demoNotes, demoReferenceTree, demoTopic, type SeedNode } from "./seedData";

/** The single demo topic (until auth exists), with its maps. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const topic = await ctx.db.query("topics").first();
    if (!topic) return null;
    const reference = await ctx.db
      .query("maps")
      .withIndex("by_topic_kind", (q) => q.eq("topicId", topic._id).eq("kind", "reference"))
      .first();
    const inProgress = await inProgressRecall(ctx, topic._id);
    const finished = await ctx.db
      .query("maps")
      .withIndex("by_topic_kind_finished", (q) =>
        q.eq("topicId", topic._id).eq("kind", "recall").gt("finishedAt", 0),
      )
      .order("desc")
      .first();
    return {
      topic,
      referenceMapId: reference?._id ?? null,
      /** The recall attempt being worked on, if any. */
      recallMapId: inProgress?._id ?? null,
      /** The most recently finished attempt, shown in Compare. */
      resultMapId: finished?._id ?? null,
    };
  },
});

/** Creates the demo topic and reference map if they don't exist yet. */
export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    if (await ctx.db.query("topics").first()) return;
    const topicId = await ctx.db.insert("topics", {
      ...demoTopic,
      notes: demoNotes,
    });
    const mapId = await ctx.db.insert("maps", { topicId, kind: "reference" });
    await insertTree(ctx, mapId, demoReferenceTree, undefined, 0);
  },
});

/** Returns the in-progress recall attempt, creating one if needed. */
export const startRecall = mutation({
  args: { topicId: v.id("topics") },
  handler: async (ctx, { topicId }) => {
    const inProgress = await inProgressRecall(ctx, topicId);
    if (inProgress) return inProgress._id;

    const topic = await ctx.db.get(topicId);
    if (!topic) throw new ConvexError("Topic not found");
    const mapId = await ctx.db.insert("maps", { topicId, kind: "recall" });
    // The root is given; everything else is recalled from memory.
    await insertTree(ctx, mapId, { label: topic.title }, undefined, 0);
    return mapId;
  },
});

/**
 * Locks an in-progress recall attempt so it can be compared. Floating nodes
 * are discarded: only the tree is compared (the client warns about this).
 */
export const finishRecall = mutation({
  args: { mapId: v.id("maps") },
  handler: async (ctx, { mapId }) => {
    const map = await ctx.db.get(mapId);
    if (!map || map.kind !== "recall") throw new ConvexError("Recall attempt not found");
    if (map.finishedAt) return;
    const nodes = await ctx.db
      .query("nodes")
      .withIndex("by_map_key", (q) => q.eq("mapId", mapId))
      .collect();
    for (const node of nodes) {
      if (!node.isRoot && node.parentKey === undefined) await ctx.db.delete(node._id);
    }
    await ctx.db.patch(mapId, { finishedAt: Date.now() });
  },
});

/** Deletes an in-progress recall attempt. */
export const abandonRecall = mutation({
  args: { mapId: v.id("maps") },
  handler: async (ctx, { mapId }) => {
    const map = await ctx.db.get(mapId);
    if (!map) return;
    if (map.kind !== "recall" || map.finishedAt) {
      throw new ConvexError("Only a recall attempt in progress can be abandoned");
    }
    const nodes = await ctx.db
      .query("nodes")
      .withIndex("by_map_key", (q) => q.eq("mapId", mapId))
      .collect();
    for (const node of nodes) await ctx.db.delete(node._id);
    await ctx.db.delete(mapId);
  },
});

/** The topic's recall attempt in progress (there's at most one). */
function inProgressRecall(ctx: QueryCtx, topicId: Id<"topics">) {
  return ctx.db
    .query("maps")
    .withIndex("by_topic_kind_finished", (q) =>
      q.eq("topicId", topicId).eq("kind", "recall").eq("finishedAt", undefined),
    )
    .first();
}

async function insertTree(
  ctx: MutationCtx,
  mapId: Id<"maps">,
  node: SeedNode,
  parentKey: string | undefined,
  order: number,
) {
  const key = crypto.randomUUID();
  await ctx.db.insert("nodes", {
    mapId,
    key,
    label: node.label,
    parentKey,
    order,
    isRoot: parentKey === undefined,
  });
  for (const [i, child] of (node.children ?? []).entries()) {
    await insertTree(ctx, mapId, child, key, i);
  }
}
