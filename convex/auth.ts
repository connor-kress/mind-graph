import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

export async function requireOwner(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Sign in to continue");
  return identity.tokenIdentifier;
}

export async function requireFolder(ctx: QueryCtx, folderId: Id<"folders">) {
  const ownerId = await requireOwner(ctx);
  const folder = await ctx.db.get(folderId);
  if (!folder || folder.ownerId !== ownerId) throw new ConvexError("Folder not found");
  return folder;
}

export async function requireTopic(ctx: QueryCtx, topicId: Id<"topics">) {
  const ownerId = await requireOwner(ctx);
  const topic = await ctx.db.get(topicId);
  if (!topic || topic.ownerId !== ownerId) throw new ConvexError("Map not found");
  return topic;
}

export async function requireMap(ctx: QueryCtx, mapId: Id<"maps">) {
  await requireOwner(ctx);
  const map = await ctx.db.get(mapId);
  if (!map) throw new ConvexError("Map not found");
  await requireTopic(ctx, map.topicId);
  return map;
}
