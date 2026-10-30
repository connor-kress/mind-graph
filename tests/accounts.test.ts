import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");

async function fixture() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice", issuer: "https://clerk.test" });
  const bob = t.withIdentity({ subject: "bob", issuer: "https://clerk.test" });
  const projectId = await alice.mutation(api.library.createProject, { name: "Alice's project" });
  const topicId = await alice.mutation(api.library.createMap, { projectId, title: "Untitled map" });
  const workspace = await alice.query(api.workspace.get, { topicId });
  const mapId = workspace!.referenceMapId!;
  const recallId = await alice.mutation(api.workspace.startRecall, { topicId });
  return { t, alice, bob, projectId, topicId, mapId, recallId };
}

describe("account ownership", () => {
  test("signed-out callers cannot read or mutate any workspace data", async () => {
    const { t, projectId, topicId, mapId, recallId } = await fixture();
    const calls = [
      () => t.query(api.library.list),
      () => t.query(api.workspace.get, { topicId }),
      () => t.query(api.nodes.list, { mapId }),
      () => t.query(api.links.list, { mapId: recallId }),
      () => t.mutation(api.workspace.seed),
      () => t.mutation(api.library.createProject, { name: "No" }),
      () => t.mutation(api.library.createMap, { projectId, title: "Untitled map" }),
      () => t.mutation(api.library.renameProject, { projectId, name: "No" }),
      () => t.mutation(api.library.renameMap, { topicId, title: "No" }),
      () => t.mutation(api.library.deleteMap, { topicId }),
      () => t.mutation(api.library.deleteProject, { projectId, confirmation: "Alice's project" }),
      () => t.mutation(api.nodes.apply, { mapId, upserts: [], removes: [] }),
      () => t.mutation(api.links.set, { mapId: recallId, links: [] }),
      () => t.mutation(api.workspace.startRecall, { topicId }),
      () => t.mutation(api.workspace.finishRecall, { mapId: recallId }),
      () => t.mutation(api.workspace.abandonRecall, { mapId: recallId }),
    ];
    for (const call of calls) await expect(call()).rejects.toThrow("Sign in to continue");
  });

  test("another account cannot use guessed project, topic, reference, or recall IDs", async () => {
    const { alice, bob, projectId, topicId, mapId, recallId } = await fixture();
    expect(await bob.query(api.library.list)).toEqual([]);
    expect(await bob.query(api.workspace.get, { topicId })).toBeNull();
    const calls = [
      () => bob.query(api.nodes.list, { mapId }),
      () => bob.query(api.nodes.list, { mapId: recallId }),
      () => bob.query(api.links.list, { mapId: recallId }),
      () => bob.mutation(api.library.createMap, { projectId, title: "Untitled map" }),
      () => bob.mutation(api.library.renameProject, { projectId, name: "Stolen" }),
      () => bob.mutation(api.library.renameMap, { topicId, title: "Stolen" }),
      () => bob.mutation(api.library.deleteMap, { topicId }),
      () => bob.mutation(api.library.deleteProject, { projectId, confirmation: "Alice's project" }),
      () => bob.mutation(api.nodes.apply, { mapId, upserts: [], removes: [] }),
      () => bob.mutation(api.links.set, { mapId: recallId, links: [] }),
      () => bob.mutation(api.workspace.startRecall, { topicId }),
      () => bob.mutation(api.workspace.finishRecall, { mapId: recallId }),
      () => bob.mutation(api.workspace.abandonRecall, { mapId: recallId }),
    ];
    for (const call of calls) await expect(call()).rejects.toThrow("not found");
    expect((await alice.query(api.library.list))[0].name).toBe("Alice's project");
    expect((await alice.query(api.workspace.get, { topicId }))?.recallMapId).toBe(recallId);
  });

  test("owners can create, rename, edit, finish, compare, and abandon attempts", async () => {
    const { alice, projectId, topicId, mapId, recallId } = await fixture();
    await alice.mutation(api.library.renameProject, { projectId, name: "Course" });
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
    expect(library).toHaveLength(1);
    expect(library[0]).toMatchObject({ name: "Example Project", role: "owner" });
    expect(library[0].maps.map((map) => map.title)).toEqual([
      "Cellular respiration",
      "Hypothesis testing",
    ]);
    await alice.mutation(api.workspace.seed);
    expect(await alice.query(api.library.list)).toEqual(library);
    expect(await bob.query(api.library.list)).toEqual([]);
    await bob.mutation(api.workspace.seed);
    const other = await bob.query(api.library.list);
    expect(other.map((project) => project.name)).toEqual(library.map((project) => project.name));
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
  test("deleting a map removes every reference and recall node but preserves its project and other maps", async () => {
    const { t, alice, bob, projectId, topicId, mapId, recallId } = await fixture();
    await alice.mutation(api.workspace.finishRecall, { mapId: recallId });
    const activeRecall = await alice.mutation(api.workspace.startRecall, { topicId });
    const sibling = await alice.mutation(api.library.createMap, {
      projectId,
      title: "Untitled map",
    });
    const otherProject = await bob.mutation(api.library.createProject, { name: "Bob's project" });
    const otherTopic = await bob.mutation(api.library.createMap, {
      projectId: otherProject,
      title: "Untitled map",
    });
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
      expect(await ctx.db.get(projectId)).not.toBeNull();
      expect(await ctx.db.get(sibling)).not.toBeNull();
      expect(await ctx.db.get(otherTopic)).not.toBeNull();
    });
    expect((await alice.query(api.workspace.get, { topicId }))?.topic._id).toBe(sibling);
  });

  test("project deletion requires the current exact name and cascades only through that project", async () => {
    const { t, alice, projectId, topicId } = await fixture();
    const secondTopic = await alice.mutation(api.library.createMap, {
      projectId,
      title: "Untitled map",
    });
    const safeProject = await alice.mutation(api.library.createProject, { name: "Keep" });
    const safeTopic = await alice.mutation(api.library.createMap, {
      projectId: safeProject,
      title: "Untitled map",
    });
    for (const confirmation of ["", "alice's project", "Alice's project "]) {
      await expect(
        alice.mutation(api.library.deleteProject, { projectId, confirmation }),
      ).rejects.toThrow("doesn't match");
    }
    await alice.mutation(api.library.renameProject, { projectId, name: "Renamed" });
    await expect(
      alice.mutation(api.library.deleteProject, { projectId, confirmation: "Alice's project" }),
    ).rejects.toThrow("doesn't match");
    await alice.mutation(api.library.deleteProject, { projectId, confirmation: "Renamed" });
    await t.run(async (ctx) => {
      expect(await ctx.db.get(projectId)).toBeNull();
      expect(await ctx.db.get(topicId)).toBeNull();
      expect(await ctx.db.get(secondTopic)).toBeNull();
      const maps = await ctx.db.query("maps").collect();
      expect(maps.every((m) => m.topicId === safeTopic)).toBe(true);
      const mapIds = new Set(maps.map((m) => m._id));
      expect((await ctx.db.query("nodes").collect()).every((n) => mapIds.has(n.mapId))).toBe(true);
    });
    expect((await alice.query(api.library.list)).map((f) => f._id)).toEqual([safeProject]);
  });

  test("deleting the last project leaves an empty library after initialization runs again", async () => {
    const { alice, projectId } = await fixture();
    await alice.mutation(api.library.deleteProject, { projectId, confirmation: "Alice's project" });
    await alice.mutation(api.workspace.seed);
    expect(await alice.query(api.library.list)).toEqual([]);
    expect(await alice.query(api.workspace.get, {})).toBeNull();
    const freshProject = await alice.mutation(api.library.createProject, { name: "Fresh" });
    const freshTopic = await alice.mutation(api.library.createMap, {
      projectId: freshProject,
      title: "Untitled map",
    });
    expect((await alice.query(api.workspace.get, {}))?.topic._id).toBe(freshTopic);
  });
});

async function addMember(
  t: Awaited<ReturnType<typeof fixture>>["t"],
  projectId: Id<"projects">,
  userId: string,
) {
  return t.run((ctx) => ctx.db.insert("projectMembers", { projectId, userId, role: "member" }));
}

describe("project membership", () => {
  test("new projects start with one owner; membership shares references but not personal recalls", async () => {
    const { t, alice, bob, projectId, topicId, mapId, recallId } = await fixture();
    const bobId = await bob.run(async (ctx) => (await ctx.auth.getUserIdentity())!.tokenIdentifier);
    const members = await t.run((ctx) => ctx.db.query("projectMembers").collect());
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe("owner");
    const membershipId = await addMember(t, projectId, bobId);
    expect((await bob.query(api.library.list))[0]).toMatchObject({
      _id: projectId,
      role: "member",
    });
    expect((await bob.query(api.workspace.get, { topicId }))?.topic._id).toBe(topicId);
    await bob.mutation(api.library.renameMap, { topicId, title: "Shared map" });
    expect((await alice.query(api.library.list))[0].maps[0].title).toBe("Shared map");
    const root = (await bob.query(api.nodes.list, { mapId }))[0];
    await bob.mutation(api.nodes.apply, {
      mapId,
      upserts: [
        {
          key: "member-node",
          parentKey: root.key,
          label: "Shared concept",
          isRoot: false,
          order: 0,
        },
      ],
      removes: [],
    });
    expect(
      (await alice.query(api.nodes.list, { mapId })).some((n) => n.key === "member-node"),
    ).toBe(true);
    const memberMap = await bob.mutation(api.library.createMap, {
      projectId,
      title: "Untitled map",
    });
    await bob.mutation(api.library.deleteMap, { topicId: memberMap });
    expect(await t.run((ctx) => ctx.db.get(memberMap))).toBeNull();
    await expect(
      bob.mutation(api.library.renameProject, { projectId, name: "No" }),
    ).rejects.toThrow("Only the project owner");
    await expect(
      bob.mutation(api.library.deleteProject, { projectId, confirmation: "Alice's project" }),
    ).rejects.toThrow("Only the project owner");
    expect((await bob.query(api.workspace.get, { topicId }))?.recallMapId).toBeNull();
    const bobRecall = await bob.mutation(api.workspace.startRecall, { topicId });
    expect(bobRecall).not.toBe(recallId);
    expect(await alice.mutation(api.workspace.startRecall, { topicId })).toBe(recallId);
    expect(await bob.mutation(api.workspace.startRecall, { topicId })).toBe(bobRecall);
    for (const [caller, otherRecall] of [
      [alice, bobRecall],
      [bob, recallId],
    ] as const) {
      await expect(caller.query(api.nodes.list, { mapId: otherRecall })).rejects.toThrow(
        "not found",
      );
      await expect(
        caller.mutation(api.nodes.apply, { mapId: otherRecall, upserts: [], removes: [] }),
      ).rejects.toThrow("not found");
      await expect(
        caller.mutation(api.workspace.finishRecall, { mapId: otherRecall }),
      ).rejects.toThrow("not found");
      await expect(
        caller.mutation(api.workspace.abandonRecall, { mapId: otherRecall }),
      ).rejects.toThrow("not found");
      await expect(caller.query(api.links.list, { mapId: otherRecall })).rejects.toThrow(
        "not found",
      );
      await expect(
        caller.mutation(api.links.set, { mapId: otherRecall, links: [] }),
      ).rejects.toThrow("not found");
    }
    await alice.mutation(api.workspace.finishRecall, { mapId: recallId });
    expect((await bob.query(api.workspace.get, { topicId }))?.resultMapId).toBeNull();
    await bob.mutation(api.workspace.finishRecall, { mapId: bobRecall });
    expect((await bob.query(api.workspace.get, { topicId }))?.resultMapId).toBe(bobRecall);
    expect((await alice.query(api.workspace.get, { topicId }))?.resultMapId).toBe(recallId);
    await bob.mutation(api.workspace.seed);
    expect(await bob.query(api.library.list)).toHaveLength(1);
    await t.run((ctx) => ctx.db.delete(membershipId));
    expect(await bob.query(api.library.list)).toEqual([]);
    expect(await bob.query(api.workspace.get, { topicId })).toBeNull();
    await expect(bob.query(api.nodes.list, { mapId })).rejects.toThrow("not found");
    await expect(bob.query(api.nodes.list, { mapId: bobRecall })).rejects.toThrow("not found");
    await bob.mutation(api.workspace.seed);
    expect(await bob.query(api.library.list)).toEqual([]);
  });

  test("deleting a project removes memberships and every member's recall data", async () => {
    const { t, alice, bob, projectId, topicId } = await fixture();
    const bobId = await bob.run(async (ctx) => (await ctx.auth.getUserIdentity())!.tokenIdentifier);
    await addMember(t, projectId, bobId);
    await bob.mutation(api.workspace.startRecall, { topicId });
    await alice.mutation(api.library.deleteProject, { projectId, confirmation: "Alice's project" });
    await t.run(async (ctx) => {
      for (const table of ["projects", "projectMembers", "topics", "maps", "nodes"] as const)
        expect(await ctx.db.query(table).collect()).toEqual([]);
    });
    await bob.mutation(api.workspace.seed);
    expect(await bob.query(api.library.list)).toEqual([]);
  });
});

describe("project migration", () => {
  test("old ownership becomes membership without changing topic, node, or recall IDs", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "alice", issuer: "https://clerk.test" });
    const bob = t.withIdentity({ subject: "bob", issuer: "https://clerk.test" });
    const ownerId = await alice.run(
      async (ctx) => (await ctx.auth.getUserIdentity())!.tokenIdentifier,
    );
    const old = await t.run(async (ctx) => {
      const folderId = await ctx.db.insert("folders", {
        ownerId,
        name: "Original course",
        order: 3,
      });
      const topicId = await ctx.db.insert("topics", {
        ownerId,
        folderId,
        title: "Original map",
        notes: { heading: "Notes", paragraphs: ["Keep me"] },
      });
      const referenceId = await ctx.db.insert("maps", { topicId, kind: "reference" });
      const recallId = await ctx.db.insert("maps", {
        topicId,
        kind: "recall",
        finishedAt: 123,
        links: [],
      });
      const activeId = await ctx.db.insert("maps", { topicId, kind: "recall" });
      const nodeId = await ctx.db.insert("nodes", {
        mapId: referenceId,
        key: "root",
        label: "Original map",
        isRoot: true,
        order: 0,
      });
      await ctx.db.insert("libraries", { ownerId });
      const unclaimed = await ctx.db.insert("topics", { folderId, title: "Unclaimed" });
      const orphan = await ctx.db.insert("topics", { ownerId, title: "No folder" });
      return { folderId, topicId, referenceId, recallId, activeId, nodeId, unclaimed, orphan };
    });
    await alice.mutation(api.workspace.seed);
    const projects = await alice.query(api.library.list);
    expect(projects).toHaveLength(2);
    const migrated = projects.find((p) => p.name === "Original course")!;
    expect(migrated).toMatchObject({
      role: "owner",
      maps: [{ _id: old.topicId, title: "Original map" }],
    });
    const workspace = await alice.query(api.workspace.get, { topicId: old.topicId });
    expect(workspace).toMatchObject({
      projectName: "Original course",
      referenceMapId: old.referenceId,
      recallMapId: old.activeId,
      resultMapId: old.recallId,
    });
    expect(workspace?.topic.notes?.paragraphs).toEqual(["Keep me"]);
    expect((await alice.query(api.nodes.list, { mapId: old.referenceId }))[0].key).toBe("root");
    expect((await t.run((ctx) => ctx.db.get(old.nodeId)))?.mapId).toBe(old.referenceId);
    expect(await bob.query(api.workspace.get, { topicId: old.topicId })).toBeNull();
    await alice.mutation(api.workspace.seed);
    for (const phase of ["folders", "topics"] as const)
      await t.mutation(internal.workspace.migrateProjects, { phase });
    expect(await alice.query(api.library.list)).toEqual(projects);
    await t.run(async (ctx) => {
      expect((await ctx.db.get(old.recallId))?.userId).toBe(ownerId);
      expect((await ctx.db.get(old.activeId))?.userId).toBe(ownerId);
      expect((await ctx.db.get(old.unclaimed))?.projectId).toBeUndefined();
      expect(await ctx.db.get(old.folderId)).not.toBeNull();
    });
    await alice.mutation(api.library.deleteProject, {
      projectId: migrated._id,
      confirmation: migrated.name,
    });
    await alice.mutation(api.workspace.seed);
    for (const phase of ["folders", "topics"] as const)
      await t.mutation(internal.workspace.migrateProjects, { phase });
    expect(
      (await alice.query(api.library.list)).some(
        (p) => p._id === migrated._id || p.name === migrated.name,
      ),
    ).toBe(false);
  });

  test("global migration is paginated, repeatable, and preserves unclaimed data", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < 31; i++) {
        const folderId = await ctx.db.insert("folders", {
          ownerId: "legacy-owner",
          name: `Project ${i}`,
          order: i,
        });
        await ctx.db.insert("topics", { ownerId: "legacy-owner", folderId, title: `Map ${i}` });
      }
      await ctx.db.insert("folders", { name: "Unclaimed", order: 0 });
    });
    for (let pass = 0; pass < 2; pass++) {
      for (const phase of ["folders", "topics"] as const) {
        let cursor: string | undefined;
        for (;;) {
          const result = await t.mutation(internal.workspace.migrateProjects, { phase, cursor });
          if (result.isDone) break;
          cursor = result.cursor;
        }
      }
    }
    await t.run(async (ctx) => {
      expect(await ctx.db.query("projects").collect()).toHaveLength(31);
      expect(await ctx.db.query("projectMembers").collect()).toHaveLength(31);
      expect((await ctx.db.query("topics").collect()).every((topic) => topic.projectId)).toBe(true);
      expect(await ctx.db.query("folders").collect()).toHaveLength(32);
    });
  });
});

test("deleting a partially migrated project removes unlinked owned maps without resurrecting it", async () => {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  const ownerId = await alice.run(
    async (ctx) => (await ctx.auth.getUserIdentity())!.tokenIdentifier,
  );
  const topicId = await t.run(async (ctx) => {
    const folderId = await ctx.db.insert("folders", { ownerId, name: "Partial", order: 0 });
    return ctx.db.insert("topics", { folderId, ownerId, title: "Pending migration" });
  });
  await t.mutation(internal.workspace.migrateProjects, { phase: "folders" });
  const project = (await alice.query(api.library.list))[0];
  expect(project.maps).toEqual([]);
  await alice.mutation(api.library.deleteProject, {
    projectId: project._id,
    confirmation: "Partial",
  });
  await alice.mutation(api.workspace.seed);
  expect(await alice.query(api.library.list)).toEqual([]);
  expect(await t.run((ctx) => ctx.db.get(topicId))).toBeNull();
});

test("map creation validates its name before creating data and uses it for the reference root", async () => {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  for (const title of ["", "   ", "x".repeat(201)]) {
    await expect(alice.mutation(api.library.createMap, { title })).rejects.toThrow();
    await t.run(async (ctx) => {
      for (const table of ["projects", "projectMembers", "topics", "maps", "nodes"] as const) {
        expect(await ctx.db.query(table).collect()).toEqual([]);
      }
    });
  }
  const topicId = await alice.mutation(api.library.createMap, { title: "  New concept  " });
  const library = await alice.query(api.library.list);
  expect(library).toHaveLength(1);
  expect(library[0].maps).toEqual([{ _id: topicId, title: "New concept" }]);
  const workspace = await alice.query(api.workspace.get, { topicId });
  expect((await alice.query(api.nodes.list, { mapId: workspace!.referenceMapId! }))[0].label).toBe(
    "New concept",
  );
  await alice.mutation(api.library.createMap, { projectId: library[0]._id, title: "Second map" });
  const updated = await alice.query(api.library.list);
  expect(updated).toHaveLength(1);
  expect(updated[0].maps.map((map) => map.title)).toEqual(["New concept", "Second map"]);
});
