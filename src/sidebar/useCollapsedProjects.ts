import { useEffect, useState } from "react";

// Collapsed projects are remembered, so new projects start out expanded.
const COLLAPSED_STORAGE_KEY = "mind-graph:collapsed-projects";

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

/** Which projects are collapsed, remembered in this browser. */
export function useCollapsedProjects() {
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  useEffect(
    () => localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...collapsed])),
    [collapsed],
  );
  const setOpen = (id: string, open: boolean) =>
    setCollapsed((prev) => {
      if (prev.has(id) !== open) return prev;
      const next = new Set(prev);
      if (open) next.delete(id);
      else next.add(id);
      return next;
    });
  return { collapsed, setOpen };
}
