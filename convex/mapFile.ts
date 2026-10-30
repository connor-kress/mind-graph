import { MAX_LABEL_LENGTH, type MapNode } from "./model";

/**
 * A reference map saved as JSON, so it can be imported again as a new map.
 * Only the reference map is included: recall attempts belong to individual
 * members, and source notes are files of their own.
 */
export type MapFile = {
  format: typeof MAP_FILE_FORMAT;
  version: typeof MAP_FILE_VERSION;
  title: string;
  nodes: MapNode[];
};

export const MAP_FILE_FORMAT = "mind-graph-map";
export const MAP_FILE_VERSION = 1;
export const MAX_IMPORT_NODES = 2000;
/** Files larger than this can't hold a map within the node and label limits. */
export const MAX_MAP_FILE_BYTES = 5 * 1024 * 1024;

/**
 * The file contents for a map: its tree in order, then its floating nodes.
 * Nodes that can't reach the root are saved as floating, as the editor shows
 * them, so the file can always be imported.
 */
export function toMapFile(title: string, nodes: MapNode[]): MapFile {
  const children = new Map<string, MapNode[]>();
  for (const node of nodes)
    if (!node.isRoot && node.parentKey !== undefined)
      children.set(node.parentKey, [...(children.get(node.parentKey) ?? []), node]);
  const tree: MapNode[] = [];
  const visit = (node: MapNode) => {
    tree.push(node);
    for (const child of (children.get(node.key) ?? []).sort((a, b) => a.order - b.order))
      visit(child);
  };
  const root = nodes.find((node) => node.isRoot);
  if (root) visit({ ...root, parentKey: undefined });
  const placed = new Set(tree.map((node) => node.key));
  const floating = nodes
    .filter((node) => !placed.has(node.key))
    .map((node) => ({ ...node, parentKey: undefined, isRoot: false }));
  return {
    format: MAP_FILE_FORMAT,
    version: MAP_FILE_VERSION,
    title,
    nodes: [
      ...tree.map(({ key, label, parentKey, order, isRoot }) => ({
        key,
        label,
        ...(parentKey !== undefined && { parentKey }),
        order,
        isRoot,
      })),
      ...floating.map(({ key, label, order, x, y }) => ({
        key,
        label,
        order,
        ...(x !== undefined && { x }),
        ...(y !== undefined && { y }),
        isRoot: false,
      })),
    ],
  };
}

/** Reads a map file's contents, throwing an error that explains what's wrong. */
export function parseMapFile(data: unknown): { title: string; nodes: MapNode[] } {
  if (!isObject(data) || data.format !== MAP_FILE_FORMAT)
    throw new Error("This file isn't a Mind Graph map");
  if (typeof data.version !== "number" || data.version > MAP_FILE_VERSION)
    throw new Error("This map was saved by a newer version of Mind Graph");
  if (typeof data.title !== "string") throw new Error("This map has no title");
  if (!Array.isArray(data.nodes)) throw new Error("This map has no nodes");
  const nodes = data.nodes.map((node): MapNode => {
    if (
      !isObject(node) ||
      typeof node.key !== "string" ||
      typeof node.label !== "string" ||
      !(node.parentKey === undefined || typeof node.parentKey === "string") ||
      typeof node.order !== "number" ||
      !(node.x === undefined || typeof node.x === "number") ||
      !(node.y === undefined || typeof node.y === "number") ||
      typeof node.isRoot !== "boolean"
    )
      throw new Error("This map has a node that can't be read");
    const { key, label, parentKey, order, x, y, isRoot } = node;
    return { key, label, parentKey, order, x, y, isRoot };
  });
  checkNodes(nodes);
  return { title: data.title, nodes };
}

/**
 * Throws unless `nodes` form one tree plus floating nodes: a single root,
 * parents that exist, no cycles, and no children under floating nodes.
 */
export function checkNodes(nodes: MapNode[]) {
  if (nodes.length > MAX_IMPORT_NODES)
    throw new Error(`Maps can have at most ${MAX_IMPORT_NODES} nodes`);
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  if (byKey.size !== nodes.length) throw new Error("This map has two nodes with the same key");
  if (nodes.filter((node) => node.isRoot).length !== 1)
    throw new Error("This map must have exactly one root");
  for (const node of nodes) {
    if (node.label.length > MAX_LABEL_LENGTH)
      throw new Error("This map has a label that's too long");
    if (![node.order, node.x ?? 0, node.y ?? 0].every(Number.isFinite))
      throw new Error("This map has a node that can't be read");
    if (node.isRoot && node.parentKey !== undefined)
      throw new Error("This map's root can't have a parent");
  }
  for (const node of nodes) {
    const seen = new Set<string>();
    let current = node;
    while (!current.isRoot && current.parentKey !== undefined) {
      if (seen.has(current.key)) throw new Error("This map has a cycle");
      seen.add(current.key);
      const parent = byKey.get(current.parentKey);
      if (!parent) throw new Error("This map has a node whose parent is missing");
      if (!parent.isRoot && parent.parentKey === undefined)
        throw new Error("This map has children under a floating node");
      current = parent;
    }
  }
}

/** The same nodes with new keys, so an imported map never shares keys with another. */
export function withNewKeys(nodes: MapNode[]): MapNode[] {
  const keys = new Map(nodes.map((node) => [node.key, crypto.randomUUID()]));
  return nodes.map((node) => ({
    ...node,
    key: keys.get(node.key)!,
    parentKey: node.parentKey === undefined ? undefined : keys.get(node.parentKey),
    // The root sits at the origin, and tree nodes are placed by the layout.
    ...((node.isRoot || node.parentKey !== undefined) && { x: undefined, y: undefined }),
  }));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
