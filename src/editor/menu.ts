export type DeleteMode = "relink" | "withChildren" | "floating";

export type MenuItem = {
  id: "rename" | "delete" | DeleteMode;
  label: string;
  keys: string[];
};

export function menuItems(
  childCount: number,
  isRoot: boolean,
  includeRename: boolean,
  vim: boolean,
) {
  const items: MenuItem[] = [];
  const del = vim ? "d" : "Del";
  if (includeRename) items.push({ id: "rename", label: "Rename", keys: [vim ? "i" : "F2"] });
  if (isRoot) return items;
  if (childCount === 0) {
    items.push({ id: "delete", label: "Delete node", keys: [del] });
  } else {
    items.push(
      // The first press opens this menu; the second picks it.
      { id: "relink", label: "Relink children to parent", keys: [del, del] },
      { id: "withChildren", label: "Delete with children", keys: ["Shift", del] },
      { id: "floating", label: "Leave children floating", keys: ["Alt", del] },
    );
  }
  return items;
}
