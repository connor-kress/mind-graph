import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

/** A new project starts with its creator as its sole owner member. */
export async function insertProject(
  ctx: MutationCtx,
  userId: string,
  name: string,
  order: number,
  legacy: { legacyFolderId?: Id<"folders">; legacyOwnerId?: string } = {},
) {
  const projectId = await ctx.db.insert("projects", { name, createdBy: userId, order, ...legacy });
  await ctx.db.insert("projectMembers", { projectId, userId, role: "owner" });
  return projectId;
}

export async function migrateFolder(ctx: MutationCtx, folder: Doc<"folders">) {
  if (!folder.ownerId) return null;
  // Keep the pointer even if its project was deleted, so migration never resurrects it.
  if (folder.projectId) return (await ctx.db.get(folder.projectId)) ? folder.projectId : null;
  const projectId = await insertProject(ctx, folder.ownerId, folder.name, folder.order, {
    legacyFolderId: folder._id,
  });
  await ctx.db.patch(folder._id, { projectId });
  return projectId;
}

export async function migrateTopic(ctx: MutationCtx, topic: Doc<"topics">) {
  if (topic.projectId || !topic.ownerId) return false;
  const folder = topic.folderId ? await ctx.db.get(topic.folderId) : null;
  let projectId: Id<"projects"> | null;
  if (folder?.ownerId === topic.ownerId) {
    projectId = await migrateFolder(ctx, folder);
    if (!projectId) return false;
  } else {
    // Owned topics without an owned folder keep their owner and get an import project.
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_legacy_owner", (q) => q.eq("legacyOwnerId", topic.ownerId))
      .unique();
    projectId =
      existing?._id ??
      (await insertProject(ctx, topic.ownerId, "Imported maps", 0, {
        legacyOwnerId: topic.ownerId,
      }));
  }
  await ctx.db.patch(topic._id, { projectId });
  const recalls = await ctx.db
    .query("maps")
    .withIndex("by_topic_kind", (q) => q.eq("topicId", topic._id).eq("kind", "recall"))
    .collect();
  for (const recall of recalls) {
    if (recall.userId === undefined) await ctx.db.patch(recall._id, { userId: topic.ownerId });
  }
  return true;
}

/** Lazy migration on sign-in also covers previews that were not manually migrated. */
export async function migrateUserProjects(ctx: MutationCtx, userId: string) {
  const folders = await ctx.db
    .query("folders")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .collect();
  for (const folder of folders) await migrateFolder(ctx, folder);
  const topics = await ctx.db
    .query("topics")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .collect();
  for (const topic of topics) await migrateTopic(ctx, topic);
}
