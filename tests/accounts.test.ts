import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

async function fixture() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice", issuer: "https://clerk.test" });
  const bob = t.withIdentity({ subject: "bob", issuer: "https://clerk.test" });
  const folderId = await alice.mutation(api.library.createFolder, { name: "Alice's folder" });
  const topicId = await alice.mutation(api.library.createMap, { folderId });
  const workspace = await alice.query(api.workspace.get, { topicId });
  const mapId = workspace!.referenceMapId!;
  const recallId = await alice.mutation(api.workspace.startRecall, { topicId });
  return { t, alice, bob, folderId, topicId, mapId, recallId };
}

describe("account ownership", () => {
  test("signed-out callers cannot read or mutate any workspace data", async () => {
    const { t, folderId, topicId, mapId, recallId } = await fixture();
    const calls = [
      () => t.query(api.library.list),
      () => t.query(api.workspace.get, { topicId }),
      () => t.query(api.nodes.list, { mapId }),
      () => t.query(api.links.list, { mapId: recallId }),
      () => t.mutation(api.workspace.seed),
      () => t.mutation(api.library.createFolder, { name: "No" }),
      () => t.mutation(api.library.createMap, { folderId }),
      () => t.mutation(api.library.renameFolder, { folderId, name: "No" }),
      () => t.mutation(api.library.renameMap, { topicId, title: "No" }),
      () => t.mutation(api.library.deleteMap, { topicId }),
      () => t.mutation(api.library.deleteFolder, { folderId, confirmation: "Alice's folder" }),
      () => t.mutation(api.nodes.apply, { mapId, upserts: [], removes: [] }),
      () => t.mutation(api.links.set, { mapId: recallId, links: [] }),
      () => t.mutation(api.workspace.startRecall, { topicId }),
      () => t.mutation(api.workspace.finishRecall, { mapId: recallId }),
      () => t.mutation(api.workspace.abandonRecall, { mapId: recallId }),
    ];
    for (const call of calls) await expect(call()).rejects.toThrow("Sign in to continue");
  });

  test("another account cannot use guessed folder, topic, reference, or recall IDs", async () => {
    const { alice, bob, folderId, topicId, mapId, recallId } = await fixture();
    expect(await bob.query(api.library.list)).toEqual([]);
    expect(await bob.query(api.workspace.get, { topicId })).toBeNull();
    const calls = [
      () => bob.query(api.nodes.list, { mapId }),
      () => bob.query(api.nodes.list, { mapId: recallId }),
      () => bob.query(api.links.list, { mapId: recallId }),
      () => bob.mutation(api.library.createMap, { folderId }),
      () => bob.mutation(api.library.renameFolder, { folderId, name: "Stolen" }),
      () => bob.mutation(api.library.renameMap, { topicId, title: "Stolen" }),
      () => bob.mutation(api.library.deleteMap, { topicId }),
      () => bob.mutation(api.library.deleteFolder, { folderId, confirmation: "Alice's folder" }),
      () => bob.mutation(api.nodes.apply, { mapId, upserts: [], removes: [] }),
      () => bob.mutation(api.links.set, { mapId: recallId, links: [] }),
      () => bob.mutation(api.workspace.startRecall, { topicId }),
      () => bob.mutation(api.workspace.finishRecall, { mapId: recallId }),
      () => bob.mutation(api.workspace.abandonRecall, { mapId: recallId }),
    ];
    for (const call of calls) await expect(call()).rejects.toThrow("not found");
    expect((await alice.query(api.library.list))[0].name).toBe("Alice's folder");
    expect((await alice.query(api.workspace.get, { topicId }))?.recallMapId).toBe(recallId);
  });

  test("owners can create, rename, edit, finish, compare, and abandon attempts", async () => {
    const { alice, folderId, topicId, mapId, recallId } = await fixture();
    await alice.mutation(api.library.renameFolder, { folderId, name: "Course" });
    await alice.mutation(api.library.renameMap, { topicId, title: "Memory" });
    const root = (await alice.query(api.nodes.list, { mapId }))[0];
    expect(root.label).toBe("Memory");
    await alice.mutation(api.nodes.apply, {
      mapId,
      upserts: [{ key: "child", label: "Concept", parentKey: root.key, order: 0, isRoot: false }],
      removes: [],
    });
    await alice.mutation(api.workspace.finishRecall, { mapId: recallId });
    await alice.mutation(api.links.set, { mapId: recallId, links: [] });
    expect(await alice.query(api.links.list, { mapId: recallId })).toEqual([]);
    expect((await alice.query(api.workspace.get, { topicId }))?.resultMapId).toBe(recallId);
    const next = await alice.mutation(api.workspace.startRecall, { topicId });
    await alice.mutation(api.workspace.abandonRecall, { mapId: next });
    expect((await alice.query(api.workspace.get, { topicId }))?.recallMapId).toBeNull();
  });

  test("each account seeds its own library without duplicating or claiming legacy data", async () => {
    const t = convexTest(schema, modules);
    const legacy = await t.run(async (ctx) => {
      const folderId = await ctx.db.insert("folders", { name: "Legacy", order: 0 });
      return ctx.db.insert("topics", { folderId, title: "Private old map" });
    });
    const alice = t.withIdentity({ subject: "alice" });
    const bob = t.withIdentity({ subject: "bob" });
    await alice.mutation(api.workspace.seed);
    const library = await alice.query(api.library.list);
    expect(library.length).toBeGreaterThan(0);
    await alice.mutation(api.workspace.seed);
    expect(await alice.query(api.library.list)).toEqual(library);
    expect(await bob.query(api.library.list)).toEqual([]);
    await bob.mutation(api.workspace.seed);
    const other = await bob.query(api.library.list);
    expect(other.map((folder) => folder.name)).toEqual(library.map((folder) => folder.name));
    expect(other[0]._id).not.toBe(library[0]._id);
    expect((await alice.query(api.workspace.get, { topicId: legacy }))?.topic._id).not.toBe(legacy);
    expect((await t.run((ctx) => ctx.db.get(legacy)))?.ownerId).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.get(legacy)))?.title).toBe("Private old map");
  });

  test("stale, malformed, and foreign URLs fall back to the caller's own map", async () => {
    const { alice, bob, topicId } = await fixture();
    await bob.mutation(api.workspace.seed);
    const own = await bob.query(api.workspace.get, {});
    for (const value of [topicId, "invalid-id", undefined]) {
      expect((await bob.query(api.workspace.get, { topicId: value }))?.topic._id).toBe(
        own?.topic._id,
      );
    }
    expect((await alice.query(api.workspace.get, { topicId }))?.topic._id).toBe(topicId);
  });
});

describe("library deletion", () => {
  test("deleting a map removes every reference and recall node but preserves its folder and other maps", async () => {
    const { t, alice, bob, folderId, topicId, mapId, recallId } = await fixture();
    await alice.mutation(api.workspace.finishRecall, { mapId: recallId });
    const activeRecall = await alice.mutation(api.workspace.startRecall, { topicId });
    const sibling = await alice.mutation(api.library.createMap, { folderId });
    const otherFolder = await bob.mutation(api.library.createFolder, { name: "Bob's folder" });
    const otherTopic = await bob.mutation(api.library.createMap, { folderId: otherFolder });
    await alice.mutation(api.library.deleteMap, { topicId });
    await t.run(async (ctx) => {
      expect(await ctx.db.get(topicId)).toBeNull();
      for (const id of [mapId, recallId, activeRecall]) {
        expect(await ctx.db.get(id)).toBeNull();
        expect(
          await ctx.db
            .query("nodes")
            .withIndex("by_map_key", (q) => q.eq("mapId", id))
            .collect(),
        ).toEqual([]);
      }
      expect(await ctx.db.get(folderId)).not.toBeNull();
      expect(await ctx.db.get(sibling)).not.toBeNull();
      expect(await ctx.db.get(otherTopic)).not.toBeNull();
    });
    expect((await alice.query(api.workspace.get, { topicId }))?.topic._id).toBe(sibling);
  });

  test("folder deletion requires the current exact name and cascades only through that folder", async () => {
    const { t, alice, folderId, topicId } = await fixture();
    const secondTopic = await alice.mutation(api.library.createMap, { folderId });
    const safeFolder = await alice.mutation(api.library.createFolder, { name: "Keep" });
    const safeTopic = await alice.mutation(api.library.createMap, { folderId: safeFolder });
    for (const confirmation of ["", "alice's folder", "Alice's folder "]) {
      await expect(
        alice.mutation(api.library.deleteFolder, { folderId, confirmation }),
      ).rejects.toThrow("doesn't match");
    }
    await alice.mutation(api.library.renameFolder, { folderId, name: "Renamed" });
    await expect(
      alice.mutation(api.library.deleteFolder, { folderId, confirmation: "Alice's folder" }),
    ).rejects.toThrow("doesn't match");
    await alice.mutation(api.library.deleteFolder, { folderId, confirmation: "Renamed" });
    await t.run(async (ctx) => {
      expect(await ctx.db.get(folderId)).toBeNull();
      expect(await ctx.db.get(topicId)).toBeNull();
      expect(await ctx.db.get(secondTopic)).toBeNull();
      const maps = await ctx.db.query("maps").collect();
      expect(maps.every((m) => m.topicId === safeTopic)).toBe(true);
      const mapIds = new Set(maps.map((m) => m._id));
      expect((await ctx.db.query("nodes").collect()).every((n) => mapIds.has(n.mapId))).toBe(true);
    });
    expect((await alice.query(api.library.list)).map((f) => f._id)).toEqual([safeFolder]);
  });

  test("deleting the last folder leaves an empty library after initialization runs again", async () => {
    const { alice, folderId } = await fixture();
    await alice.mutation(api.library.deleteFolder, { folderId, confirmation: "Alice's folder" });
    await alice.mutation(api.workspace.seed);
    expect(await alice.query(api.library.list)).toEqual([]);
    expect(await alice.query(api.workspace.get, {})).toBeNull();
    const freshFolder = await alice.mutation(api.library.createFolder, { name: "Fresh" });
    const freshTopic = await alice.mutation(api.library.createMap, { folderId: freshFolder });
    expect((await alice.query(api.workspace.get, {}))?.topic._id).toBe(freshTopic);
  });
});
