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
import { fileProblem, isNoteFile, kindOfFile } from "./model";

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
    return docs.map(({ _id, name, kind, size, status }) => ({ _id, name, kind, size, status }));
  },
});

/** A source with links to its Markdown and, for transcribed files, the original. */
export const open = query({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    const source = await requireSource(ctx, sourceId);
    if (!source) return null;
    const { _id, name, kind, status, error, pageCount, storageId, markdownId } = source;
    return {
      _id,
      name,
      kind,
      status,
      error,
      pageCount,
      // A Markdown or text file is its own note, so it has no separate original.
      originalUrl: isNoteFile(kind) ? null : await ctx.storage.getUrl(storageId),
      markdownUrl: markdownId ? await ctx.storage.getUrl(markdownId) : null,
    };
  },
});

/** The first step of an upload: the client posts the file to this URL. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

/**
 * Adds an uploaded file to a project. A file that can't be added is deleted,
 * and the reason returned (throwing would roll the deletion back).
 */
export const add = mutation({
  args: { projectId: v.id("projects"), storageId: v.id("_storage"), name: v.string() },
  handler: async (ctx, { projectId, storageId, name }) => {
    const userId = await requireUser(ctx);
    const file = await ctx.db.system.get(storageId);
    if (!file) throw new ConvexError("The upload didn't finish");
    const member =
      (await ctx.db.get(projectId)) && (await projectMembership(ctx, projectId, userId));
    const error = !member ? "Project not found" : fileProblem(name, file.size);
    if (error) {
      await ctx.storage.delete(storageId);
      return { error };
    }
    return { sourceId: await insertSource(ctx, projectId, storageId, name) };
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
    await ctx.db.patch(sourceId, { status: "queued", error: undefined });
  },
});

/** Adds text as a Markdown source, e.g. the demo notes. */
export const importText = internalAction({
  args: { projectId: v.id("projects"), name: v.string(), text: v.string() },
  handler: async (ctx, { projectId, name, text }) => {
    const storageId = await ctx.storage.store(new Blob([text], { type: "text/markdown" }));
    try {
      await ctx.runMutation(internal.sources.attach, { projectId, storageId, name });
    } catch (error) {
      await ctx.storage.delete(storageId);
      throw error;
    }
  },
});

export const attach = internalMutation({
  args: { projectId: v.id("projects"), storageId: v.id("_storage"), name: v.string() },
  handler: async (ctx, { projectId, storageId, name }) => {
    // Deleted before the text was stored.
    if (!(await ctx.db.get(projectId))) {
      await ctx.storage.delete(storageId);
      return;
    }
    await insertSource(ctx, projectId, storageId, name);
  },
});

async function insertSource(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  storageId: Id<"_storage">,
  name: string,
) {
  const file = await ctx.db.system.get(storageId);
  const kind = kindOfFile(name);
  if (!file || !kind) throw new ConvexError("Unsupported file");
  const note = isNoteFile(kind);
  return ctx.db.insert("sources", {
    projectId,
    storageId,
    name,
    kind,
    size: file.size,
    status: note ? "ready" : "queued",
    markdownId: note ? storageId : undefined,
  });
}

/** Deletes a project's sources and their files. */
export async function deleteProjectSources(ctx: MutationCtx, projectId: Id<"projects">) {
  const sources = await ctx.db
    .query("sources")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  for (const source of sources) await deleteSource(ctx, source);
}

async function deleteSource(ctx: MutationCtx, source: Doc<"sources">) {
  const files = new Set([source.storageId, source.markdownId]);
  for (const id of files) if (id) await ctx.storage.delete(id);
  await ctx.db.delete(source._id);
}
