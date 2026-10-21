export type DeleteMode = "relink" | "withChildren" | "floating";

export type MenuItem = {
  id: "rename" | "delete" | DeleteMode;
  label: string;
  keys: string[];
};

export function menuItems(childCount: number, isRoot: boolean, includeRename: boolean) {
  const items: MenuItem[] = [];
  if (includeRename) items.push({ id: "rename", label: "Rename", keys: ["F2"] });
  if (isRoot) return items;
  if (childCount === 0) {
    items.push({ id: "delete", label: "Delete node", keys: ["Del"] });
  } else {
    items.push(
      { id: "relink", label: "Relink children to parent", keys: ["Del"] },
      { id: "withChildren", label: "Delete with children", keys: ["Shift", "Del"] },
      { id: "floating", label: "Leave children floating", keys: ["Alt", "Del"] },
    );
  }
  return items;
}
