import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
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
    const recall = await ctx.db
      .query("maps")
      .withIndex("by_topic_kind", (q) => q.eq("topicId", topic._id).eq("kind", "recall"))
      .order("desc")
      .first();
    return {
      topic,
      referenceMapId: reference?._id ?? null,
      recallMapId: recall && !recall.finishedAt ? recall._id : null,
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
    const latest = await ctx.db
      .query("maps")
      .withIndex("by_topic_kind", (q) => q.eq("topicId", topicId).eq("kind", "recall"))
      .order("desc")
      .first();
    if (latest && !latest.finishedAt) return latest._id;

    const topic = await ctx.db.get(topicId);
    if (!topic) throw new ConvexError("Topic not found");
    const mapId = await ctx.db.insert("maps", { topicId, kind: "recall" });
    // The root is given; everything else is recalled from memory.
    await insertTree(ctx, mapId, { label: topic.title }, undefined, 0);
    return mapId;
  },
});

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
