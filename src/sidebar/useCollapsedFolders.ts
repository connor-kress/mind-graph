import { useEffect, useState } from "react";

// Collapsed folders are remembered, so new folders start out expanded.
const COLLAPSED_STORAGE_KEY = "mind-graph:collapsed-folders";

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

/** Which folders are collapsed, remembered in this browser. */
export function useCollapsedFolders() {
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
