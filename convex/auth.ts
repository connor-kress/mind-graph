import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

export async function requireUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Sign in to continue");
  return identity.tokenIdentifier;
}

export function projectMembership(ctx: QueryCtx, projectId: Id<"projects">, userId: string) {
  return ctx.db
    .query("projectMembers")
    .withIndex("by_project_user", (q) => q.eq("projectId", projectId).eq("userId", userId))
    .unique();
}

export async function memberProjects(ctx: QueryCtx, userId: string) {
  const memberships = await ctx.db
    .query("projectMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const projects = await Promise.all(
    memberships.map(async (membership) => {
      const project = await ctx.db.get(membership.projectId);
      return project ? { ...project, role: membership.role } : null;
    }),
  );
  return projects
    .filter((p) => p !== null)
    .sort((a, b) => a.order - b.order || a._creationTime - b._creationTime);
}

export async function requireProject(ctx: QueryCtx, projectId: Id<"projects">, ownerOnly = false) {
  const userId = await requireUser(ctx);
  const project = await ctx.db.get(projectId);
  const membership = project && (await projectMembership(ctx, projectId, userId));
  if (!project || !membership) throw new ConvexError("Project not found");
  if (ownerOnly && membership.role !== "owner")
    throw new ConvexError("Only the project owner can do this");
  return project;
}

export async function requireTopic(ctx: QueryCtx, topicId: Id<"topics">) {
  await requireUser(ctx);
  const topic = await ctx.db.get(topicId);
  if (!topic?.projectId) throw new ConvexError("Map not found");
  await requireProject(ctx, topic.projectId);
  return topic;
}

export async function requireMap(ctx: QueryCtx, mapId: Id<"maps">) {
  const userId = await requireUser(ctx);
  const map = await ctx.db.get(mapId);
  if (!map) throw new ConvexError("Map not found");
  await requireTopic(ctx, map.topicId);
  if (map.kind === "recall" && map.userId !== userId)
    throw new ConvexError("Recall attempt not found");
  return map;
}
