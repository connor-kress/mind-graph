import type { MapNode } from "../../convex/model";

export type { MapNode };
export type XY = { x: number; y: number };
export type Size = { width: number; height: number };
export type NodeMap = Map<string, MapNode>;

/** A batch of edits, applied atomically (and undone as one step). */
export type Change = { upserts: MapNode[]; removes: string[] };

/**
 * Derived structure of the one tree. Nodes whose parent chain doesn't reach
 * the root (which shouldn't happen, but can briefly during concurrent edits)
 * are treated as floating.
 */
export type Tree = {
  root: MapNode | undefined;
  children: Map<string, MapNode[]>;
  depth: Map<string, number>;
  floating: MapNode[];
};

export function buildTree(nodes: NodeMap): Tree {
  const children = new Map<string, MapNode[]>();
  let root: MapNode | undefined;
  for (const node of nodes.values()) {
    if (node.isRoot) root = node;
    if (node.parentKey !== undefined && !node.isRoot) {
      const siblings = children.get(node.parentKey) ?? [];
      siblings.push(node);
      children.set(node.parentKey, siblings);
    }
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
  }

  const depth = new Map<string, number>();
  if (root) {
    const stack: [MapNode, number][] = [[root, 0]];
    while (stack.length) {
      const [node, d] = stack.pop()!;
      if (depth.has(node.key)) continue;
      depth.set(node.key, d);
      for (const child of children.get(node.key) ?? []) stack.push([child, d + 1]);
    }
  }
  const floating = [...nodes.values()].filter((n) => !depth.has(n.key));
  return { root, children, depth, floating };
}

export function descendants(tree: Tree, key: string): MapNode[] {
  const out: MapNode[] = [];
  const seen = new Set([key]);
  const stack = [...(tree.children.get(key) ?? [])];
  while (stack.length) {
    const node = stack.pop()!;
    if (seen.has(node.key)) continue;
    seen.add(node.key);
    out.push(node);
    stack.push(...(tree.children.get(node.key) ?? []));
  }
  return out;
}

/**
 * Returns upserts that place `inserted` among `parentKey`'s children at
 * `index`, renumbering siblings whose order changes.
 */
export function placeAmongSiblings(
  tree: Tree,
  parentKey: string,
  inserted: MapNode[],
  index: number,
): MapNode[] {
  const insertedKeys = new Set(inserted.map((n) => n.key));
  const siblings = (tree.children.get(parentKey) ?? []).filter((n) => !insertedKeys.has(n.key));
  const clamped = Math.max(0, Math.min(index, siblings.length));
  siblings.splice(clamped, 0, ...inserted.map((n) => ({ ...n, parentKey })));
  const upserts: MapNode[] = [];
  siblings.forEach((node, order) => {
    if (insertedKeys.has(node.key) || node.order !== order) {
      upserts.push({ ...node, order, x: undefined, y: undefined });
    }
  });
  return upserts;
}

export function newKey() {
  return crypto.randomUUID();
}
