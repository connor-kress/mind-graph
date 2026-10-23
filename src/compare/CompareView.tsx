import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type NodeChange,
  type OnNodeDrag,
} from "@xyflow/react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ESTIMATED_SIZE, layoutTree } from "../editor/layout";
import { buildTree, type Size, type XY } from "../editor/tree";
import type { ManualLink } from "../../convex/model";
import {
  compareMaps,
  type CompareNode as ComparedNode,
  type CompareStatus,
  type CompareSummary,
} from "./compare";
import { CompareNode, type CompareFlowNode } from "./CompareNode";
import { LinkMenu } from "./LinkMenu";
import { StatusBadge } from "./StatusBadge";
import { STATUS_CLASSES } from "./statusStyle";

const nodeTypes = { compare: CompareNode };

function clientPoint(e: MouseEvent | TouchEvent): XY {
  const point = "changedTouches" in e ? e.changedTouches[0] : e;
  return { x: point.clientX, y: point.clientY };
}

/** A red node being dragged, and the missed node under the pointer. */
type Drag = { key: string; position: XY; target: string | null };
/** A red node dropped onto a missed one, waiting for the menu. */
type Pending = { nodeKey: string; targetKey: string };

type Props = {
  referenceMapId: Id<"maps">;
  resultMapId: Id<"maps">;
  onSummary: (summary: CompareSummary | null) => void;
  onError: (message: string) => void;
};

export function CompareView(props: Props) {
  return (
    <ReactFlowProvider>
      <Compare {...props} />
    </ReactFlowProvider>
  );
}

/** Read-only view of a finished recall attempt, marked up against the reference. */
function Compare({ referenceMapId, resultMapId, onSummary, onError }: Props) {
  const reference = useQuery(api.nodes.list, { mapId: referenceMapId });
  const attempt = useQuery(api.nodes.list, { mapId: resultMapId });
  const links = useQuery(api.links.list, { mapId: resultMapId });
  const saveLinks = useMutation(api.links.set);
  const setLinks = useMemo(
    () =>
      saveLinks.withOptimisticUpdate((store, args) =>
        store.setQuery(api.links.list, { mapId: args.mapId }, args.links),
      ),
    [saveLinks],
  );
  const flow = useReactFlow<CompareFlowNode>();
  const [sizes, setSizes] = useState(() => new Map<string, Size>());
  const [selected, setSelected] = useState<string | null>(null);
  const [fitted, setFitted] = useState(false);
  /** The manual match showing the student's own label instead of the reference's. */
  const [answerShown, setAnswerShown] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  /** Earlier link lists, for undo. */
  const history = useRef<ManualLink[][]>([]);

  const result = useMemo(
    () =>
      reference && attempt && links
        ? compareMaps(
            new Map(reference.map((n) => [n.key, n])),
            new Map(attempt.map((n) => [n.key, n])),
            links,
          )
        : null,
    [reference, attempt, links],
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
  const positions = useMemo(() => (tree ? layoutTree(tree, sizeOf) : null), [tree, sizeOf]);
  const measured = fontsReady && !!result && [...result.nodes.keys()].every((k) => sizes.has(k));

  // Fit once React Flow has the final positions (a frame after measuring).
  useEffect(() => {
    if (fitted || !measured) return;
    const frame = requestAnimationFrame(() => {
      flow.fitView({ padding: 0.2, maxZoom: 1 }).then(() => setFitted(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [fitted, measured, flow]);

  /**
   * Saves a new link list. `undoTo` is the list to restore on undo; it's
   * recorded as an undo step, unless this is an undo itself (`isUndo`), in
   * which case a failed save puts it back.
   */
  const changeLinks = useCallback(
    (next: ManualLink[], undoTo: ManualLink[], isUndo = false) => {
      if (!isUndo) history.current.push(undoTo);
      setAnswerShown(null);
      setLinks({ mapId: resultMapId, links: next }).catch((e) => {
        console.error(e);
        if (isUndo) history.current.push(next);
        else if (history.current.at(-1) === undoTo) history.current.pop();
        onError(
          e instanceof ConvexError ? String(e.data) : "Couldn't save your change to the comparison",
        );
      });
    },
    [setLinks, resultMapId, onError],
  );

  // The menu handles its own keys, and links shouldn't change mid-drag.
  const busy = pending !== null || drag !== null;
  useEffect(() => {
    if (busy) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
      // The printed letter, falling back to the physical key on non-Latin layouts.
      const letter = /^[a-z]$/i.test(e.key)
        ? e.key.toLowerCase()
        : e.code.replace(/^Key/, "").toLowerCase();
      if (letter === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        if (!history.current.length) return;
        e.preventDefault();
        if (!e.repeat) {
          const previous = history.current.pop()!;
          changeLinks(previous, previous, true);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [changeLinks, busy]);

  const onNodesChange = useCallback((changes: NodeChange<CompareFlowNode>[]) => {
    for (const change of changes) {
      if (change.type !== "position" || !change.position || !change.dragging) continue;
      const { id, position } = change;
      setDrag((prev) => ({ key: id, position, target: prev?.key === id ? prev.target : null }));
    }
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

  const sizeOrEstimate = (key: string) => sizes.get(key) ?? ESTIMATED_SIZE;
  /** The missed node under a point, which a red node can be dropped onto. */
  const missedAt = (point: XY) => {
    if (!result || !positions) return null;
    for (const node of result.nodes.values()) {
      const pos = positions.get(node.key);
      if (!linkable(node.status) || !pos) continue;
      const { width, height } = sizeOrEstimate(node.key);
      const inside =
        point.x >= pos.x &&
        point.x <= pos.x + width &&
        point.y >= pos.y &&
        point.y <= pos.y + height;
      if (inside) return node.key;
    }
    return null;
  };
  // The dragged node's position comes from onNodesChange; these find the target.
  const onNodeDrag: OnNodeDrag<CompareFlowNode> = (e) => {
    const target = missedAt(flow.screenToFlowPosition(clientPoint(e)));
    setDrag((prev) => prev && { ...prev, target });
  };
  const onNodeDragStop: OnNodeDrag<CompareFlowNode> = (e, node) => {
    const target = missedAt(flow.screenToFlowPosition(clientPoint(e)));
    // The node goes back while the menu is open, so the target stays visible.
    setDrag(null);
    if (target && drag) setPending({ nodeKey: node.id, targetKey: target });
  };
  const closeMenu = () => {
    setPending(null);
    setDrag(null);
  };
  const chooseLink = (correct: boolean) => {
    const target = pending && result?.nodes.get(pending.targetKey);
    const refKey = target && linkable(target.status) ? target.refKey : undefined;
    const unchanged = links?.some(
      (l) => l.nodeKey === pending?.nodeKey && l.refKey === refKey && l.correct === correct,
    );
    if (pending && links && refKey && !unchanged) {
      changeLinks(
        [
          ...links.filter((l) => l.nodeKey !== pending.nodeKey && l.refKey !== refKey),
          { nodeKey: pending.nodeKey, refKey, correct },
        ],
        links,
      );
    }
    closeMenu();
  };

  /** Selects a node, panning to it if it's out of view. */
  const showNode = (key: string, container: Element | null) => {
    setSelected(key);
    const pos = positions?.get(key);
    if (!pos || !container) return;
    const size = sizeOrEstimate(key);
    const box = container.getBoundingClientRect();
    const topLeft = flow.flowToScreenPosition(pos);
    const bottomRight = flow.flowToScreenPosition({
      x: pos.x + size.width,
      y: pos.y + size.height,
    });
    const inView =
      topLeft.x >= box.left &&
      topLeft.y >= box.top &&
      bottomRight.x <= box.right &&
      bottomRight.y <= box.bottom;
    if (inView) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    flow.setCenter(pos.x + size.width / 2, pos.y + size.height / 2, {
      zoom: flow.getZoom(),
      duration: reduceMotion ? 0 : 300,
    });
  };

  if (!result || !tree || !positions) return <div className="flex-1" />;

  // Drop a drag or menu whose nodes changed under it (e.g. an edit elsewhere).
  const draggedNode = drag && result.nodes.get(drag.key);
  if (drag && !(draggedNode && draggable(draggedNode))) setDrag(null);
  const pendingTarget = pending && result.nodes.get(pending.targetKey);
  const pendingDragged = pending && result.nodes.get(pending.nodeKey);
  if (
    pending &&
    (!pendingTarget ||
      !linkable(pendingTarget.status) ||
      !pendingDragged ||
      !draggable(pendingDragged))
  ) {
    closeMenu();
  }

  const flowNodes: CompareFlowNode[] = [...result.nodes.values()].map((node) => {
    const dragging = drag?.key === node.key;
    return {
      id: node.key,
      type: "compare",
      position: dragging ? drag.position : (positions.get(node.key) ?? { x: 0, y: 0 }),
      measured: sizes.get(node.key),
      // Red (and linked) nodes can be dropped onto missed ones to link them.
      draggable: draggable(node) && !pending,
      selectable: false,
      zIndex: dragging ? 1000 : node.key === selected ? 10 : 0,
      data: {
        label: node.label,
        status: node.status,
        note: node.note,
        answer: node.answer,
        linked: node.placedAt !== undefined,
        revealed: node.key === answerShown && node.answer !== undefined,
        selected: node.key === selected,
        dropTarget: node.key === (drag?.target ?? pending?.targetKey),
        dragging,
      },
    };
  });

  const edges: Edge[] = [];
  for (const node of result.nodes.values()) {
    if (!node.parentKey || !tree.depth.has(node.key)) continue;
    edges.push({
      id: node.key,
      source: node.parentKey,
      target: node.key,
      className: ["missed", "belongs", "intended"].includes(node.status)
        ? "edge-missed"
        : undefined,
    });
  }

  let menu = null;
  const pendingNode = pending && result.nodes.get(pending.nodeKey);
  const targetNode = pending && result.nodes.get(pending.targetKey);
  const targetPos = pending && positions.get(pending.targetKey);
  if (pending && pendingNode && targetNode?.refKey && targetPos) {
    const size = sizeOrEstimate(pending.targetKey);
    menu = (
      <LinkMenu
        anchor={flow.flowToScreenPosition({
          x: targetPos.x + size.width / 2,
          y: targetPos.y + size.height,
        })}
        answer={pendingNode.answer ?? pendingNode.label}
        target={targetNode.label}
        misplaced={!result.fitsUnder(pending.nodeKey, targetNode.refKey)}
        onChoose={chooseLink}
        onCancel={closeMenu}
      />
    );
  }

  return (
    <div
      className={`compare relative flex-1 ${fitted ? "" : "opacity-0"}`}
      onPointerDownCapture={(e) => {
        // A click outside the menu dismisses it.
        if (pending && !(e.target as Element).closest("[role=dialog]")) closeMenu();
      }}
    >
      <ReactFlow<CompareFlowNode>
        nodes={flowNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(e, node) => {
          const placedAt = result.nodes.get(node.id)?.placedAt;
          if (node.data.answer !== undefined) {
            // Manual matches toggle between the reference's label and the student's.
            setAnswerShown(node.id === answerShown ? null : node.id);
          } else if (placedAt) {
            // A placeholder for a node placed elsewhere leads to that node.
            showNode(placedAt, (e.target as Element).closest(".react-flow"));
          } else {
            setSelected(node.id === selected ? null : node.id);
          }
        }}
        onNodeMouseLeave={(_e, node) => {
          if (node.id === answerShown) setAnswerShown(null);
        }}
        onMoveStart={() => pending && closeMenu()}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
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
      {menu}
      <Legend />
    </div>
  );
}

/** Red nodes, and ones linked by hand (to change their link), can be dragged. */
const draggable = (node: ComparedNode) => node.status === "extra" || !!node.manual;

/** Missed reference nodes, which red nodes can be linked to (replacing any link). */
const linkable = (status: CompareStatus) => status === "missed" || status === "intended";

const LEGEND: [keyof typeof STATUS_CLASSES, string][] = [
  ["recalled", "Recalled"],
  ["missed", "Missed"],
  ["misplaced", "Wrong parent"],
  ["belongs", "Where it belongs"],
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
      <span className="text-neutral-400">
        Drag red nodes onto their intended node · Ctrl z to undo
      </span>
    </div>
  );
}
