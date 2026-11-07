import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { projectMembership, requireTopic, requireUser } from "./auth";
import { MAX_NOTE_TABS, noteTabValidator, type NoteTab } from "./model";

type View = { tabs: NoteTab[]; activeId: string };

/** What a map opens with before anything is saved, and once nothing is left open. */
const FRESH: View = { tabs: [{ id: "files" }], activeId: "files" };

const MAX_TAB_ID_LENGTH = 64;

/** Saved tabs without notes that are gone. If the active one was, the next tab along is active. */
async function withoutDeleted(ctx: QueryCtx, projectId: Id<"projects">, view: View): Promise<View> {
  const open: NoteTab[] = [];
  for (const tab of view.tabs) {
    const source = tab.sourceId && (await ctx.db.get(tab.sourceId));
    if (!tab.sourceId || source?.projectId === projectId) open.push(tab);
  }
  if (!open.length) return FRESH;
  if (open.some((tab) => tab.id === view.activeId)) return { tabs: open, activeId: view.activeId };
  const from = view.tabs.findIndex((tab) => tab.id === view.activeId);
  const next = view.tabs.slice(from + 1).find((tab) => open.includes(tab)) ?? open.at(-1)!;
  return { tabs: open, activeId: next.id };
}

/** The tabs the signed-in user left open on a map. */
export const get = query({
  args: { topicId: v.id("topics") },
  handler: async (ctx, { topicId }): Promise<View> => {
    const userId = await requireUser(ctx);
    const topic = await ctx.db.get(topicId);
    // Deleted or no longer shared, which the panel can hear before it hears the map has gone.
    if (!topic?.projectId || !(await projectMembership(ctx, topic.projectId, userId))) return FRESH;
    const saved = await ctx.db
      .query("noteTabs")
      .withIndex("by_topic_user", (q) => q.eq("topicId", topicId).eq("userId", userId))
      .unique();
    return saved
      ? withoutDeleted(ctx, topic.projectId, { tabs: saved.tabs, activeId: saved.activeId })
      : FRESH;
  },
});

/** Remembers the signed-in user's open tabs on a map. */
export const set = mutation({
  args: {
    topicId: v.id("topics"),
    tabs: v.array(noteTabValidator),
    activeId: v.string(),
  },
  handler: async (ctx, { topicId, tabs, activeId }) => {
    const userId = await requireUser(ctx);
    const topic = await requireTopic(ctx, topicId);
    const notes = tabs.flatMap((tab) => tab.sourceId ?? []);
    if (
      !tabs.length ||
      tabs.length > MAX_NOTE_TABS ||
      tabs.some((tab) => !tab.id || tab.id.length > MAX_TAB_ID_LENGTH) ||
      new Set(tabs.map((tab) => tab.id)).size !== tabs.length ||
      new Set(notes).size !== notes.length ||
      !tabs.some((tab) => tab.id === activeId)
    ) {
      throw new ConvexError("Invalid note tabs");
    }
    // Someone else can delete a note just as this user's tabs are saved with it.
    const view = await withoutDeleted(ctx, topic.projectId!, { tabs, activeId });
    const saved = await ctx.db
      .query("noteTabs")
      .withIndex("by_topic_user", (q) => q.eq("topicId", topicId).eq("userId", userId))
      .unique();
    if (saved) await ctx.db.patch(saved._id, view);
    else await ctx.db.insert("noteTabs", { topicId, userId, ...view });
  },
});
