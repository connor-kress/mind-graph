import { buildTree, type MapNode, type NodeMap, type Tree } from "../editor/tree";

export type CompareStatus = "root" | "recalled" | "misplaced" | "extra" | "missed";

/** A node of the compare view: the attempt's nodes plus placeholders for misses. */
export type CompareNode = MapNode & { status: CompareStatus; note?: string };

export type CompareSummary = Pick<CompareResult, "recalled" | "total" | "misplaced">;

export type CompareResult = {
  nodes: Map<string, CompareNode>;
  /** Non-root reference tree nodes. */
  total: number;
  /** Reference nodes found in the attempt, including misplaced ones. */
  recalled: number;
  misplaced: number;
  missed: number;
  extra: number;
};

/** Labels match when they're equal ignoring case, accents, spacing, and punctuation. */
export function normalizeLabel(label: string) {
  const lower = label.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const key = lower.replace(/[^\p{L}\p{N}]+/gu, "");
  // Labels made only of symbols keep them, so "?" and "!!" don't match.
  return key || lower.trim();
}

/** Tree nodes from the root down, each after its parent. */
function breadthFirst(tree: Tree): MapNode[] {
  if (!tree.root) return [];
  const order = [tree.root];
  for (let i = 0; i < order.length; i++) {
    order.push(...(tree.children.get(order[i].key) ?? []));
  }
  return order;
}

const missedKey = (referenceKey: string) => `missed:${referenceKey}`;

/**
 * Compares a recall attempt against the reference map. Only the reference's
 * tree counts; its floating nodes are treated as unfinished notes.
 */
export function compareMaps(reference: NodeMap, attempt: NodeMap): CompareResult {
  const refTree = buildTree(reference);
  const tryTree = buildTree(attempt);
  const refOrder = breadthFirst(refTree);
  const tryOrder = breadthFirst(tryTree);

  const toRef = new Map<string, string>(); // attempt key -> reference key
  const toAttempt = new Map<string, string>(); // reference key -> attempt key
  const link = (attemptKey: string, refKey: string) => {
    toRef.set(attemptKey, refKey);
    toAttempt.set(refKey, attemptKey);
  };
  if (refTree.root && tryTree.root) link(tryTree.root.key, refTree.root.key);

  const byLabel = new Map<string, MapNode[]>();
  for (const node of refOrder) {
    if (node.isRoot) continue;
    const label = normalizeLabel(node.label);
    byLabel.set(label, [...(byLabel.get(label) ?? []), node]);
  }
  const candidate = (node: MapNode, accept: (ref: MapNode) => boolean) =>
    byLabel.get(normalizeLabel(node.label))?.find((ref) => !toAttempt.has(ref.key) && accept(ref));

  // First, nodes under the right parent (parents are matched before children),
  // so duplicate labels pair up with the right reference node.
  for (const node of tryOrder) {
    if (node.isRoot || !node.parentKey) continue;
    const parentRef = toRef.get(node.parentKey);
    const ref = parentRef && candidate(node, (r) => r.parentKey === parentRef);
    if (ref) link(node.key, ref.key);
  }
  // Then by label anywhere. Parents go first, and each node prefers the
  // reference node under its parent's match, so children of a misplaced node
  // pair up with the right duplicates. Nodes that anchor structure (same-parent
  // matches, or nodes with children of their own) claim labels before stray
  // leaves, so a stray copy can't take a label its proper twin needs.
  const floating = [...tryTree.floating].sort(
    (a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0),
  );
  const matchByLabel = (node: MapNode, anchorsOnly: boolean) => {
    if (node.isRoot || toRef.has(node.key)) return;
    const parentRef = node.parentKey ? toRef.get(node.parentKey) : undefined;
    const sameParent = parentRef && candidate(node, (r) => r.parentKey === parentRef);
    const hasChildren = (tryTree.children.get(node.key)?.length ?? 0) > 0;
    const ref =
      sameParent || (!anchorsOnly || hasChildren ? candidate(node, () => true) : undefined);
    if (ref) link(node.key, ref.key);
  };
  for (const node of tryOrder) matchByLabel(node, true);
  for (const node of [...tryOrder, ...floating]) matchByLabel(node, false);
  const refLabels = new Set(byLabel.keys());

  const nodes = new Map<string, CompareNode>();
  let misplaced = 0;
  let extra = 0;
  for (const node of attempt.values()) {
    const refKey = toRef.get(node.key);
    const ref = refKey ? reference.get(refKey) : undefined;
    if (node.isRoot) {
      nodes.set(node.key, { ...node, status: "root" });
    } else if (!ref) {
      extra++;
      const note = refLabels.has(normalizeLabel(node.label))
        ? "Repeats a node you already recalled"
        : "Not in your reference tree";
      nodes.set(node.key, { ...node, status: "extra", note });
    } else {
      const inTree = tryTree.depth.has(node.key);
      const parentRef = inTree && node.parentKey ? toRef.get(node.parentKey) : undefined;
      if (parentRef === ref.parentKey) {
        nodes.set(node.key, { ...node, status: "recalled" });
      } else {
        misplaced++;
        const parentLabel = ref.parentKey ? reference.get(ref.parentKey)?.label : undefined;
        nodes.set(node.key, {
          ...node,
          status: "misplaced",
          note: `In your reference, ${ref.label} belongs under ${parentLabel ?? "the root"}`,
        });
      }
    }
  }

  // Where a reference node's children go in the compare view: its match if
  // that's in the tree, its placeholder if it was missed, or else (matched but
  // floating, which can't have children) the nearest such ancestor.
  const displayParent = (refKey: string): string => {
    const attemptKey = toAttempt.get(refKey);
    if (!attemptKey) return missedKey(refKey);
    if (tryTree.depth.has(attemptKey)) return attemptKey;
    const parentKey = reference.get(refKey)?.parentKey;
    return parentKey ? displayParent(parentKey) : attemptKey;
  };

  // Placeholders for missed nodes, under wherever their parent ended up.
  let missed = 0;
  for (const ref of refOrder) {
    if (ref.isRoot || toAttempt.has(ref.key) || !ref.parentKey) continue;
    missed++;
    const parentKey = displayParent(ref.parentKey);
    const shownUnderParent =
      parentKey === (toAttempt.get(ref.parentKey) ?? missedKey(ref.parentKey));
    nodes.set(missedKey(ref.key), {
      key: missedKey(ref.key),
      label: ref.label,
      parentKey,
      // After the attempt's own children.
      order: 1e6 + ref.order,
      isRoot: false,
      status: "missed",
      note: shownUnderParent
        ? undefined
        : `Belongs under ${reference.get(ref.parentKey)?.label ?? "the root"}`,
    });
  }

  const total = refOrder.length - (refTree.root ? 1 : 0);
  return { nodes, total, recalled: total - missed, misplaced, missed, extra };
}
