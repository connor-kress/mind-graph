import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { insertTree } from "./workspace";
import { requireOwner, requireFolder, requireTopic } from "./auth";

const MAX_NAME_LENGTH = 200;

const UNTITLED_MAP = "Untitled map";

/** Folders in order, each with its maps (topics) in creation order. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await requireOwner(ctx);
    const folders = await ctx.db
      .query("folders")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    folders.sort((a, b) => a.order - b.order);
    return Promise.all(
      folders.map(async (folder) => {
        const topics = await ctx.db
          .query("topics")
          .withIndex("by_folder", (q) => q.eq("folderId", folder._id))
          .collect();
        return {
          _id: folder._id,
          name: folder.name,
          maps: topics
            .filter((t) => t.ownerId === ownerId)
            .map((t) => ({ _id: t._id, title: t.title })),
        };
      }),
    );
  },
});

export const createFolder = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const ownerId = await requireOwner(ctx);
    const folders = await ctx.db
      .query("folders")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    const order = Math.max(-1, ...folders.map((f) => f.order)) + 1;
    return ctx.db.insert("folders", { ownerId, name: cleanName(name), order });
  },
});

/** Creates an empty map (a topic with just its reference root) in a folder. */
export const createMap = mutation({
  args: { folderId: v.id("folders") },
  handler: async (ctx, { folderId }) => {
    const folder = await requireFolder(ctx, folderId);
    const topicId = await ctx.db.insert("topics", {
      ownerId: folder.ownerId,
      folderId,
      title: UNTITLED_MAP,
    });
    const mapId = await ctx.db.insert("maps", { topicId, kind: "reference" });
    await insertTree(ctx, mapId, { label: UNTITLED_MAP }, undefined, 0);
    return topicId;
  },
});

export const renameFolder = mutation({
  args: { folderId: v.id("folders"), name: v.string() },
  handler: async (ctx, { folderId, name }) => {
    await requireFolder(ctx, folderId);
    await ctx.db.patch(folderId, { name: cleanName(name) });
  },
});

/**
 * Renames a map. The reference root is renamed too while it still matches the
 * title, since it starts out as the title (as does a recall attempt's root).
 */
export const renameMap = mutation({
  args: { topicId: v.id("topics"), title: v.string() },
  handler: async (ctx, { topicId, title }) => {
    const topic = await requireTopic(ctx, topicId);
    const next = cleanName(title);
    await ctx.db.patch(topicId, { title: next });

    const reference = await ctx.db
      .query("maps")
      .withIndex("by_topic_kind", (q) => q.eq("topicId", topicId).eq("kind", "reference"))
      .first();
    if (!reference) return;
    const nodes = await ctx.db
      .query("nodes")
      .withIndex("by_map_key", (q) => q.eq("mapId", reference._id))
      .collect();
    const root = nodes.find((n) => n.isRoot);
    if (root && root.label === topic.title) await ctx.db.patch(root._id, { label: next });
  },
});

function cleanName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new ConvexError("Name can't be empty");
  if (trimmed.length > MAX_NAME_LENGTH) throw new ConvexError("Name is too long");
  return trimmed;
}

/** Remove the topic, reference map, all recall attempts, and their nodes together. */
async function deleteTopic(ctx: MutationCtx, topicId: Id<"topics">) {
  await requireTopic(ctx, topicId);
  const maps = await ctx.db
    .query("maps")
    .withIndex("by_topic_kind", (q) => q.eq("topicId", topicId))
    .collect();
  for (const map of maps) {
    const nodes = await ctx.db
      .query("nodes")
      .withIndex("by_map_key", (q) => q.eq("mapId", map._id))
      .collect();
    for (const node of nodes) await ctx.db.delete(node._id);
    await ctx.db.delete(map._id);
  }
  await ctx.db.delete(topicId);
}

export const deleteMap = mutation({
  args: { topicId: v.id("topics") },
  handler: async (ctx, { topicId }) => {
    await deleteTopic(ctx, topicId);
  },
});

export const deleteFolder = mutation({
  args: { folderId: v.id("folders"), confirmation: v.string() },
  handler: async (ctx, { folderId, confirmation }) => {
    const folder = await requireFolder(ctx, folderId);
    if (confirmation !== folder.name)
      throw new ConvexError("Folder name doesn't match. Check its current name and try again.");
    const topics = await ctx.db
      .query("topics")
      .withIndex("by_folder", (q) => q.eq("folderId", folderId))
      .collect();
    for (const topic of topics) await deleteTopic(ctx, topic._id);
    const ownerId = folder.ownerId!;
    if (
      !(await ctx.db
        .query("libraries")
        .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
        .first())
    ) {
      await ctx.db.insert("libraries", { ownerId });
    }
    await ctx.db.delete(folderId);
  },
});
