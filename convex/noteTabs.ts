import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { projectMembership, requireTopic, requireUser } from "./auth";
import { DEFAULT_NOTE_TABS, MAX_NOTE_TABS, noteTabValidator, type NoteTab } from "./model";

const MAX_TAB_ID_LENGTH = 64;

/** Saved tabs without notes that are gone. */
async function withoutDeleted(ctx: QueryCtx, projectId: Id<"projects">, tabs: NoteTab[]) {
  const open: NoteTab[] = [];
  for (const tab of tabs) {
    const source = tab.sourceId && (await ctx.db.get(tab.sourceId));
    if (!tab.sourceId || source?.projectId === projectId) open.push(tab);
  }
  return open.length ? open : DEFAULT_NOTE_TABS;
}

/** The tabs the signed-in user has open on a map. Which is showing is up to each page. */
export const get = query({
  args: { topicId: v.id("topics") },
  handler: async (ctx, { topicId }): Promise<NoteTab[]> => {
    const userId = await requireUser(ctx);
    const topic = await ctx.db.get(topicId);
    // Deleted or no longer shared, which the panel can hear before it hears the map has gone.
    if (!topic?.projectId || !(await projectMembership(ctx, topic.projectId, userId))) {
      return DEFAULT_NOTE_TABS;
    }
    const saved = await ctx.db
      .query("noteTabs")
      .withIndex("by_topic_user", (q) => q.eq("topicId", topicId).eq("userId", userId))
      .unique();
    return saved ? withoutDeleted(ctx, topic.projectId, saved.tabs) : DEFAULT_NOTE_TABS;
  },
});

/** Remembers the signed-in user's open tabs on a map. With none open, there's nothing to keep. */
export const set = mutation({
  args: {
    topicId: v.id("topics"),
    tabs: v.array(noteTabValidator),
  },
  handler: async (ctx, { topicId, tabs }) => {
    const userId = await requireUser(ctx);
    const topic = await requireTopic(ctx, topicId);
    if (
      tabs.length > MAX_NOTE_TABS ||
      tabs.some((tab) => !tab.id || tab.id.length > MAX_TAB_ID_LENGTH) ||
      new Set(tabs.map((tab) => tab.id)).size !== tabs.length
    ) {
      throw new ConvexError("Invalid note tabs");
    }
    const saved = await ctx.db
      .query("noteTabs")
      .withIndex("by_topic_user", (q) => q.eq("topicId", topicId).eq("userId", userId))
      .unique();
    if (!tabs.length) {
      if (saved) await ctx.db.delete(saved._id);
      return;
    }
    // Someone else can delete a note just as this user's tabs are saved with it.
    const open = await withoutDeleted(ctx, topic.projectId!, tabs);
    if (saved) await ctx.db.patch(saved._id, { tabs: open });
    else await ctx.db.insert("noteTabs", { topicId, userId, tabs: open });
  },
});
