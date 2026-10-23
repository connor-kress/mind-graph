import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { insertTree } from "./workspace";

const MAX_NAME_LENGTH = 200;

const UNTITLED_MAP = "Untitled map";

/** Folders in order, each with its maps (topics) in creation order. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const folders = await ctx.db.query("folders").collect();
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
          maps: topics.map((t) => ({ _id: t._id, title: t.title })),
        };
      }),
    );
  },
});

export const createFolder = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const folders = await ctx.db.query("folders").collect();
    const order = Math.max(-1, ...folders.map((f) => f.order)) + 1;
    return ctx.db.insert("folders", { name: cleanName(name), order });
  },
});

/** Creates an empty map (a topic with just its reference root) in a folder. */
export const createMap = mutation({
  args: { folderId: v.id("folders") },
  handler: async (ctx, { folderId }) => {
    if (!(await ctx.db.get(folderId))) throw new ConvexError("Folder not found");
    const topicId = await ctx.db.insert("topics", { folderId, title: UNTITLED_MAP });
    const mapId = await ctx.db.insert("maps", { topicId, kind: "reference" });
    await insertTree(ctx, mapId, { label: UNTITLED_MAP }, undefined, 0);
    return topicId;
  },
});

export const renameFolder = mutation({
  args: { folderId: v.id("folders"), name: v.string() },
  handler: async (ctx, { folderId, name }) => {
    if (!(await ctx.db.get(folderId))) throw new ConvexError("Folder not found");
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
    const topic = await ctx.db.get(topicId);
    if (!topic) throw new ConvexError("Map not found");
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
