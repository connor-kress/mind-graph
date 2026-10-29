import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { demoLibrary, notesMarkdown, type SeedNode } from "./seedData";
import { requireUser, requireTopic, requireMap, memberProjects, projectMembership } from "./auth";

import {
  insertProject,
  migrateUserProjects,
  migrateFolder,
  migrateTopic,
} from "./projectMigration";

/**
 * A topic with its maps: the one asked for, or the first one if it's missing
 * or unknown (the id comes from the URL, so it may be stale or malformed).
 */
export const get = query({
  args: { topicId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const topicId = args.topicId && ctx.db.normalizeId("topics", args.topicId);
    const requested = topicId ? await ctx.db.get(topicId) : null;
    let topic =
      requested?.projectId &&
      (await projectMembership(ctx, requested.projectId, userId)) &&
      (await ctx.db.get(requested.projectId))
        ? requested
        : null;
    if (!topic) {
      for (const project of await memberProjects(ctx, userId)) {
        topic = await ctx.db
          .query("topics")
          .withIndex("by_project", (q) => q.eq("projectId", project._id))
          .first();
        if (topic) break;
      }
    }
    if (!topic) return null;
    const project = await ctx.db.get(topic.projectId!);
    const reference = await ctx.db
      .query("maps")
      .withIndex("by_topic_kind", (q) => q.eq("topicId", topic._id).eq("kind", "reference"))
      .first();
    const inProgress = await inProgressRecall(ctx, topic._id, userId);
    const finished = await ctx.db
      .query("maps")
      .withIndex("by_topic_user_kind_finished", (q) =>
        q.eq("topicId", topic._id).eq("userId", userId).eq("kind", "recall").gt("finishedAt", 0),
      )
      .order("desc")
      .first();
    return {
      topic,
      projectName: project!.name,
      referenceMapId: reference?._id ?? null,
      /** The recall attempt being worked on, if any. */
      recallMapId: inProgress?._id ?? null,
      /** The most recently finished attempt, shown in Compare. */
      resultMapId: finished?._id ?? null,
    };
  },
});

/** Migrate the account's old data, then initialize new accounts once. */
export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    await migrateUserProjects(ctx, userId);
    if (
      await ctx.db
        .query("libraries")
        .withIndex("by_owner", (q) => q.eq("ownerId", userId))
        .first()
    )
      return;
    await ctx.db.insert("libraries", { ownerId: userId });
    if ((await memberProjects(ctx, userId)).length) return;
    for (const [order, project] of demoLibrary.entries()) {
      const projectId = await insertProject(ctx, userId, project.name, order);
      for (const map of project.maps) {
        const topicId = await ctx.db.insert("topics", {
          projectId,
          title: map.title,
        });
        await ctx.scheduler.runAfter(0, internal.sources.importText, {
          topicId,
          name: `${map.notes.heading}.md`,
          text: notesMarkdown(map.notes),
        });
        const mapId = await ctx.db.insert("maps", { topicId, kind: "reference" });
        await insertTree(ctx, mapId, { label: map.title, children: map.children }, undefined, 0);
      }
    }
  },
});

/** Optional administrative backfill. Run each phase until isDone; it is safe to repeat. */
export const migrateProjects = internalMutation({
  args: {
    phase: v.union(v.literal("folders"), v.literal("topics")),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { phase, cursor }) => {
    if (phase === "folders") {
      const result = await ctx.db
        .query("folders")
        .paginate({ cursor: cursor ?? null, numItems: 25 });
      for (const folder of result.page) await migrateFolder(ctx, folder);
      return { cursor: result.continueCursor, isDone: result.isDone };
    }
    const result = await ctx.db.query("topics").paginate({ cursor: cursor ?? null, numItems: 25 });
    for (const topic of result.page) await migrateTopic(ctx, topic);
    return { cursor: result.continueCursor, isDone: result.isDone };
  },
});

/** Returns the in-progress recall attempt, creating one if needed. */
export const startRecall = mutation({
  args: { topicId: v.id("topics") },
  handler: async (ctx, { topicId }) => {
    const userId = await requireUser(ctx);
    const topic = await requireTopic(ctx, topicId);
    const inProgress = await inProgressRecall(ctx, topicId, userId);
    if (inProgress) return inProgress._id;

    const mapId = await ctx.db.insert("maps", { topicId, kind: "recall", userId });
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

/** Each member has their own attempt in progress for a topic. */
function inProgressRecall(ctx: QueryCtx, topicId: Id<"topics">, userId: string) {
  return ctx.db
    .query("maps")
    .withIndex("by_topic_user_kind_finished", (q) =>
      q
        .eq("topicId", topicId)
        .eq("userId", userId)
        .eq("kind", "recall")
        .eq("finishedAt", undefined),
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
