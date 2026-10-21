import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type NodeChange,
} from "@xyflow/react";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ESTIMATED_SIZE, layoutTree } from "../editor/layout";
import { buildTree, type Size, type Tree, type XY } from "../editor/tree";
import { compareMaps, type CompareSummary } from "./compare";
import { CompareNode, type CompareFlowNode } from "./CompareNode";
import { StatusBadge } from "./StatusBadge";
import { STATUS_CLASSES } from "./statusStyle";

const nodeTypes = { compare: CompareNode };
const FLOATING_GAP = 24;
const FLOATING_MIN_ROW = 800;

/**
 * Lays out the tree as usual, but lines floating nodes up in a row below it:
 * missed placeholders make the tree bigger than it was while recalling, so
 * their stored positions could overlap it.
 */
function layoutCompare(tree: Tree, sizeOf: (key: string) => Size | undefined) {
  const positions = layoutTree(tree, sizeOf);
  const size = (key: string) => sizeOf(key) ?? ESTIMATED_SIZE;
  let right = 0;
  let bottom = 0;
  for (const key of tree.depth.keys()) {
    right = Math.max(right, positions.get(key)!.x + size(key).width);
    bottom = Math.max(bottom, positions.get(key)!.y + size(key).height);
  }
  const floating = [...tree.floating].sort(
    (a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0),
  );
  // Rows as wide as the tree, but not too narrow when the tree is small.
  right = Math.max(right, FLOATING_MIN_ROW);
  let x = 0;
  let y = bottom + FLOATING_GAP * 2;
  let rowHeight = 0;
  for (const node of floating) {
    const { width, height } = size(node.key);
    if (x > 0 && x + width > right) {
      x = 0;
      y += rowHeight + FLOATING_GAP;
      rowHeight = 0;
    }
    positions.set(node.key, { x, y } satisfies XY);
    x += width + FLOATING_GAP;
    rowHeight = Math.max(rowHeight, height);
  }
  return positions;
}

type Props = {
  referenceMapId: Id<"maps">;
  resultMapId: Id<"maps">;
  onSummary: (summary: CompareSummary | null) => void;
};

export function CompareView(props: Props) {
  return (
    <ReactFlowProvider>
      <Compare {...props} />
    </ReactFlowProvider>
  );
}

/** Read-only view of a finished recall attempt, marked up against the reference. */
function Compare({ referenceMapId, resultMapId, onSummary }: Props) {
  const reference = useQuery(api.nodes.list, { mapId: referenceMapId });
  const attempt = useQuery(api.nodes.list, { mapId: resultMapId });
  const flow = useReactFlow<CompareFlowNode>();
  const [sizes, setSizes] = useState(() => new Map<string, Size>());
  const [selected, setSelected] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  const result = useMemo(
    () =>
      reference && attempt
        ? compareMaps(
            new Map(reference.map((n) => [n.key, n])),
            new Map(attempt.map((n) => [n.key, n])),
          )
        : null,
    [reference, attempt],
  );
  const { recalled, total, misplaced } = result ?? {};
  useEffect(() => {
    if (recalled === undefined || total === undefined || misplaced === undefined) return;
    onSummary({ recalled, total, misplaced });
    return () => onSummary(null);
  }, [recalled, total, misplaced, onSummary]);

  // Measure with the web font, not a fallback (see MapEditor).
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let active = true;
    document.fonts.ready.then(() => active && setFontsReady(true));
    return () => {
      active = false;
    };
  }, []);

  const tree = useMemo(() => (result ? buildTree(result.nodes) : null), [result]);
  const sizeOf = useCallback((key: string) => sizes.get(key), [sizes]);
  const positions = useMemo(() => (tree ? layoutCompare(tree, sizeOf) : null), [tree, sizeOf]);
  const measured = fontsReady && !!result && [...result.nodes.keys()].every((k) => sizes.has(k));

  // Fit once React Flow has the final positions (a frame after measuring).
  useEffect(() => {
    if (revealed || !measured) return;
    const frame = requestAnimationFrame(() => {
      flow.fitView({ padding: 0.2, maxZoom: 1 }).then(() => setRevealed(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [revealed, measured, flow]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const onNodesChange = useCallback((changes: NodeChange<CompareFlowNode>[]) => {
    setSizes((prev) => {
      let next = prev;
      for (const change of changes) {
        if (change.type !== "dimensions" || !change.dimensions) continue;
        const old = prev.get(change.id);
        const { width, height } = change.dimensions;
        if (old && old.width === width && old.height === height) continue;
        if (next === prev) next = new Map(prev);
        next.set(change.id, { width, height });
      }
      return next;
    });
  }, []);

  if (!result || !tree || !positions) return <div className="flex-1" />;

  const flowNodes: CompareFlowNode[] = [...result.nodes.values()].map((node) => ({
    id: node.key,
    type: "compare",
    position: positions.get(node.key) ?? { x: 0, y: 0 },
    measured: sizes.get(node.key),
    draggable: false,
    selectable: false,
    zIndex: node.key === selected ? 10 : 0,
    data: {
      label: node.label,
      status: node.status,
      note: node.note,
      selected: node.key === selected,
    },
  }));

  const edges: Edge[] = [];
  for (const node of result.nodes.values()) {
    if (!node.parentKey || !tree.depth.has(node.key)) continue;
    edges.push({
      id: node.key,
      source: node.parentKey,
      target: node.key,
      className: node.status === "missed" ? "edge-missed" : undefined,
    });
  }

  return (
    <div className={`compare relative flex-1 ${revealed ? "" : "opacity-0"}`}>
      <ReactFlow<CompareFlowNode>
        nodes={flowNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_e, node) => setSelected(node.id === selected ? null : node.id)}
        onPaneClick={() => setSelected(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        disableKeyboardA11y
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        zoomOnDoubleClick={false}
        nodeClickDistance={3}
        panOnScroll
        minZoom={0.25}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="#cfd2d6" />
      </ReactFlow>
      <Legend />
    </div>
  );
}

const LEGEND: [keyof typeof STATUS_CLASSES, string][] = [
  ["recalled", "Recalled"],
  ["missed", "Missed"],
  ["misplaced", "Wrong parent"],
  ["extra", "Not in reference"],
];

function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-white/85 px-2.5 py-1.5 text-xs text-neutral-600 backdrop-blur-sm">
      {LEGEND.map(([status, label]) => (
        <span key={status} className="flex items-center gap-1.5">
          <span className={`inline-block h-3 w-5 rounded-sm border ${STATUS_CLASSES[status]}`} />
          <StatusBadge status={status} />
          {label}
        </span>
      ))}
      <span className="text-neutral-400">Hover or click marked nodes for details</span>
    </div>
  );
}
