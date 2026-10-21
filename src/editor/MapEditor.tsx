import {
  Background,
  BackgroundVariant,
  getBezierPath,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  ViewportPortal,
  type Edge,
  type NodeChange,
  type OnConnectEnd,
  type OnConnectStart,
  type OnNodeDrag,
} from "@xyflow/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { BranchLine } from "./BranchLine";
import { EditorContext, type EditorActions, type EditorContextValue } from "./EditorContext";
import { ESTIMATED_SIZE, layoutTree } from "./layout";
import { MindNode, type Caret, type MindFlowNode } from "./MindNode";
import { menuItems, type MenuItem } from "./menu";
import { NodeMenu } from "./NodeMenu";
import { isTextInput } from "./isTextInput";
import { ShortcutHints } from "./ShortcutHints";
import {
  buildTree,
  descendants,
  newKey,
  placeAmongSiblings,
  type Change,
  type MapNode,
  type Size,
  type XY,
} from "./tree";
import { useAnimatedPositions } from "./useAnimatedPositions";
import { useMapDoc } from "./useMapDoc";

const GRID = 20;
const nodeTypes = { mind: MindNode };

type Drag = {
  key: string;
  keys: Set<string>;
  start: Map<string, XY>;
  delta: XY;
  target: string | null;
};

type Menu = { key: string; x: number; y: number; withRename: boolean; active: number };

const snap = (v: number) => Math.round(v / GRID) * GRID;

/** The pointer position of a mouse or touch event. */
function clientPoint(e: MouseEvent | TouchEvent | React.MouseEvent) {
  return "changedTouches" in e ? e.changedTouches[0] : e;
}

/** Vim mode's keys for each arrow key. */
const VIM_KEYS: Record<string, string> = {
  h: "ArrowLeft",
  j: "ArrowDown",
  k: "ArrowUp",
  l: "ArrowRight",
};

/** Vim mode's keys for editing a label: i retypes it, I and A edit at either end, S clears it. */
const VIM_EDIT_KEYS: Record<string, Caret> = { i: "all" };
const VIM_SHIFT_EDIT_KEYS: Record<string, Caret> = { i: "start", a: "end", s: "clear" };

type Props = {
  mapId: Id<"maps">;
  /** Navigate with h, j, k, and l instead of the arrow keys, and edit with i. */
  vim: boolean;
};

export function MapEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  );
}

function Editor({ mapId, vim }: Props) {
  const { nodes, apply, undo, redo, saveError, dismissError } = useMapDoc(mapId);
  const flow = useReactFlow<MindFlowNode>();
  const wrapper = useRef<HTMLDivElement>(null);
  // Whether the latest pointerdown landed in the canvas.
  const pointerDownInCanvas = useRef(false);
  useEffect(() => {
    const reset = () => (pointerDownInCanvas.current = false);
    window.addEventListener("pointerdown", reset, true);
    return () => window.removeEventListener("pointerdown", reset, true);
  }, []);

  const [sizes, setSizes] = useState(() => new Map<string, Size>());
  const [selected, setSelected] = useState<string | null>(null);
  const [editingState, setEditing] = useState<string | null>(null);
  const [caret, setCaret] = useState<Caret>("all");
  const startEditing = (key: string, at: Caret = "all") => {
    setCaret(at);
    setEditing(key);
  };
  const [draft, setDraft] = useState<MapNode | null>(null);
  const [linkingState, setLinkingState] = useState<string | null>(null);
  const [branching, setBranchingState] = useState<string | null>(null);
  const branchingRef = useRef<string | null>(null);
  const setBranching = (next: string | null) => {
    branchingRef.current = next;
    setBranchingState(next);
  };
  const [pointer, setPointer] = useState<XY | null>(null);
  // Drag state is mirrored in refs because React Flow can fire start, move,
  // and stop handlers in quick succession, before a re-render.
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDragState(next);
  };
  const [menuState, setMenu] = useState<Menu | null>(null);
  const [grid, setGrid] = useState(false);

  // Nodes plus the draft being typed (which isn't saved until committed).
  const allNodes = useMemo(() => {
    const map = new Map(nodes);
    if (draft && !map.has(draft.key)) map.set(draft.key, draft);
    return map;
  }, [nodes, draft]);
  const tree = useMemo(() => buildTree(allNodes), [allNodes]);
  const sizeOf = useCallback((key: string) => sizes.get(key), [sizes]);
  const targets = useMemo(() => layoutTree(tree, sizeOf), [tree, sizeOf]);

  // UI state can refer to nodes that have since disappeared (deleted in
  // another tab, undone, ...), so only trust keys that still exist.
  const existing = (key: string | null) => (key && allNodes.has(key) ? key : null);
  const selectedKey = existing(selected);
  const selectedNode = selectedKey ? allNodes.get(selectedKey) : undefined;
  const editing = existing(editingState);
  const linking = existing(linkingState);
  const setLinking = (key: string | null) => {
    setLinkingState(key);
    setPointer(null);
  };
  /** Unconnected to the root: placed freely and can't have children. */
  const isLoose = (key: string) => !tree.depth.has(key);

  const menuNode = menuState ? allNodes.get(menuState.key) : undefined;
  const menuChildCount = menuState ? (tree.children.get(menuState.key)?.length ?? 0) : 0;
  const menuEntries =
    menuState && menuNode
      ? menuItems(menuChildCount, menuNode.isRoot, menuState.withRename, vim)
      : [];
  const menu =
    menuState && menuEntries.length
      ? { ...menuState, active: Math.min(menuState.active, menuEntries.length - 1) }
      : null;
  // Forget state for nodes that disappeared, so it can't come back to life if
  // the node reappears (e.g. another tab undoes its deletion).
  const staleEditing = editingState !== null && !editing;
  const staleLinking = linkingState !== null && !linking;
  const staleMenu = menuState !== null && !menu;
  if (staleEditing) setEditing(null);
  if (staleLinking) setLinkingState(null);
  if (staleMenu) setMenu(null);

  // Lay out without animation until every node has been measured once.
  // Wait for the web font too, so nodes aren't measured with a fallback font.
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let active = true;
    document.fonts.ready.then(() => active && setFontsReady(true));
    return () => {
      active = false;
    };
  }, []);
  const settled = useRef(false);
  if (!settled.current && fontsReady && nodes && [...nodes.keys()].every((k) => sizes.has(k))) {
    settled.current = true;
  }
  const spawnHints = useRef(new Map<string, XY>());
  const positionsRef = useRef<Map<string, XY>>(new Map());
  const spawnAt = (key: string) => {
    const hint = spawnHints.current.get(key);
    spawnHints.current.delete(key);
    if (hint) return hint;
    const parentKey = allNodes.get(key)?.parentKey;
    return parentKey ? positionsRef.current.get(parentKey) : undefined;
  };
  const reducedMotion = useMemo(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const { positions, jump } = useAnimatedPositions(targets, {
    instant: !settled.current || reducedMotion,
    spawnAt,
  });
  positionsRef.current = positions;

  // If a child draft's parent is deleted elsewhere while typing, keep the
  // draft where it is (as a floating node) rather than at the default spot.
  if (draft?.parentKey && draft.x === undefined && isLoose(draft.key)) {
    const pos = positions.get(draft.key);
    if (pos) setDraft({ ...draft, parentKey: undefined, x: pos.x, y: pos.y });
  }

  const displayed = (key: string): XY => {
    if (drag?.keys.has(key)) {
      const start = drag.start.get(key)!;
      return { x: start.x + drag.delta.x, y: start.y + drag.delta.y };
    }
    return positions.get(key) ?? targets.get(key) ?? { x: 0, y: 0 };
  };
  const sizeOrEstimate = (key: string) => sizes.get(key) ?? ESTIMATED_SIZE;

  /** The topmost node under a point (in flow coordinates) that passes `filter`. */
  const nodeAt = (point: XY, filter: (node: MapNode) => boolean) => {
    let hit: MapNode | undefined;
    for (const node of allNodes.values()) {
      if (!filter(node)) continue;
      const { x, y } = displayed(node.key);
      const { width, height } = sizeOrEstimate(node.key);
      if (point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height) {
        if (!hit || isLoose(node.key)) hit = node;
      }
    }
    return hit;
  };

  const canParent = (node: MapNode) => tree.depth.has(node.key) && node.key !== draft?.key;

  // Fit the map once it has been measured, before revealing it.
  const [revealed, setRevealed] = useState(false);
  useLayoutEffect(() => {
    if (revealed || !settled.current) return;
    flow.fitView({ padding: 0.2, maxZoom: 1 }).then(() => setRevealed(true));
  });

  // ---- Edits -------------------------------------------------------------

  const attach = (key: string, parentKey: string) => {
    const node = allNodes.get(key);
    if (!node || node.parentKey === parentKey || key === parentKey) return;
    const index = tree.children.get(parentKey)?.length ?? 0;
    apply({ upserts: placeAmongSiblings(tree, parentKey, [node], index), removes: [] }, key);
  };

  // Where the selection goes back to if the draft is left empty.
  const draftFrom = useRef<string | null>(null);
  const startChildDraft = (parentKey: string, index?: number, spawn?: XY, from = parentKey) => {
    draftFrom.current = from;
    const siblings = (tree.children.get(parentKey) ?? []).filter((n) => n.key !== draft?.key);
    const i = index ?? siblings.length;
    const before = siblings[i - 1]?.order ?? (siblings[i] ? siblings[i].order - 1 : -1);
    const after = siblings[i]?.order ?? before + 2;
    const key = newKey();
    if (spawn) spawnHints.current.set(key, spawn);
    setDraft({ key, label: "", parentKey, order: (before + after) / 2, isRoot: false });
    startEditing(key);
    setSelected(key);
    setLinking(null);
  };

  const startFloatingDraft = (at: XY) => {
    const key = newKey();
    const x = grid ? snap(at.x - 20) : at.x - 20;
    const y = grid ? snap(at.y - 18) : at.y - 18;
    draftFrom.current = null;
    setDraft({ key, label: "", order: 0, isRoot: false, x, y });
    startEditing(key);
    setSelected(key);
    setLinking(null);
  };

  /** Starts a sibling below the node, or above it. The root gets a last (or first) child. */
  const addSibling = (key: string, above = false) => {
    const node = allNodes.get(key);
    if (!node) return;
    if (node.isRoot) return startChildDraft(key, above ? 0 : undefined);
    if (!node.parentKey || !tree.depth.has(key)) return;
    const siblings = tree.children.get(node.parentKey) ?? [];
    const index = siblings.findIndex((n) => n.key === key) + (above ? 0 : 1);
    startChildDraft(node.parentKey, index, undefined, key);
  };

  const remove = (key: string, mode: MenuItem["id"]) => {
    setMenu(null);
    const node = allNodes.get(key);
    if (!node || node.isRoot) return;
    const kids = tree.children.get(key) ?? [];
    const parentKey = node.parentKey;
    const siblings = parentKey ? (tree.children.get(parentKey) ?? []) : [];
    const index = siblings.findIndex((n) => n.key === key);
    let change: Change;
    let next: string | null = parentKey ?? null;

    if (kids.length === 0 || mode === "delete") {
      change = { upserts: [], removes: [key] };
      next = siblings[index + 1]?.key ?? siblings[index - 1]?.key ?? parentKey ?? null;
    } else if (mode === "relink" && parentKey) {
      const upserts = placeAmongSiblings(tree, parentKey, kids, index).filter((n) => n.key !== key);
      change = { upserts, removes: [key] };
      next = kids[0].key;
    } else if (mode === "withChildren") {
      change = { upserts: [], removes: [key, ...descendants(tree, key).map((n) => n.key)] };
    } else {
      // Leave every descendant floating where it currently is.
      const upserts = descendants(tree, key).map((n) => {
        const { x, y } = displayed(n.key);
        return { ...n, parentKey: undefined, order: 0, x, y };
      });
      change = { upserts, removes: [key] };
    }
    apply(change, key);
    setSelected(next);
  };

  const requestDelete = (key: string, e?: { shiftKey: boolean; altKey: boolean }) => {
    const node = allNodes.get(key);
    if (!node || node.isRoot) return;
    const kids = tree.children.get(key) ?? [];
    if (kids.length === 0) return remove(key, "delete");
    if (e?.shiftKey) return remove(key, "withChildren");
    if (e?.altKey) return remove(key, "floating");
    openMenuBelow(key);
  };

  // Below the node, so the children it affects stay visible.
  const openMenuBelow = (key: string) => {
    const rect = wrapper.current?.getBoundingClientRect();
    if (!rect) return;
    const pos = displayed(key);
    const screen = flow.flowToScreenPosition({ x: pos.x, y: pos.y + sizeOrEstimate(key).height });
    setMenu({
      key,
      x: screen.x - rect.left,
      y: screen.y - rect.top + 8,
      withRename: false,
      active: 0,
    });
  };

  const chooseMenuItem = (item: MenuItem) => {
    if (!menu) return;
    if (item.id === "rename") {
      setMenu(null);
      setSelected(menu.key);
      startEditing(menu.key);
    } else {
      remove(menu.key, item.id);
    }
  };

  const reselectAfterHistory = (key: string | undefined) => {
    if (key) setSelected(key);
    setLinking(null);
    setEditing(null);
    setDraft(null);
    setMenu(null);
  };

  // ---- Label editing ------------------------------------------------------

  const actions: EditorActions = {
    commitEdit: (key, value, via) => {
      const label = value.trim();
      setEditing(null);
      if (draft && key === draft.key) {
        setDraft(null);
        if (!label) {
          setSelected(draftFrom.current);
          return;
        }
        const node = { ...draft, label };
        if (draft.parentKey && tree.depth.has(draft.parentKey)) {
          const siblings = tree.children.get(draft.parentKey) ?? [];
          const index = siblings.findIndex((n) => n.key === key);
          apply(
            { upserts: placeAmongSiblings(tree, draft.parentKey, [node], index), removes: [] },
            key,
          );
          setSelected(key);
          if (via === "tab") startChildDraft(key, 0);
        } else {
          // Click-placed (or its parent was deleted elsewhere while typing).
          const { x, y } = displayed(key);
          apply({ upserts: [{ ...node, parentKey: undefined, x, y }], removes: [] }, key);
          setSelected(key);
          // Next, click a parent to connect it. Esc (or clicking empty canvas)
          // leaves it floating. Not when focus left the canvas, e.g. to select
          // text in the notes.
          if (via !== "blur" || pointerDownInCanvas.current) setLinking(key);
        }
        return;
      }
      const node = nodes?.get(key);
      if (!node) return;
      // Emptying a label deletes the node, moving its children up (not the root's).
      if (!label) return remove(key, "relink");
      if (label !== node.label) {
        apply({ upserts: [{ ...node, label }], removes: [] }, key);
      }
      if (via === "tab" && tree.depth.has(key)) startChildDraft(key);
    },
  };
  // Nodes get a stable object that forwards to the latest actions.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const stableActions = useMemo<EditorActions>(
    () => ({
      commitEdit: (...args) => actionsRef.current.commitEdit(...args),
    }),
    [],
  );

  // ---- Keyboard -----------------------------------------------------------

  // The child last selected (or holding the selection) under each node, so
  // ArrowRight retraces the way back after ArrowLeft.
  const lastChild = useRef(new Map<string, string>());
  useEffect(() => {
    let key = selectedKey;
    while (key && tree.depth.has(key)) {
      const parentKey = allNodes.get(key)?.parentKey;
      if (!parentKey) break;
      lastChild.current.set(parentKey, key);
      key = parentKey;
    }
  }, [selectedKey, allNodes, tree]);

  const navigate = (key: string, direction: string) => {
    const node = allNodes.get(key);
    if (!node || !tree.depth.has(key)) return;
    const center = (k: string) => {
      const pos = targets.get(k) ?? { x: 0, y: 0 };
      return pos.y + sizeOrEstimate(k).height / 2;
    };
    if (direction === "ArrowLeft") {
      if (node.parentKey) setSelected(node.parentKey);
    } else if (direction === "ArrowRight") {
      const kids = tree.children.get(key) ?? [];
      // Past the end of a branch, start a child.
      if (kids.length === 0) return startChildDraft(key);
      const last = lastChild.current.get(key);
      if (last && kids.some((kid) => kid.key === last)) {
        setSelected(last);
        return;
      }
      const y = center(key);
      const closest = kids.reduce<MapNode | undefined>(
        (best, kid) =>
          !best || Math.abs(center(kid.key) - y) < Math.abs(center(best.key) - y) ? kid : best,
        undefined,
      );
      if (closest) setSelected(closest.key);
    } else {
      const depth = tree.depth.get(key);
      const row = [...tree.depth]
        .filter(([, d]) => d === depth)
        .map(([k]) => k)
        .sort((a, b) => center(a) - center(b));
      const next = row[row.indexOf(key) + (direction === "ArrowUp" ? -1 : 1)];
      if (next) setSelected(next);
    }
  };

  const reorder = (key: string, offset: number) => {
    const node = allNodes.get(key);
    if (!node?.parentKey || !tree.depth.has(key)) return;
    const siblings = tree.children.get(node.parentKey) ?? [];
    const index = siblings.findIndex((n) => n.key === key) + offset;
    if (index < 0 || index >= siblings.length) return;
    apply({ upserts: placeAmongSiblings(tree, node.parentKey, [node], index), removes: [] }, key);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (isTextInput(e.target) || editing) return;
    // Let focused controls outside the canvas (e.g. the mode buttons) work.
    if (e.target instanceof HTMLElement && e.target.closest("button, a")) return;
    const mod = e.metaKey || e.ctrlKey;
    // The printed letter, falling back to the physical key on non-Latin layouts.
    const letter = /^[a-z]$/i.test(e.key)
      ? e.key.toLowerCase()
      : e.code.replace(/^Key/, "").toLowerCase();
    if (mod && (letter === "z" || letter === "y")) {
      e.preventDefault();
      reselectAfterHistory(letter === "y" || e.shiftKey ? redo() : undo());
      return;
    }
    // Vim mode also undoes with u and redoes with Ctrl+R, while a node is
    // selected (otherwise Ctrl+R reloads the page as usual).
    if (vim && selectedNode && !e.altKey && !e.shiftKey && !e.metaKey && letter === (e.ctrlKey ? "r" : "u")) {
      e.preventDefault();
      reselectAfterHistory(e.ctrlKey ? redo() : undo());
      return;
    }
    // Holding a key down shouldn't spawn, delete, or pick a stream of things.
    // Vim mode deletes with d rather than Delete or Backspace.
    const isDeleteKey = vim ? letter === "d" : e.key === "Delete" || e.key === "Backspace";
    if (e.repeat && (isDeleteKey || ["Tab", "Enter"].includes(e.key))) {
      e.preventDefault();
      return;
    }
    if (mod) return;
    // The arrow key pressed, or its stand-in in vim mode.
    const arrow = vim ? !e.shiftKey && VIM_KEYS[letter] : e.key.startsWith("Arrow") && e.key;

    if (menu) {
      const items = menuEntries;
      e.preventDefault();
      if (e.key === "Escape") setMenu(null);
      else if (arrow === "ArrowDown" || arrow === "ArrowUp") {
        const step = arrow === "ArrowDown" ? 1 : -1;
        setMenu({ ...menu, active: (menu.active + step + items.length) % items.length });
      } else if (e.key === "Enter" && items[menu.active]) chooseMenuItem(items[menu.active]);
      else if (isDeleteKey) {
        remove(menu.key, e.shiftKey ? "withChildren" : e.altKey ? "floating" : "relink");
      }
      return;
    }

    if (e.key === "Escape") {
      if (linking) setLinking(null);
      // In vim mode, Esc is pressed out of habit, so it keeps the selection.
      else if (!vim) setSelected(null);
      return;
    }
    if (letter === "g" && !e.altKey) {
      setGrid((g) => !g);
      return;
    }

    // Vim mode adds siblings with o rather than Enter.
    // Shift adds it above.
    const isSiblingKey = vim ? letter === "o" && !e.altKey : e.key === "Enter";
    // Vim mode starts children with l only.
    const isChildKey = !vim && e.key === "Tab";
    const isNavKey = !!arrow || isSiblingKey || isChildKey || e.key === "Enter";
    if (!selectedNode) {
      if (isNavKey && tree.root) {
        e.preventDefault();
        setSelected(tree.root.key);
      }
      return;
    }
    const sel = selectedNode.key;
    if (arrow) {
      e.preventDefault();
      if (e.altKey && (arrow === "ArrowUp" || arrow === "ArrowDown")) {
        reorder(sel, arrow === "ArrowUp" ? -1 : 1);
      } else {
        navigate(sel, arrow);
      }
      return;
    }
    if (isDeleteKey) {
      e.preventDefault();
      requestDelete(sel, e);
      return;
    }
    if (isSiblingKey && !isLoose(sel)) {
      e.preventDefault();
      addSibling(sel, e.shiftKey);
      return;
    }
    const editAt = (e.shiftKey ? VIM_SHIFT_EDIT_KEYS : VIM_EDIT_KEYS)[letter];
    if (vim && !e.altKey && editAt) {
      e.preventDefault();
      startEditing(sel, editAt);
      return;
    }
    switch (e.key) {
      case "Tab":
        e.preventDefault();
        if (isChildKey && tree.depth.has(sel)) startChildDraft(sel);
        break;
      case "Enter":
        e.preventDefault();
        if (isLoose(sel) && linking !== sel) setLinking(sel);
        break;
      case "F2":
        e.preventDefault();
        startEditing(sel);
        break;
    }
  };
  const keyHandler = useRef(onKeyDown);
  keyHandler.current = onKeyDown;
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // Keep the selected node on screen, panning as little as possible.
  const followRef = useRef<() => void>(() => {});
  followRef.current = () => {
    const rect = wrapper.current?.getBoundingClientRect();
    if (!selectedKey || !rect || !revealed) return;
    if (dragRef.current || branchingRef.current) return;
    const pos = targets.get(selectedKey);
    if (!pos) return;
    const size = sizeOrEstimate(selectedKey);
    const margin = 48;
    const topLeft = flow.flowToScreenPosition(pos);
    const bottomRight = flow.flowToScreenPosition({
      x: pos.x + size.width,
      y: pos.y + size.height,
    });
    const dx =
      Math.min(0, topLeft.x - rect.left - margin) ||
      Math.max(0, bottomRight.x - rect.right + margin);
    const dy =
      Math.min(0, topLeft.y - rect.top - margin) ||
      Math.max(0, bottomRight.y - rect.bottom + margin);
    if (!dx && !dy) return;
    const viewport = flow.getViewport();
    flow.setViewport({ ...viewport, x: viewport.x - dx, y: viewport.y - dy }, { duration: 200 });
  };
  const selectedSize = selectedKey ? sizes.get(selectedKey) : undefined;
  useEffect(() => followRef.current(), [selectedKey, editing, selectedSize]);

  // ---- React Flow wiring --------------------------------------------------

  const onNodesChange = useCallback((changes: NodeChange<MindFlowNode>[]) => {
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

  const toFlow = (e: { clientX: number; clientY: number }) =>
    flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });

  const onNodeDragStart: OnNodeDrag<MindFlowNode> = (_e, node) => {
    setMenu(null);
    setLinking(null);
    setSelected(node.id);
    const keys = new Set([node.id, ...descendants(tree, node.id).map((n) => n.key)]);
    const start = new Map([...keys].map((k) => [k, displayed(k)]));
    setDrag({ key: node.id, keys, start, delta: { x: 0, y: 0 }, target: null });
  };

  /** Drag state after the dragged node moved to `node.position`. */
  const dragTo = (drag: Drag, e: MouseEvent | TouchEvent, node: MindFlowNode): Drag => {
    const start = drag.start.get(node.id)!;
    const target = nodeAt(toFlow(clientPoint(e)), (n) => canParent(n) && !drag.keys.has(n.key));
    return {
      ...drag,
      delta: { x: node.position.x - start.x, y: node.position.y - start.y },
      target: target?.key ?? null,
    };
  };

  const onNodeDrag: OnNodeDrag<MindFlowNode> = (e, node) => {
    if (dragRef.current) setDrag(dragTo(dragRef.current, e, node));
  };

  const onNodeDragStop: OnNodeDrag<MindFlowNode> = (e, node) => {
    if (!dragRef.current) return;
    const drag = dragTo(dragRef.current, e, node);
    const dropped = new Map(
      [...drag.start].map(([k, { x, y }]) => [k, { x: x + drag.delta.x, y: y + drag.delta.y }]),
    );
    const dragged = allNodes.get(drag.key);
    setDrag(null);
    // Ease from where things were dropped to wherever they belong now.
    jump(dropped);
    if (drag.target) {
      attach(drag.key, drag.target);
    } else if (dragged && isLoose(dragged.key)) {
      const { x, y } = dropped.get(drag.key)!;
      if (x !== dragged.x || y !== dragged.y || dragged.parentKey !== undefined) {
        apply({ upserts: [{ ...dragged, parentKey: undefined, x, y }], removes: [] }, dragged.key);
      }
    }
  };

  const onConnectStart: OnConnectStart = (_e, { nodeId }) => {
    if (!nodeId) return;
    setMenu(null);
    setLinking(null);
    setSelected(nodeId);
    setBranching(nodeId);
  };

  const onConnectEnd: OnConnectEnd = (e) => {
    const source = branchingRef.current;
    setBranching(null);
    setPointer(null);
    if (!source) return;
    const at = toFlow(clientPoint(e));
    const hit = nodeAt(at, (n) => n.key !== source);
    if (hit && isLoose(hit.key) && hit.key !== draft?.key) {
      attach(hit.key, source);
      setSelected(hit.key);
    } else if (!hit) {
      // Insert among the existing children according to where it was released.
      const siblings = (tree.children.get(source) ?? []).filter((n) => n.key !== draft?.key);
      const index = siblings.filter((n) => {
        const pos = targets.get(n.key);
        return pos && pos.y + sizeOrEstimate(n.key).height / 2 < at.y;
      }).length;
      startChildDraft(source, index, { x: at.x, y: at.y - ESTIMATED_SIZE.height / 2 });
    }
  };

  // Whether the click that's starting should only dismiss something.
  const dismissOnly = useRef(false);

  const linkTarget =
    linking && pointer ? nodeAt(pointer, (n) => canParent(n) && n.key !== linking) : undefined;
  // While branching, the node under the pointer (which hides the ghost); only
  // loose nodes can be attached.
  const branchHover =
    branching && pointer
      ? nodeAt(pointer, (n) => n.key !== branching && n.key !== draft?.key)
      : undefined;
  const branchTarget = branchHover && isLoose(branchHover.key) ? branchHover : undefined;

  // ---- Render -------------------------------------------------------------

  // Highlight the nodes the highlighted menu option would affect.
  const menuAction = menu && menuEntries[menu.active]?.id;
  const affected = new Set(
    !menu || menuAction === "rename"
      ? []
      : menuAction === "relink"
        ? (tree.children.get(menu.key) ?? []).map((n) => n.key)
        : descendants(tree, menu.key).map((n) => n.key),
  );
  const dropTarget = drag?.target ?? linkTarget?.key ?? branchTarget?.key;

  const flowNodes: MindFlowNode[] = [...allNodes.values()].map((node) => {
    const floating = !tree.depth.has(node.key);
    const isDraft = node.key === draft?.key;
    return {
      id: node.key,
      type: "mind",
      position: displayed(node.key),
      measured: sizes.get(node.key),
      draggable: !node.isRoot && !isDraft && editing !== node.key,
      selectable: false,
      zIndex: drag?.keys.has(node.key) ? 1000 : floating ? 10 : 0,
      data: {
        label: node.label,
        variant: node.isRoot ? "root" : floating ? "floating" : "tree",
        draft: isDraft,
        selected: node.key === selectedKey,
        editing: node.key === editing,
        caret: node.key === editing ? caret : "all",
        dropTarget: node.key === dropTarget,
        deleteAffected: affected.has(node.key),
        dragging: drag?.key === node.key,
      },
    };
  });

  const edges: Edge[] = [];
  for (const node of allNodes.values()) {
    if (!node.parentKey || !tree.depth.has(node.key)) continue;
    let className: string | undefined;
    if (node.key === draft?.key) className = "edge-draft";
    else if (drag?.key === node.key && drag.target) className = "edge-old";
    edges.push({ id: node.key, source: node.parentKey, target: node.key, className });
  }
  if (drag?.target) {
    edges.push({
      id: "drop-preview",
      source: drag.target,
      target: drag.key,
      className: "edge-draft",
    });
  }

  // Dashed line from a click-placed node to the pointer (or the parent under it).
  let linkPath: string | undefined;
  if (linking && allNodes.has(linking) && pointer) {
    const pos = displayed(linking);
    const size = sizeOrEstimate(linking);
    let end = pointer;
    let endWidth = 0;
    if (linkTarget) {
      const t = displayed(linkTarget.key);
      const s = sizeOrEstimate(linkTarget.key);
      end = { x: t.x, y: t.y + s.height / 2 };
      endWidth = s.width;
    }
    // The end to the left acts as the parent, attaching on its right side.
    const nodeIsRight = pos.x + size.width / 2 >= end.x + endWidth / 2;
    const [path] = getBezierPath({
      sourceX: nodeIsRight ? end.x + endWidth : pos.x + size.width,
      sourceY: nodeIsRight ? end.y : pos.y + size.height / 2,
      sourcePosition: Position.Right,
      targetX: nodeIsRight ? pos.x : end.x,
      targetY: nodeIsRight ? pos.y + size.height / 2 : end.y,
      targetPosition: Position.Left,
    });
    linkPath = path;
  }

  const branchOverNode = !!branchHover;
  const contextValue = useMemo<EditorContextValue>(
    () => ({ actions: stableActions, branchOverNode }),
    [stableActions, branchOverNode],
  );

  if (!nodes) {
    return <div className="flex-1" />;
  }

  return (
    <EditorContext.Provider value={contextValue}>
      <div
        ref={wrapper}
        className={`relative flex-1 ${revealed ? "" : "opacity-0"} ${linking ? "linking" : ""}`}
        onPointerDownCapture={(e) => {
          // The error banner sits over the canvas but isn't part of it.
          pointerDownInCanvas.current = !(e.target as Element).closest("[role=alert]");
          if ((e.target as Element).closest("[role=menu]")) return;
          dismissOnly.current = Boolean(editing || linking || menu);
          if (menu) setMenu(null);
        }}
        onPointerMove={(e) => {
          if (linking || branching) setPointer(toFlow(e));
        }}
      >
        <ReactFlow<MindFlowNode>
          nodes={flowNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={(_e, node) => {
            if (linking && linking !== node.id) {
              const target = allNodes.get(node.id);
              if (target && canParent(target)) {
                attach(linking, node.id);
                setSelected(linking);
              }
              setLinking(null);
              return;
            }
            setSelected(node.id);
          }}
          onNodeDoubleClick={(_e, node) => {
            setSelected(node.id);
            startEditing(node.id);
          }}
          onNodeContextMenu={(e, node) => {
            // Keep the native menu (paste, spelling) while editing a label.
            if (node.id === editing || node.id === draft?.key) return;
            e.preventDefault();
            const rect = wrapper.current?.getBoundingClientRect();
            if (!rect) return;
            setSelected(node.id);
            setLinking(null);
            setMenu({
              key: node.id,
              x: e.clientX - rect.left,
              y: e.clientY - rect.top,
              withRename: true,
              active: 0,
            });
          }}
          onPaneClick={(e) => {
            if (dismissOnly.current) {
              setLinking(null);
              return;
            }
            startFloatingDraft(toFlow(e));
          }}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          isValidConnection={() => false}
          connectOnClick={false}
          connectionLineComponent={BranchLine}
          snapToGrid={grid}
          snapGrid={[GRID, GRID]}
          nodeDragThreshold={3}
          nodeClickDistance={3}
          elementsSelectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          disableKeyboardA11y
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          zoomOnDoubleClick={false}
          panOnScroll
          minZoom={0.25}
          maxZoom={2}
        >
          <Background variant={BackgroundVariant.Dots} gap={GRID} size={1.5} color="#cfd2d6" />
          {linkPath && (
            <ViewportPortal>
              <svg className="pointer-events-none absolute left-0 top-0 overflow-visible">
                <path
                  d={linkPath}
                  fill="none"
                  className="stroke-blue-600"
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                />
              </svg>
            </ViewportPortal>
          )}
        </ReactFlow>

        {menu && menuNode && (
          <NodeMenu
            x={menu.x}
            y={menu.y}
            label={`“${menuNode.label}”`}
            items={menuEntries}
            active={menu.active}
            onHover={(active) => setMenu({ ...menu, active })}
            onChoose={chooseMenuItem}
          />
        )}

        <ShortcutHints
          grid={grid}
          linking={!!linking}
          vim={vim}
          looseSelected={!!selectedKey && isLoose(selectedKey)}
        />

        {saveError && (
          <div
            role="alert"
            className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-3 rounded-md bg-red-700 px-3 py-2 text-sm text-white shadow-lg"
          >
            {saveError}
            <button type="button" className="font-medium underline" onClick={dismissError}>
              Dismiss
            </button>
          </div>
        )}
      </div>
    </EditorContext.Provider>
  );
}
