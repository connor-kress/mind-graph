import type { ManualLink } from "../../convex/model";
import { buildTree, type MapNode, type NodeMap, type Tree } from "../editor/tree";

export type CompareStatus =
  | "root"
  | "recalled"
  | "misplaced"
  /** Where a misplaced node belongs. */
  | "belongs"
  | "extra"
  | "missed";

/** Text for a node's note; `{ em }` parts are terms from the maps, shown in italics. */
export type Note = (string | { em: string })[];

/** A node of the compare view: the attempt's nodes plus placeholders for misses. */
export type CompareNode = MapNode & {
  status: CompareStatus;
  note?: Note;
  /** The reference node it matches, or stands in for (placeholders). */
  refKey?: string;
  /** The student's own label, for manual matches (which show the reference's). */
  answer?: string;
  /** For placeholders: the attempt node matched to it, placed elsewhere. */
  placedAt?: string;
};

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
  /** Whether an attempt node sits under the match of a reference node's parent. */
  fitsUnder: (attemptKey: string, refKey: string) => boolean;
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

const slotPrefix = "ref:";

/**
 * Compares a recall attempt against the reference map. Only the trees count:
 * floating nodes are ignored (an attempt's are discarded when it's finished).
 * `links` are matches made by hand, which take priority over matching by label.
 */
export function compareMaps(
  reference: NodeMap,
  attempt: NodeMap,
  links: ManualLink[] = [],
): CompareResult {
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

  // Manual links first. Whether each counts as recalled, by attempt key.
  const manual = new Map<string, boolean>();
  for (const { nodeKey, refKey, correct } of links) {
    const node = attempt.get(nodeKey);
    if (
      !node ||
      node.isRoot ||
      !tryTree.depth.has(nodeKey) ||
      !refTree.depth.has(refKey) ||
      refKey === refTree.root?.key
    ) {
      continue;
    }
    if (toRef.has(nodeKey) || toAttempt.has(refKey)) continue;
    link(nodeKey, refKey);
    manual.set(nodeKey, correct);
  }

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
    if (node.isRoot || !node.parentKey || toRef.has(node.key)) continue;
    const parentRef = toRef.get(node.parentKey);
    const ref = parentRef && candidate(node, (r) => r.parentKey === parentRef);
    if (ref) link(node.key, ref.key);
  }
  // Then by label anywhere. Parents go first, and each node prefers the
  // reference node under its parent's match, so children of a misplaced node
  // pair up with the right duplicates. Nodes that anchor structure (same-parent
  // matches, or nodes with children of their own) claim labels before stray
  // leaves, so a stray copy can't take a label its proper twin needs.
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
  for (const node of tryOrder) matchByLabel(node, false);
  const refLabels = new Set(byLabel.keys());

  /** Whether an attempt node sits under the match of a reference node's parent. */
  const fitsUnder = (attemptKey: string, refKey: string) => {
    const parentKey = attempt.get(attemptKey)?.parentKey;
    return !!parentKey && toRef.get(parentKey) === reference.get(refKey)?.parentKey;
  };
  // Every reference node has one spot in the compare tree: its match, if
  // that's in the right place, or else a placeholder where it belongs. The
  // children of a misplaced node are shown (and graded) at that spot.
  const slotKey = (refKey: string) => {
    const attemptKey = toAttempt.get(refKey);
    const isRoot = refKey === refTree.root?.key;
    return attemptKey && (isRoot || fitsUnder(attemptKey, refKey))
      ? attemptKey
      : slotPrefix + refKey;
  };
  /**
   * An attempt node's label as shown. Matches by label show the reference's
   * spelling. A manual match in place shows the reference's label too (the
   * student's is revealable), while one placed elsewhere keeps the student's.
   */
  const shownLabel = (attemptKey: string) => {
    const node = attempt.get(attemptKey);
    const refKey = toRef.get(attemptKey);
    const ref = refKey ? reference.get(refKey) : undefined;
    if (node?.isRoot || !ref || (manual.has(attemptKey) && !revealable(attemptKey))) {
      return node?.label ?? "";
    }
    return ref.label;
  };
  /** Manual matches in place, whose student label can be revealed. */
  const revealable = (attemptKey: string) => {
    const refKey = toRef.get(attemptKey);
    return manual.has(attemptKey) && !!refKey && slotKey(refKey) === attemptKey;
  };

  const nodes = new Map<string, CompareNode>();
  let misplaced = 0;
  let extra = 0;
  for (const node of tryOrder) {
    const refKey = toRef.get(node.key);
    const ref = refKey ? reference.get(refKey) : undefined;
    const parentRef = node.parentKey ? toRef.get(node.parentKey) : undefined;
    const shown = { ...node, parentKey: parentRef ? slotKey(parentRef) : node.parentKey };
    if (node.isRoot) {
      nodes.set(node.key, { ...shown, status: "root" });
    } else if (!ref) {
      extra++;
      const note = refLabels.has(normalizeLabel(node.label))
        ? ["Repeats a node you already recalled"]
        : ["Not in your reference tree"];
      nodes.set(node.key, { ...shown, status: "extra", note });
    } else {
      const matched = {
        ...shown,
        refKey: ref.key,
        label: shownLabel(node.key),
        ...(revealable(node.key) && { answer: node.label }),
      };
      if (manual.get(node.key) === false) {
        extra++;
        nodes.set(node.key, { ...matched, status: "extra" });
      } else if (fitsUnder(node.key, ref.key)) {
        nodes.set(node.key, { ...matched, status: "recalled" });
      } else {
        misplaced++;
        const parentLabel = ref.parentKey ? reference.get(ref.parentKey)?.label : undefined;
        nodes.set(node.key, {
          ...matched,
          status: "misplaced",
          note: [{ em: ref.label }, " belongs under ", { em: parentLabel ?? "" }],
        });
      }
    }
  }

  // Placeholders where reference nodes belong but nothing (in place) is.
  let missed = 0;
  for (const ref of refOrder) {
    if (ref.isRoot || !ref.parentKey) continue;
    const attemptKey = toAttempt.get(ref.key);
    const recalled = attemptKey !== undefined && manual.get(attemptKey) !== false;
    if (!recalled) missed++;
    const key = slotKey(ref.key);
    if (key === attemptKey) continue;
    const placedUnder = attemptKey && attempt.get(attemptKey)?.parentKey;
    nodes.set(key, {
      key,
      label: ref.label,
      parentKey: slotKey(ref.parentKey),
      // After the attempt's own children.
      order: 1e6 + ref.order,
      isRoot: false,
      refKey: ref.key,
      placedAt: attemptKey,
      status: recalled ? "belongs" : "missed",
      note: placedUnder
        ? ["You placed ", { em: ref.label }, " under ", { em: shownLabel(placedUnder) }]
        : undefined,
    });
  }

  const total = refOrder.length - (refTree.root ? 1 : 0);
  return {
    nodes,
    total,
    recalled: total - missed,
    misplaced,
    missed,
    extra,
    fitsUnder,
  };
}
