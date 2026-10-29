import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { demoLibrary, type SeedNode } from "./seedData";
import { requireOwner, requireTopic, requireMap } from "./auth";

/**
 * A topic with its maps: the one asked for, or the first one if it's missing
 * or unknown (the id comes from the URL, so it may be stale or malformed).
 */
export const get = query({
  args: { topicId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ownerId = await requireOwner(ctx);
    const topicId = args.topicId && ctx.db.normalizeId("topics", args.topicId);
    const requested = topicId ? await ctx.db.get(topicId) : null;
    const topic =
      requested?.ownerId === ownerId
        ? requested
        : await ctx.db
            .query("topics")
            .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
            .first();
    if (!topic) return null;
    const folder = topic.folderId && (await ctx.db.get(topic.folderId));
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
      folderName: folder ? folder.name : (topic.course ?? null),
      referenceMapId: reference?._id ?? null,
      /** The recall attempt being worked on, if any. */
      recallMapId: inProgress?._id ?? null,
      /** The most recently finished attempt, shown in Compare. */
      resultMapId: finished?._id ?? null,
    };
  },
});

/** Creates a private demo library once for each account. Legacy data stays unclaimed. */
export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const ownerId = await requireOwner(ctx);
    const initialized = await ctx.db
      .query("libraries")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .first();
    if (initialized) return;
    await ctx.db.insert("libraries", { ownerId });
    if (
      await ctx.db
        .query("folders")
        .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
        .first()
    )
      return;
    const folderIds = new Map<string, Id<"folders">>();
    const folderFor = async (name: string) => {
      let folderId = folderIds.get(name);
      if (!folderId) {
        folderId = await ctx.db.insert("folders", { ownerId, name, order: folderIds.size });
        folderIds.set(name, folderId);
      }
      return folderId;
    };
    for (const folder of demoLibrary) await folderFor(folder.name);

    for (const folder of demoLibrary) {
      for (const map of folder.maps) {
        const topicId = await ctx.db.insert("topics", {
          ownerId,
          folderId: await folderFor(folder.name),
          title: map.title,
          notes: map.notes,
        });
        const mapId = await ctx.db.insert("maps", { topicId, kind: "reference" });
        await insertTree(ctx, mapId, { label: map.title, children: map.children }, undefined, 0);
      }
    }
  },
});

/** Returns the in-progress recall attempt, creating one if needed. */
export const startRecall = mutation({
  args: { topicId: v.id("topics") },
  handler: async (ctx, { topicId }) => {
    const topic = await requireTopic(ctx, topicId);
    const inProgress = await inProgressRecall(ctx, topicId);
    if (inProgress) return inProgress._id;

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
    const map = await requireMap(ctx, mapId);
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
    const map = await requireMap(ctx, mapId);
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

export async function insertTree(
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
