import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { MAX_IMPORT_NODES, parseMapFile, toMapFile } from "../convex/mapFile";
import type { MapNode } from "../convex/model";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

const nodes: MapNode[] = [
  { key: "b", label: "Second", parentKey: "root", order: 1, isRoot: false, x: 5, y: 5 },
  { key: "root", label: "Cells", order: 0, isRoot: true },
  { key: "a", label: "First", parentKey: "root", order: 0, isRoot: false },
  { key: "a1", label: "Nested", parentKey: "a", order: 0, isRoot: false },
  { key: "f", label: "Loose idea", order: 0, isRoot: false, x: 300, y: -40 },
];

const file = (overrides: object = {}) => ({ ...toMapFile("Cells", nodes), ...overrides });
const problem = (data: unknown) => {
  try {
    parseMapFile(data);
  } catch (error) {
    return (error as Error).message;
  }
};

describe("map files", () => {
  test("save the tree in order, then floating nodes, without tree positions", () => {
    const saved = toMapFile("Cells", nodes);
    expect(saved).toMatchObject({ format: "mind-graph-map", version: 1, title: "Cells" });
    expect(saved.nodes.map((n) => n.key)).toEqual(["root", "a", "a1", "b", "f"]);
    expect(saved.nodes[3]).not.toHaveProperty("x");
    expect(saved.nodes[4]).toMatchObject({ x: 300, y: -40 });
  });

  test("read back what was saved, after a trip through JSON", () => {
    const read = parseMapFile(JSON.parse(JSON.stringify(toMapFile("Cells", nodes))));
    expect(read.title).toBe("Cells");
    expect(read.nodes).toHaveLength(nodes.length);
  });

  test("save nodes cut off from the root as floating", () => {
    const orphan = { key: "o", label: "Orphan", parentKey: "gone", order: 0, isRoot: false };
    const saved = toMapFile("Cells", [...nodes, orphan]);
    expect(saved.nodes.at(-1)).toEqual({ key: "o", label: "Orphan", order: 0, isRoot: false });
    expect(() => parseMapFile(saved)).not.toThrow();
  });

  test("explain why a file can't be imported", () => {
    const root = nodes[1];
    expect(problem({ hello: "world" })).toBe("This file isn't a Mind Graph map");
    expect(problem(file({ version: 2 }))).toBe(
      "This map was saved by a newer version of Mind Graph",
    );
    expect(problem(file({ nodes: [{ ...root, label: 3 }] }))).toBe(
      "This map has a node that can't be read",
    );
    expect(problem(file({ nodes: [] }))).toBe("This map must have exactly one root");
    expect(problem(file({ nodes: [root, { ...root, key: "r2" }] }))).toBe(
      "This map must have exactly one root",
    );
    expect(problem(file({ nodes: [root, root] }))).toBe("This map has two nodes with the same key");
    expect(
      problem(
        file({
          nodes: [root, { key: "x", label: "", parentKey: "nope", order: 0, isRoot: false }],
        }),
      ),
    ).toBe("This map has a node whose parent is missing");
    expect(
      problem(
        file({
          nodes: [
            root,
            { key: "x", label: "", parentKey: "y", order: 0, isRoot: false },
            { key: "y", label: "", parentKey: "x", order: 0, isRoot: false },
          ],
        }),
      ),
    ).toBe("This map has a cycle");
    expect(
      problem(
        file({
          nodes: [
            root,
            { key: "f", label: "", order: 0, isRoot: false },
            { key: "c", label: "", parentKey: "f", order: 0, isRoot: false },
          ],
        }),
      ),
    ).toBe("This map has children under a floating node");
    expect(problem(file({ nodes: [{ ...root, label: "x".repeat(501) }] }))).toBe(
      "This map has a label that's too long",
    );
    const many = Array.from({ length: MAX_IMPORT_NODES }, (_, i) => ({
      key: `n${i}`,
      label: "",
      parentKey: "root",
      order: i,
      isRoot: false,
    }));
    expect(problem(file({ nodes: [root, ...many] }))).toBe(
      `Maps can have at most ${MAX_IMPORT_NODES} nodes`,
    );
  });
});

describe("importMap", () => {
  async function fixture() {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "alice", issuer: "https://clerk.test" });
    const bob = t.withIdentity({ subject: "bob", issuer: "https://clerk.test" });
    const projectId = await alice.mutation(api.library.createProject, { name: "Biology" });
    return { t, alice, bob, projectId };
  }

  test("creates a new map with the file's nodes under new keys", async () => {
    const { alice, projectId } = await fixture();
    const { nodes: saved } = toMapFile("Cells", nodes);
    const topicId = await alice.mutation(api.library.importMap, {
      projectId,
      title: " Cells (copy) ",
      nodes: saved,
    });
    const workspace = await alice.query(api.workspace.get, { topicId });
    expect(workspace!.topic.title).toBe("Cells (copy)");
    const imported = await alice.query(api.nodes.list, { mapId: workspace!.referenceMapId! });
    expect(imported).toHaveLength(saved.length);
    expect(imported.some((n) => saved.some((s) => s.key === n.key))).toBe(false);

    // Exporting the import gives back the same map.
    const strip = (list: MapNode[]) => {
      const labels = new Map(list.map((n) => [n.key, n.label]));
      return list.map(({ label, order, x, y, isRoot, parentKey }) => ({
        label,
        order,
        x,
        y,
        isRoot,
        parent: parentKey && labels.get(parentKey),
      }));
    };
    expect(strip(toMapFile("Cells", imported).nodes)).toEqual(strip(saved));
  });

  test("rejects maps that aren't valid and projects the caller can't use", async () => {
    const { t, alice, bob, projectId } = await fixture();
    const root = nodes[1];
    await expect(
      alice.mutation(api.library.importMap, { projectId, title: "Bad", nodes: [root, root] }),
    ).rejects.toThrow("This map has two nodes with the same key");
    await expect(
      alice.mutation(api.library.importMap, { projectId, title: "  ", nodes: [root] }),
    ).rejects.toThrow("Name can't be empty");
    await expect(
      bob.mutation(api.library.importMap, { projectId, title: "Stolen", nodes: [root] }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.library.importMap, { projectId, title: "No", nodes: [root] }),
    ).rejects.toThrow("Sign in to continue");
    expect((await alice.query(api.library.list))[0].maps).toEqual([]);
  });
});
