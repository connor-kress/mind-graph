import type { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";
import type { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ChevronIcon, FolderIcon, MapIcon, MoreIcon } from "./icons";
import { COMING_SOON } from "./mockData";
import { RowAction, SidebarRow } from "./SidebarRow";

export type Library = FunctionReturnType<typeof api.library.list>;

// Collapsed folders are remembered, so new folders start out expanded.
const COLLAPSED_STORAGE_KEY = "mind-graph:collapsed-folders";

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

type Props = {
  library: Library;
  activeTopicId?: Id<"topics">;
  onOpenMap: (topicId: Id<"topics">) => void;
};

/** The library's folders, each expandable to list its maps. */
export function LibraryTree({ library, activeTopicId, onOpenMap }: Props) {
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  useEffect(
    () => localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...collapsed])),
    [collapsed],
  );
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <ul className="space-y-0.5">
      {library.map((folder) => {
        const open = !collapsed.has(folder._id);
        return (
          <li key={folder._id}>
            <SidebarRow
              leading={
                <span className="flex w-3.5 justify-center text-neutral-500">
                  <ChevronIcon open={open} />
                </span>
              }
              icon={<FolderIcon />}
              label={folder.name}
              onClick={() => toggle(folder._id)}
              trailing={
                <RowAction label={COMING_SOON}>
                  <MoreIcon className="size-3.5" />
                </RowAction>
              }
            />
            {open && (
              <ul className="mt-0.5 space-y-0.5">
                {folder.maps.map((map) => (
                  <li key={map._id}>
                    <SidebarRow
                      nested
                      icon={<MapIcon />}
                      label={map.title}
                      active={map._id === activeTopicId}
                      onClick={() => onOpenMap(map._id)}
                    />
                  </li>
                ))}
                {folder.maps.length === 0 && (
                  <li className="mx-2 flex h-7.5 items-center pl-11 text-sm text-neutral-400">
                    No maps yet
                  </li>
                )}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
