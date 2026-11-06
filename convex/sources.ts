/// <reference types="node" />
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { projectMembership, requireProject, requireUser } from "./auth";
import { deleteSourceFiles, nudge } from "./runner";
import {
  fileProblem,
  isNoteFile,
  kindOfFile,
  fitTitle,
  MAX_SOURCE_TITLE_LENGTH,
  tidyTitle,
  titleFromFileName,
} from "./model";
import { requireBelowLimit } from "./usage";

/** A source the current user can see, or null if it has been deleted. */
async function requireSource(ctx: QueryCtx, sourceId: Id<"sources">) {
  const source = await ctx.db.get(sourceId);
  if (!source) return null;
  await requireProject(ctx, source.projectId);
  return source;
}

/** A project's sources, oldest first. */
export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireProject(ctx, projectId);
    const docs = await ctx.db
      .query("sources")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return docs.map(({ _id, name, title, kind, size, status }) => ({
      _id,
      name,
      title,
      kind,
      size,
      status,
    }));
  },
});

/** A source with links to its Markdown and its images, and for transcribed files, the original. */
export const open = query({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    const source = await requireSource(ctx, sourceId);
    if (!source) return null;
    const { _id, name, title, kind, status, error, pageCount, storageId, markdownId } = source;
    const assets = await ctx.db
      .query("sourceAssets")
      .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
      .collect();
    return {
      _id,
      name,
      title,
      kind,
      status,
      error,
      pageCount,
      // A Markdown or text file is its own note, so it has no separate original.
      originalUrl: isNoteFile(kind) ? null : await ctx.storage.getUrl(storageId),
      markdownUrl: markdownId ? await ctx.storage.getUrl(markdownId) : null,
      /** Image URLs by the name the Markdown links to them with, as `asset:<name>`. */
      assetUrls: Object.fromEntries(
        await Promise.all(
          assets.map(async (asset) => [asset.name, await ctx.storage.getUrl(asset.storageId)]),
        ),
      ) as Record<string, string | null>,
    };
  },
});

/** How long the client has to start sending a file after asking to upload it. */
const UPLOAD_TICKET_MS = 10 * 60_000;

/**
 * The first step of an upload: a one-use ticket binds the file to this user
 * and project, and the client posts the bytes to the returned URL. The file
 * is stored server-side, so a client never names a stored file it didn't upload.
 */
export const prepareUpload = mutation({
  args: { projectId: v.id("projects"), name: v.string(), size: v.number() },
  handler: async (ctx, { projectId, name, size }) => {
    const userId = await requireUser(ctx);
    await requireProject(ctx, projectId);
    if (!Number.isSafeInteger(size) || size < 0) throw new ConvexError("Invalid file size");
    const problem = fileProblem(name, size);
    if (problem) throw new ConvexError(problem);
    if (!isNoteFile(kindOfFile(name)!)) await requireBelowLimit(ctx, userId);
    const token = crypto.randomUUID() + crypto.randomUUID();
    const ticketId = await ctx.db.insert("sourceUploads", {
      token,
      projectId,
      userId,
      name,
      size,
      expiresAt: Date.now() + UPLOAD_TICKET_MS,
    });
    await ctx.scheduler.runAfter(UPLOAD_TICKET_MS, internal.sources.expireUpload, { ticketId });
    return `${process.env.CONVEX_SITE_URL}/sources/upload?token=${encodeURIComponent(token)}`;
  },
});

export const expireUpload = internalMutation({
  args: { ticketId: v.id("sourceUploads") },
  handler: async (ctx, { ticketId }) => {
    if (await ctx.db.get(ticketId)) await ctx.db.delete(ticketId);
  },
});

/** Uses up a ticket, returning the upload it allows, if its user can still add to the project. */
export const claimUpload = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const ticket = await ctx.db
      .query("sourceUploads")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (!ticket) return null;
    await ctx.db.delete(ticket._id);
    const { projectId, userId, name, size, expiresAt } = ticket;
    if (expiresAt < Date.now() || !(await canAdd(ctx, projectId, userId))) return null;
    return { projectId, userId, name, size };
  },
});

/** Adds a file the upload endpoint stored for a claimed ticket. */
export const completeUpload = internalMutation({
  args: {
    projectId: v.id("projects"),
    userId: v.string(),
    name: v.string(),
    size: v.number(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, { projectId, userId, name, size, storageId }) => {
    // Membership is checked again: it may have changed while the file was sent.
    if (!(await canAdd(ctx, projectId, userId))) throw new ConvexError("Project not found");
    const file = await ctx.db.system.get(storageId);
    if (file?.size !== size) throw new ConvexError("The upload didn't finish");
    return insertSource(ctx, projectId, storageId, name, undefined, userId);
  },
});

async function canAdd(ctx: QueryCtx, projectId: Id<"projects">, userId: string) {
  return !!(await ctx.db.get(projectId)) && !!(await projectMembership(ctx, projectId, userId));
}

/** Changes what a source is called. Its file keeps its name. */
export const rename = mutation({
  args: { sourceId: v.id("sources"), title: v.string() },
  handler: async (ctx, { sourceId, title }) => {
    const source = await requireSource(ctx, sourceId);
    if (!source) throw new ConvexError("This note was deleted");
    const tidy = tidyTitle(title);
    if (!tidy) throw new ConvexError("Title can't be empty");
    if (tidy.length > MAX_SOURCE_TITLE_LENGTH) throw new ConvexError("Title is too long");
    await ctx.db.patch(sourceId, { title: tidy });
  },
});

/** Deletes a source and its files. */
export const remove = mutation({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    const source = await requireSource(ctx, sourceId);
    if (source) await deleteSource(ctx, source);
  },
});

/** Queues a source to be transcribed again after it failed. */
export const retry = mutation({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    const source = await requireSource(ctx, sourceId);
    if (source?.status !== "failed") return;
    const queuedBy = await requireUser(ctx);
    await requireBelowLimit(ctx, queuedBy);
    await ctx.db.patch(sourceId, {
      status: "queued",
      queuedBy,
      error: undefined,
      attempts: undefined,
    });
    await nudge(ctx);
  },
});

/** Adds text as a Markdown source with its own title, e.g. the demo notes. */
export const importText = internalAction({
  args: { projectId: v.id("projects"), name: v.string(), title: v.string(), text: v.string() },
  handler: async (ctx, { projectId, name, title, text }) => {
    const storageId = await ctx.storage.store(new Blob([text], { type: "text/markdown" }));
    try {
      await ctx.runMutation(internal.sources.attach, { projectId, storageId, name, title });
    } catch (error) {
      await ctx.storage.delete(storageId);
      throw error;
    }
  },
});

export const attach = internalMutation({
  args: {
    projectId: v.id("projects"),
    storageId: v.id("_storage"),
    name: v.string(),
    title: v.string(),
  },
  handler: async (ctx, { projectId, storageId, name, title }) => {
    // Deleted before the text was stored.
    if (!(await ctx.db.get(projectId))) {
      await ctx.storage.delete(storageId);
      return;
    }
    await insertSource(ctx, projectId, storageId, name, title);
  },
});

async function insertSource(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  storageId: Id<"_storage">,
  name: string,
  title?: string,
  queuedBy?: string,
) {
  const file = await ctx.db.system.get(storageId);
  if (!file) throw new ConvexError("The upload didn't finish");
  // Checked here as well as before uploading, so every way of adding a file keeps to the limits.
  const problem = fileProblem(name, file.size);
  if (problem) throw new ConvexError(problem);
  const kind = kindOfFile(name)!;
  const note = isNoteFile(kind);
  if (!note) await nudge(ctx);
  return ctx.db.insert("sources", {
    projectId,
    storageId,
    name,
    // Kept to what a rename allows, including an import's title or name.
    title: fitTitle(tidyTitle(title ?? "") || titleFromFileName(name)),
    kind,
    size: file.size,
    status: note ? "ready" : "queued",
    queuedBy: note ? undefined : queuedBy,
    markdownId: note ? storageId : undefined,
  });
}

/** Deletes a project's sources and their files, and any uploads to it not yet sent. */
export async function deleteProjectSources(ctx: MutationCtx, projectId: Id<"projects">) {
  const sources = await ctx.db
    .query("sources")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  for (const source of sources) await deleteSource(ctx, source);
  const tickets = await ctx.db
    .query("sourceUploads")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  for (const ticket of tickets) await ctx.db.delete(ticket._id);
}

async function deleteSource(ctx: MutationCtx, source: Doc<"sources">) {
  await deleteSourceFiles(ctx, source);
  await ctx.storage.delete(source.storageId);
  await ctx.db.delete(source._id);
}
