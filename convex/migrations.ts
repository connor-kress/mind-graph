import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { notesSource } from "./seedData";

/**
 * Moves topics' inline notes into Markdown sources in their project. Run once
 * on each existing deployment: `npx convex run migrations:notesToSources` (add
 * `--prod` for production). Safe to run again.
 */
export const notesToSources = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const topic of await ctx.db.query("topics").collect()) {
      if (!topic.notes || !topic.projectId) continue;
      await ctx.scheduler.runAfter(0, internal.sources.importText, {
        projectId: topic.projectId,
        ...notesSource(topic.notes),
      });
      await ctx.db.patch(topic._id, { notes: undefined });
    }
  },
});
