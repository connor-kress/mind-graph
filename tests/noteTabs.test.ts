import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { MAX_NOTE_TABS } from "../convex/model";
import schema from "../convex/schema";
import {
  addFilesTab,
  closeTab,
  moveTab,
  openNote,
  showFiles,
  slotAt,
} from "../src/sources/tabView";

const modules = import.meta.glob("../convex/**/*.ts");

const FRESH = { tabs: [{ id: "files" }], activeId: "files" };

async function fixture() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice", issuer: "https://clerk.test" });
  const bob = t.withIdentity({ subject: "bob", issuer: "https://clerk.test" });
  const projectId = await alice.mutation(api.library.createProject, { name: "Biology" });
  const topicId = await alice.mutation(api.library.createMap, { projectId, title: "Glycolysis" });
  const addNote = (title: string, inProject = projectId) =>
    t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([title]));
      return ctx.db.insert("sources", {
        projectId: inProject,
        storageId,
        name: `${title}.md`,
        title,
        kind: "md",
        size: title.length,
        status: "ready",
        markdownId: storageId,
      });
    });
  return { t, alice, bob, projectId, topicId, addNote };
}

describe("saved note tabs", () => {
  test("a map starts on one Files tab", async () => {
    const { alice, topicId } = await fixture();
    expect(await alice.query(api.noteTabs.get, { topicId })).toEqual(FRESH);
  });

  test("are remembered per map and per user", async () => {
    const { t, alice, bob, projectId, topicId, addNote } = await fixture();
    const sourceId = await addNote("Lecture");
    const view = { tabs: [{ id: "a", sourceId }, { id: "b" }], activeId: "a" };
    await alice.mutation(api.noteTabs.set, { topicId, ...view });
    expect(await alice.query(api.noteTabs.get, { topicId })).toEqual(view);

    const other = await alice.mutation(api.library.createMap, { projectId, title: "Krebs" });
    expect(await alice.query(api.noteTabs.get, { topicId: other })).toEqual(FRESH);

    await t.run((ctx) =>
      ctx.db.insert("projectMembers", {
        projectId,
        userId: "https://clerk.test|bob",
        role: "member",
      }),
    );
    expect(await bob.query(api.noteTabs.get, { topicId })).toEqual(FRESH);
  });

  test("saving again replaces them", async () => {
    const { t, alice, topicId } = await fixture();
    await alice.mutation(api.noteTabs.set, { topicId, tabs: [{ id: "a" }], activeId: "a" });
    await alice.mutation(api.noteTabs.set, { topicId, tabs: [{ id: "b" }], activeId: "b" });
    expect(await alice.query(api.noteTabs.get, { topicId })).toEqual({
      tabs: [{ id: "b" }],
      activeId: "b",
    });
    expect(await t.run((ctx) => ctx.db.query("noteTabs").collect())).toHaveLength(1);
  });

  test("lose a deleted note, going to the next tab along", async () => {
    const { alice, topicId, addNote } = await fixture();
    const [first, second, third] = await Promise.all(["1", "2", "3"].map((n) => addNote(n)));
    const tabs = [
      { id: "a", sourceId: first },
      { id: "b", sourceId: second },
      { id: "c", sourceId: third },
    ];
    await alice.mutation(api.noteTabs.set, { topicId, tabs, activeId: "b" });

    await alice.mutation(api.sources.remove, { sourceId: second });
    expect(await alice.query(api.noteTabs.get, { topicId })).toEqual({
      tabs: [tabs[0], tabs[2]],
      activeId: "c",
    });

    await alice.mutation(api.sources.remove, { sourceId: third });
    expect(await alice.query(api.noteTabs.get, { topicId })).toEqual({
      tabs: [tabs[0]],
      activeId: "a",
    });
  });

  test("go back to Files when no note is left", async () => {
    const { alice, topicId, addNote } = await fixture();
    const sourceId = await addNote("Lecture");
    await alice.mutation(api.noteTabs.set, {
      topicId,
      tabs: [{ id: "a", sourceId }],
      activeId: "a",
    });
    await alice.mutation(api.sources.remove, { sourceId });
    expect(await alice.query(api.noteTabs.get, { topicId })).toEqual(FRESH);
  });

  test("can't hold another project's note", async () => {
    const { alice, topicId, addNote } = await fixture();
    const elsewhere = await alice.mutation(api.library.createProject, { name: "Chemistry" });
    const sourceId = await addNote("Other", elsewhere);
    await alice.mutation(api.noteTabs.set, {
      topicId,
      tabs: [{ id: "a", sourceId }, { id: "b" }],
      activeId: "a",
    });
    expect(await alice.query(api.noteTabs.get, { topicId })).toEqual({
      tabs: [{ id: "b" }],
      activeId: "b",
    });
  });

  test("are refused when they don't make sense", async () => {
    const { alice, topicId, addNote } = await fixture();
    const sourceId = await addNote("Lecture");
    const refused = [
      { tabs: [], activeId: "a" },
      { tabs: [{ id: "a" }], activeId: "b" },
      { tabs: [{ id: "" }], activeId: "" },
      { tabs: [{ id: "a".repeat(65) }], activeId: "a".repeat(65) },
      { tabs: [{ id: "a" }, { id: "a" }], activeId: "a" },
      {
        tabs: [
          { id: "a", sourceId },
          { id: "b", sourceId },
        ],
        activeId: "a",
      },
      {
        tabs: Array.from({ length: MAX_NOTE_TABS + 1 }, (_, i) => ({ id: String(i) })),
        activeId: "0",
      },
    ];
    for (const view of refused) {
      await expect(alice.mutation(api.noteTabs.set, { topicId, ...view })).rejects.toThrow(
        "Invalid note tabs",
      );
    }
  });

  test("are private to the project's members", async () => {
    const { bob, topicId } = await fixture();
    expect(await bob.query(api.noteTabs.get, { topicId })).toEqual(FRESH);
    await expect(
      bob.mutation(api.noteTabs.set, { topicId, tabs: [{ id: "a" }], activeId: "a" }),
    ).rejects.toThrow("Project not found");
  });

  test("go with their map, which then reads as fresh", async () => {
    const { t, alice, topicId } = await fixture();
    await alice.mutation(api.noteTabs.set, { topicId, tabs: [{ id: "a" }], activeId: "a" });
    await alice.mutation(api.library.deleteMap, { topicId });
    expect(await t.run((ctx) => ctx.db.query("noteTabs").collect())).toEqual([]);
    expect(await alice.query(api.noteTabs.get, { topicId })).toEqual(FRESH);
  });

  test("go with their project", async () => {
    const { t, alice, projectId, topicId } = await fixture();
    await alice.mutation(api.noteTabs.set, { topicId, tabs: [{ id: "a" }], activeId: "a" });
    await alice.mutation(api.library.deleteProject, { projectId, confirmation: "Biology" });
    expect(await t.run((ctx) => ctx.db.query("noteTabs").collect())).toEqual([]);
  });
});

describe("changing tabs", () => {
  const one = "one" as Id<"sources">;
  const two = "two" as Id<"sources">;

  test("a new tab shows the files, alongside any others", () => {
    const view = addFilesTab(addFilesTab({ tabs: [{ id: "a" }] }));
    expect(view.tabs).toHaveLength(3);
    expect(view.tabs.some((tab) => tab.sourceId)).toBe(false);
    expect(view.activeId).toBe(view.tabs[2].id);
    expect(new Set(view.tabs.map((tab) => tab.id)).size).toBe(3);
  });

  test("opening a note turns the Files tab into it", () => {
    expect(openNote({ tabs: [{ id: "a" }, { id: "b" }], activeId: "b" }, one)).toEqual({
      tabs: [{ id: "a" }, { id: "b", sourceId: one }],
      activeId: "b",
    });
  });

  test("opening a note that's already open goes to it and drops the Files tab", () => {
    const open = { id: "a", sourceId: one };
    expect(openNote({ tabs: [open, { id: "b" }, { id: "c" }], activeId: "b" }, one)).toEqual({
      tabs: [open, { id: "c" }],
      activeId: "a",
    });
  });

  test("closing a tab goes to the next one along, or the last", () => {
    const tabs = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(closeTab({ tabs, activeId: "b" }, "b").activeId).toBe("c");
    expect(closeTab({ tabs, activeId: "c" }, "c").activeId).toBe("b");
  });

  test("closing another tab stays where you are", () => {
    const tabs = [{ id: "a" }, { id: "b" }];
    expect(closeTab({ tabs, activeId: "b" }, "a")).toEqual({ tabs: [{ id: "b" }], activeId: "b" });
  });

  test("closing the last tab leaves a new Files tab", () => {
    const view = closeTab({ tabs: [{ id: "a", sourceId: one }], activeId: "a" }, "a");
    expect(view.tabs).toHaveLength(1);
    expect(view.tabs[0].id).not.toBe("a");
    expect(view.tabs[0].sourceId).toBeUndefined();
    expect(view.activeId).toBe(view.tabs[0].id);
  });

  describe("moving a tab", () => {
    const tabs = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const order = (to: number, id = "a") =>
      moveTab({ tabs, activeId: "b" }, id, to)
        .tabs.map((tab) => tab.id)
        .join("");

    test("puts it in its new place, keeping the active tab", () => {
      expect(order(0)).toBe("abc");
      expect(order(1)).toBe("bac");
      expect(order(2)).toBe("bca");
      expect(order(0, "c")).toBe("cab");
      expect(moveTab({ tabs, activeId: "b" }, "a", 2).activeId).toBe("b");
    });

    test("stops at the ends of the row", () => {
      expect(order(-1)).toBe("abc");
      expect(order(5)).toBe("bca");
    });

    test("leaves things as they are for a tab that's gone", () => {
      expect(moveTab({ tabs, activeId: "b" }, "x", 1)).toEqual({ tabs, activeId: "b" });
    });
  });

  describe("where a dragged tab lands", () => {
    // Tabs starting at 0, 100 and 150.
    const widths = [100, 50, 100];

    test("stays put until it has been moved far enough, however wide it is", () => {
      expect(slotAt(widths, 0, 0)).toBe(0);
      expect(slotAt(widths, 1, 100)).toBe(1);
      expect(slotAt(widths, 2, 150)).toBe(2);
      expect(slotAt([200, 20], 0, 0)).toBe(0);
      expect(slotAt([20, 200], 1, 20)).toBe(1);
    });

    test("passes a neighbor once its leading edge reaches that neighbor's middle", () => {
      // Moving right: its right edge against the middle of 125, then of 200.
      expect(slotAt(widths, 0, 24)).toBe(0);
      expect(slotAt(widths, 0, 26)).toBe(1);
      expect(slotAt(widths, 0, 99)).toBe(1);
      expect(slotAt(widths, 0, 101)).toBe(2);
      // Moving left: its left edge against the middle of 125, then of 50.
      expect(slotAt(widths, 2, 126)).toBe(2);
      expect(slotAt(widths, 2, 124)).toBe(1);
      expect(slotAt(widths, 2, 51)).toBe(1);
      expect(slotAt(widths, 2, 49)).toBe(0);
    });

    test("goes as far as the row does", () => {
      expect(slotAt(widths, 0, 999)).toBe(2);
      expect(slotAt(widths, 2, -50)).toBe(0);
    });

    test("is only one tab's business", () => {
      expect(slotAt([100], 0, 50)).toBe(0);
    });
  });

  describe("showing the files", () => {
    const note = { id: "a", sourceId: one };

    test("stays on a Files tab", () => {
      const view = { tabs: [note, { id: "b" }], activeId: "b" };
      expect(showFiles(view)).toBe(view);
    });

    test("goes to a Files tab that's open", () => {
      expect(showFiles({ tabs: [note, { id: "b" }], activeId: "a" })?.activeId).toBe("b");
    });

    test("opens one if none is", () => {
      const view = showFiles({ tabs: [note, { id: "b", sourceId: two }], activeId: "a" });
      expect(view?.tabs).toHaveLength(3);
      expect(view?.tabs[2].sourceId).toBeUndefined();
    });

    test("gives up if there's no room for one", () => {
      const tabs = Array.from({ length: MAX_NOTE_TABS }, (_, i) => ({
        id: String(i),
        sourceId: String(i) as Id<"sources">,
      }));
      expect(showFiles({ tabs, activeId: "0" })).toBeNull();
    });
  });
});
