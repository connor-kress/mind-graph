import type { MapNode, Size, Tree, XY } from "./tree";

const COLUMN_GAP = 72;
const LEAF_GAP = 14;
const BRANCH_GAP = 30;
export const ESTIMATED_SIZE: Size = { width: 140, height: 40 };

/**
 * Computes top-left positions for every node in the tree, with the root's
 * left-center edge at (0, 0). Nodes at the same depth share a column, and each
 * parent is centered on the block occupied by its subtree. Floating nodes keep
 * their stored positions.
 */
export function layoutTree(tree: Tree, sizeOf: (key: string) => Size | undefined): Map<string, XY> {
  const positions = new Map<string, XY>();
  const size = (key: string) => sizeOf(key) ?? ESTIMATED_SIZE;

  for (const node of tree.floating) {
    positions.set(node.key, { x: node.x ?? 0, y: node.y ?? 120 });
  }
  const { root } = tree;
  if (!root) return positions;

  const columnWidth: number[] = [];
  for (const [key, depth] of tree.depth) {
    columnWidth[depth] = Math.max(columnWidth[depth] ?? 0, size(key).width);
  }
  const columnX: number[] = [0];
  for (let d = 1; d < columnWidth.length; d++) {
    columnX[d] = columnX[d - 1] + columnWidth[d - 1] + COLUMN_GAP;
  }

  const kids = (key: string) => tree.children.get(key) ?? [];
  const gapBetween = (a: MapNode, b: MapNode) =>
    kids(a.key).length || kids(b.key).length ? BRANCH_GAP : LEAF_GAP;

  const blockHeight = new Map<string, number>();
  const measure = (node: MapNode): number => {
    const children = kids(node.key);
    let total = 0;
    children.forEach((child, i) => {
      total += measure(child) + (i > 0 ? gapBetween(children[i - 1], child) : 0);
    });
    const height = Math.max(size(node.key).height, total);
    blockHeight.set(node.key, height);
    return height;
  };

  const place = (node: MapNode, depth: number, top: number) => {
    const block = blockHeight.get(node.key)!;
    const { height } = size(node.key);
    const centerY = top + block / 2;
    positions.set(node.key, { x: columnX[depth], y: centerY - height / 2 });

    const children = kids(node.key);
    let total = 0;
    children.forEach((child, i) => {
      total += blockHeight.get(child.key)! + (i > 0 ? gapBetween(children[i - 1], child) : 0);
    });
    let y = centerY - total / 2;
    children.forEach((child, i) => {
      if (i > 0) y += gapBetween(children[i - 1], child);
      place(child, depth + 1, y);
      y += blockHeight.get(child.key)!;
    });
  };

  const rootBlock = measure(root);
  place(root, 0, -rootBlock / 2);
  return positions;
}
