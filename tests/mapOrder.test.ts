import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { movedBefore } from "../convex/model";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

async function fixture() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice", issuer: "https://clerk.test" });
  const bob = t.withIdentity({ subject: "bob", issuer: "https://clerk.test" });
  const projectId = await alice.mutation(api.library.createProject, { name: "Biology" });
  const add = (title: string, inProject = projectId) =>
    alice.mutation(api.library.createMap, { projectId: inProject, title });
  const a = await add("a");
  const b = await add("b");
  const c = await add("c");
  const titles = async (user = alice, project = projectId) =>
    (await user.query(api.library.list))
      .find(({ _id }) => _id === project)!
      .maps.map((map) => map.title)
      .join("");
  const join = () =>
    t.run((ctx) =>
      ctx.db.insert("projectMembers", {
        projectId,
        userId: "https://clerk.test|bob",
        role: "member",
      }),
    );
  return { t, alice, bob, projectId, add, a, b, c, titles, join };
}

describe("moving a map", () => {
  test("maps start oldest first", async () => {
    const { titles } = await fixture();
    expect(await titles()).toBe("abc");
  });

  test("puts it just before another", async () => {
    const { alice, a, b, c, titles } = await fixture();
    await alice.mutation(api.library.moveMap, { topicId: c, before: a });
    expect(await titles()).toBe("cab");
    await alice.mutation(api.library.moveMap, { topicId: a, before: b });
    expect(await titles()).toBe("cab");
    await alice.mutation(api.library.moveMap, { topicId: b, before: a });
    expect(await titles()).toBe("cba");
  });

  test("puts it at the end given nothing to go before", async () => {
    const { alice, a, titles } = await fixture();
    await alice.mutation(api.library.moveMap, { topicId: a, before: null });
    expect(await titles()).toBe("bca");
  });

  test("everyone in the project sees it", async () => {
    const { alice, bob, c, a, titles, join } = await fixture();
    await join();
    await alice.mutation(api.library.moveMap, { topicId: c, before: a });
    expect(await titles(bob)).toBe("cab");
  });

  test("any member can do it", async () => {
    const { bob, c, a, titles, join } = await fixture();
    await join();
    await bob.mutation(api.library.moveMap, { topicId: c, before: a });
    expect(await titles()).toBe("cab");
  });

  test("anyone else can't", async () => {
    const { bob, c, a, titles } = await fixture();
    await expect(bob.mutation(api.library.moveMap, { topicId: c, before: a })).rejects.toThrow();
    expect(await titles()).toBe("abc");
  });

  test("two members' moves both count", async () => {
    const { alice, bob, a, b, c, titles, join } = await fixture();
    await join();
    await alice.mutation(api.library.moveMap, { topicId: c, before: a });
    // Bob hasn't seen that yet, and says where his goes by its neighbor.
    await bob.mutation(api.library.moveMap, { topicId: a, before: null });
    expect(await titles()).toBe("cba");
    expect(b).toBeDefined();
  });

  test("a new map goes at the end, after any arranging", async () => {
    const { alice, a, c, add, titles } = await fixture();
    await alice.mutation(api.library.moveMap, { topicId: c, before: a });
    await add("d");
    expect(await titles()).toBe("cabd");
  });

  test("a deleted map leaves the order, and a move forgets it", async () => {
    const { t, alice, projectId, a, b, c, titles } = await fixture();
    await alice.mutation(api.library.moveMap, { topicId: c, before: a });
    await alice.mutation(api.library.deleteMap, { topicId: a });
    expect(await titles()).toBe("cb");
    await alice.mutation(api.library.moveMap, { topicId: b, before: c });
    expect(await titles()).toBe("bc");
    const project = await t.run((ctx) => ctx.db.get(projectId));
    expect(project!.mapOrder).toEqual([b, c]);
  });

  test("going before a map that's gone puts it at the end", async () => {
    const { alice, a, b, titles } = await fixture();
    await alice.mutation(api.library.deleteMap, { topicId: b });
    await alice.mutation(api.library.moveMap, { topicId: a, before: b });
    expect(await titles()).toBe("ca");
  });

  test("a map can't go to another project", async () => {
    const { alice, a, add, titles, projectId } = await fixture();
    const elsewhere = await alice.mutation(api.library.createProject, { name: "Chemistry" });
    const other = await add("x", elsewhere);
    await alice.mutation(api.library.moveMap, { topicId: a, before: other });
    expect(await titles()).toBe("bca");
    expect(await titles(alice, elsewhere)).toBe("x");
    expect(projectId).toBeDefined();
  });

  test("leaves other projects' orders alone", async () => {
    const { alice, a, c, add, titles } = await fixture();
    const elsewhere = await alice.mutation(api.library.createProject, { name: "Chemistry" });
    await add("x", elsewhere);
    await add("y", elsewhere);
    await alice.mutation(api.library.moveMap, { topicId: c, before: a });
    expect(await titles(alice, elsewhere)).toBe("xy");
  });

  test("a deleted map can't be moved", async () => {
    const { alice, a } = await fixture();
    await alice.mutation(api.library.deleteMap, { topicId: a });
    await expect(
      alice.mutation(api.library.moveMap, { topicId: a, before: null }),
    ).rejects.toThrow();
  });
});

describe("movedBefore", () => {
  const ids = ["a", "b", "c"] as Id<"topics">[];
  const order = (item: string, before: string | null) =>
    movedBefore(ids as string[], item, before).join("");

  test("moves in either direction", () => {
    expect(order("c", "a")).toBe("cab");
    expect(order("a", "c")).toBe("bac");
    expect(order("a", null)).toBe("bca");
  });

  test("stays put when it's already there", () => {
    expect(order("a", "b")).toBe("abc");
    expect(order("c", null)).toBe("abc");
  });

  test("goes to the end given something not in the list, or itself", () => {
    expect(order("a", "x")).toBe("bca");
    expect(order("b", "b")).toBe("acb");
  });
});
