import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
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
