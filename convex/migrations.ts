import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { EXTRACTOR_VERSION } from "./model";
import { notesMarkdown } from "./seedData";

/**
 * Moves topics' inline notes into Markdown sources. Run once on each existing
 * deployment: `npx convex run migrations:notesToSources` (add `--prod` for
 * production). Safe to run again.
 */
export const notesToSources = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const topic of await ctx.db.query("topics").collect()) {
      if (!topic.notes) continue;
      await ctx.scheduler.runAfter(0, internal.sources.importText, {
        topicId: topic._id,
        name: `${topic.notes.heading}.md`,
        text: notesMarkdown(topic.notes),
      });
      await ctx.db.patch(topic._id, { notes: undefined });
    }
  },
});

/**
 * Reads sources again that were extracted by an older extractor, e.g. PDFs and
 * presentations added before they could be read. Run after deploying a new
 * `EXTRACTOR_VERSION`: `npx convex run migrations:reextractSources` (add
 * `--prod` for production). Safe to run again.
 */
export const reextractSources = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const source of await ctx.db.query("sources").collect()) {
      if (source.status === "processing") continue;
      if ((source.extractorVersion ?? 0) >= EXTRACTOR_VERSION) continue;
      await ctx.db.patch(source._id, { status: "processing" });
      await ctx.scheduler.runAfter(0, internal.extract.run, { sourceId: source._id });
    }
  },
});
