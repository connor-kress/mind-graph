import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOwner, requireTopic } from "./auth";
import { EXTRACTOR_VERSION, fileProblem, kindOfFile } from "./model";

/** A topic's sources, oldest first. */
export const list = query({
  args: { topicId: v.id("topics") },
  handler: async (ctx, { topicId }) => {
    await requireTopic(ctx, topicId);
    const docs = await ctx.db
      .query("sources")
      .withIndex("by_topic", (q) => q.eq("topicId", topicId))
      .collect();
    return docs.map(({ _id, name, kind, size, status }) => ({ _id, name, kind, size, status }));
  },
});

/** A source with links to its original file and its extracted content. */
export const open = query({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    const source = await ctx.db.get(sourceId);
    if (!source) return null;
    await requireTopic(ctx, source.topicId);
    const { _id, name, kind, status, storageId, contentId, pageCount } = source;
    return {
      _id,
      name,
      kind,
      status,
      pageCount,
      url: await ctx.storage.getUrl(storageId),
      contentUrl: contentId ? await ctx.storage.getUrl(contentId) : null,
    };
  },
});

/** The first step of an upload: the client posts the file to this URL. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

/**
 * Adds an uploaded file to a topic. A file that can't be added is deleted, and
 * the reason returned (throwing would roll the deletion back).
 */
export const add = mutation({
  args: { topicId: v.id("topics"), storageId: v.id("_storage"), name: v.string() },
  handler: async (ctx, { topicId, storageId, name }) => {
    const ownerId = await requireOwner(ctx);
    const file = await ctx.db.system.get(storageId);
    if (!file) throw new ConvexError("The upload didn't finish");
    const topic = await ctx.db.get(topicId);
    const error = topic?.ownerId !== ownerId ? "Map not found" : fileProblem(name, file.size);
    if (error) {
      await ctx.storage.delete(storageId);
      return { error };
    }
    return { sourceId: await insertSource(ctx, topicId, storageId, name) };
  },
});

/** Deletes a source and its files. */
export const remove = mutation({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    const source = await ctx.db.get(sourceId);
    if (!source) return;
    await requireTopic(ctx, source.topicId);
    await deleteSource(ctx, source);
  },
});

/** Reads a source's file again, e.g. after extraction failed. */
export const retry = mutation({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    const source = await ctx.db.get(sourceId);
    if (!source) return;
    await requireTopic(ctx, source.topicId);
    if (source.status === "processing") return;
    await ctx.db.patch(sourceId, { status: "processing" });
    await ctx.scheduler.runAfter(0, internal.extract.run, { sourceId });
  },
});

/** Adds text as a source, e.g. the demo notes. */
export const importText = internalAction({
  args: { topicId: v.id("topics"), name: v.string(), text: v.string() },
  handler: async (ctx, { topicId, name, text }) => {
    const storageId = await ctx.storage.store(new Blob([text], { type: "text/markdown" }));
    await ctx.runMutation(internal.sources.attach, { topicId, storageId, name });
  },
});

export const attach = internalMutation({
  args: { topicId: v.id("topics"), storageId: v.id("_storage"), name: v.string() },
  handler: (ctx, { topicId, storageId, name }) => insertSource(ctx, topicId, storageId, name),
});

/** What extraction needs to know about a source. */
export const forExtraction = internalQuery({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    const source = await ctx.db.get(sourceId);
    return source && { storageId: source.storageId, kind: source.kind };
  },
});

/** Records the result of extraction. */
export const finish = internalMutation({
  args: {
    sourceId: v.id("sources"),
    failed: v.boolean(),
    contentId: v.optional(v.id("_storage")),
    pageCount: v.optional(v.number()),
  },
  handler: async (ctx, { sourceId, failed, contentId, pageCount }) => {
    const source = await ctx.db.get(sourceId);
    // Deleted while it was being read.
    if (!source) {
      if (contentId) await ctx.storage.delete(contentId);
      return;
    }
    if (failed) {
      await ctx.db.patch(sourceId, { status: "failed" });
      return;
    }
    if (source.contentId && source.contentId !== contentId) {
      await ctx.storage.delete(source.contentId);
    }
    await ctx.db.patch(sourceId, {
      status: "ready",
      contentId,
      pageCount,
      extractorVersion: EXTRACTOR_VERSION,
    });
  },
});

async function insertSource(
  ctx: MutationCtx,
  topicId: Id<"topics">,
  storageId: Id<"_storage">,
  name: string,
) {
  const file = await ctx.db.system.get(storageId);
  const kind = kindOfFile(name);
  if (!file || !kind) throw new ConvexError("Unsupported file");
  const sourceId = await ctx.db.insert("sources", {
    topicId,
    storageId,
    name,
    kind,
    size: file.size,
    status: "processing",
  });
  await ctx.scheduler.runAfter(0, internal.extract.run, { sourceId });
  return sourceId;
}

/** Deletes a topic's sources and their files. */
export async function deleteSources(ctx: MutationCtx, topicId: Id<"topics">) {
  const sources = await ctx.db
    .query("sources")
    .withIndex("by_topic", (q) => q.eq("topicId", topicId))
    .collect();
  for (const source of sources) await deleteSource(ctx, source);
}

async function deleteSource(ctx: MutationCtx, source: Doc<"sources">) {
  await ctx.storage.delete(source.storageId);
  if (source.contentId) await ctx.storage.delete(source.contentId);
  await ctx.db.delete(source._id);
}
