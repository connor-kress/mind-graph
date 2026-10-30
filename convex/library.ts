import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { insertTree } from "./workspace";
import { requireUser, requireProject, requireTopic, memberProjects } from "./auth";

import { insertProject, migrateTopic } from "./projectMigration";

const MAX_NAME_LENGTH = 200;

const UNTITLED_MAP = "Untitled map";

/** Projects the caller belongs to, with their shared maps. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const projects = await memberProjects(ctx, userId);
    return Promise.all(
      projects.map(async (project) => {
        const topics = await ctx.db
          .query("topics")
          .withIndex("by_project", (q) => q.eq("projectId", project._id))
          .collect();
        return {
          _id: project._id,
          name: project.name,
          role: project.role,
          maps: topics.map((topic) => ({ _id: topic._id, title: topic.title })),
        };
      }),
    );
  },
});

export const createProject = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await requireUser(ctx);
    const projects = await memberProjects(ctx, userId);
    return insertProject(
      ctx,
      userId,
      cleanName(name),
      Math.max(-1, ...projects.map((p) => p.order)) + 1,
    );
  },
});

export const createMap = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireProject(ctx, projectId);
    const topicId = await ctx.db.insert("topics", { projectId, title: UNTITLED_MAP });
    const mapId = await ctx.db.insert("maps", { topicId, kind: "reference" });
    await insertTree(ctx, mapId, { label: UNTITLED_MAP }, undefined, 0);
    return topicId;
  },
});

export const renameProject = mutation({
  args: { projectId: v.id("projects"), name: v.string() },
  handler: async (ctx, { projectId, name }) => {
    await requireProject(ctx, projectId, true);
    await ctx.db.patch(projectId, { name: cleanName(name) });
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

export const deleteProject = mutation({
  args: { projectId: v.id("projects"), confirmation: v.string() },
  handler: async (ctx, { projectId, confirmation }) => {
    const project = await requireProject(ctx, projectId, true);
    if (confirmation !== project.name)
      throw new ConvexError("Project name doesn't match. Check its current name and try again.");
    // Finish linking this project's old data if an administrative migration is still running.
    if (project.legacyFolderId) {
      const legacyTopics = await ctx.db
        .query("topics")
        .withIndex("by_folder", (q) => q.eq("folderId", project.legacyFolderId))
        .collect();
      for (const topic of legacyTopics)
        if (!topic.projectId && topic.ownerId === project.createdBy) await migrateTopic(ctx, topic);
    }
    if (project.legacyOwnerId) {
      const legacyTopics = await ctx.db
        .query("topics")
        .withIndex("by_owner", (q) => q.eq("ownerId", project.legacyOwnerId))
        .collect();
      for (const topic of legacyTopics) await migrateTopic(ctx, topic);
    }
    const topics = await ctx.db
      .query("topics")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    for (const topic of topics) await deleteTopic(ctx, topic._id);
    const members = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_user", (q) => q.eq("projectId", projectId))
      .collect();
    for (const member of members) {
      // An intentionally empty account must not get demo projects on its next sign-in.
      if (
        !(await ctx.db
          .query("libraries")
          .withIndex("by_owner", (q) => q.eq("ownerId", member.userId))
          .first())
      )
        await ctx.db.insert("libraries", { ownerId: member.userId });
      await ctx.db.delete(member._id);
    }
    await ctx.db.delete(projectId);
  },
});
