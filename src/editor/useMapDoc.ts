import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useCallback, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { Change, MapNode, NodeMap } from "./tree";

const MAX_HISTORY = 200;

/** A change plus the node to select once it's applied. */
type HistoryEntry = { change: Change; focus?: string };

function applyToMap(nodes: NodeMap, change: Change): NodeMap {
  const next = new Map(nodes);
  for (const key of change.removes) next.delete(key);
  for (const node of change.upserts) next.set(node.key, node);
  return next;
}

/** The change that reverts `change` when applied after it. */
function invert(nodes: NodeMap, change: Change): Change {
  const upserts: MapNode[] = [];
  const removes: string[] = [];
  for (const key of change.removes) {
    const before = nodes.get(key);
    if (before) upserts.push(before);
  }
  for (const node of change.upserts) {
    const before = nodes.get(node.key);
    if (before) upserts.push(before);
    else removes.push(node.key);
  }
  return { upserts, removes };
}

/**
 * Loads a map's nodes and exposes optimistic, undoable edits. Undo history is
 * local to this editor session.
 */
export function useMapDoc(mapId: Id<"maps">) {
  const list = useQuery(api.nodes.list, { mapId });
  const mutate = useMutation(api.nodes.apply);
  const applyMutation = useMemo(
    () =>
      mutate.withOptimisticUpdate((store, args) => {
        const current = store.getQuery(api.nodes.list, { mapId: args.mapId });
        if (!current) return;
        const roots = new Set(current.filter((n) => n.isRoot).map((n) => n.key));
        const removed = new Set(args.removes.filter((key) => !roots.has(key)));
        const upserted = new Map(args.upserts.map((n) => [n.key, n]));
        const next = current
          .filter((n) => !removed.has(n.key))
          .map((n) => {
            const update = upserted.get(n.key);
            upserted.delete(n.key);
            return update ? { ...update, isRoot: n.isRoot } : n;
          });
        next.push(...[...upserted.values()].map((n) => ({ ...n, isRoot: false })));
        store.setQuery(api.nodes.list, { mapId: args.mapId }, next);
      }),
    [mutate],
  );

  const nodes = useMemo(() => (list ? new Map(list.map((n) => [n.key, n])) : undefined), [list]);

  // The latest known state, including changes applied since the last render.
  const latest = useRef<NodeMap | undefined>(undefined);
  const lastList = useRef(list);
  if (lastList.current !== list) {
    lastList.current = list;
    latest.current = nodes;
  }
  latest.current ??= nodes;

  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Sequence numbers, so a save sent before a failure can't hide its banner.
  const sent = useRef(0);
  const failedAt = useRef(-1);

  const send = useCallback(
    (change: Change) => {
      if (!latest.current) return;
      latest.current = applyToMap(latest.current, change);
      const seq = ++sent.current;
      applyMutation({ mapId, ...change }).then(
        () => {
          if (seq > failedAt.current) setSaveError(null);
        },
        (error) => {
          failedAt.current = seq;
          console.error("Failed to save change", error);
          // The optimistic update has been rolled back, so history built on top
          // of it no longer lines up with the data.
          undoStack.current = [];
          redoStack.current = [];
          setSaveError(
            error instanceof ConvexError ? String(error.data) : "Couldn't save your last change",
          );
        },
      );
    },
    [applyMutation, mapId],
  );

  /** Applies an undoable change; `focus` is reselected when it's undone. */
  const apply = useCallback(
    (change: Change, focus?: string) => {
      if (!latest.current) return;
      if (!change.upserts.length && !change.removes.length) return;
      undoStack.current.push({ change: invert(latest.current, change), focus });
      if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
      redoStack.current = [];
      send(change);
    },
    [send],
  );

  const step = useCallback(
    (from: HistoryEntry[], to: HistoryEntry[]): string | undefined => {
      const entry = from.pop();
      const before = latest.current;
      if (!entry || !before) return undefined;
      to.push({ change: invert(before, entry.change), focus: entry.focus });
      send(entry.change);
      const focus = entry.focus ?? entry.change.upserts[0]?.key;
      // If this step removes the focused node (e.g. undoing its creation),
      // select its parent instead.
      if (focus && entry.change.removes.includes(focus)) return before.get(focus)?.parentKey;
      return focus;
    },
    [send],
  );

  /** Undoes the last change and returns the key of the node to select. */
  const undo = useCallback(() => step(undoStack.current, redoStack.current), [step]);
  const redo = useCallback(() => step(redoStack.current, undoStack.current), [step]);
  const dismissError = useCallback(() => setSaveError(null), []);

  return { nodes, apply, undo, redo, saveError, dismissError };
}
