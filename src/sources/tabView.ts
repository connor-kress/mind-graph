import { MAX_NOTE_TABS, type NoteTab } from "../../convex/model";

/** The tabs open in the notes panel, and which one is showing. */
export type TabView = { tabs: NoteTab[]; activeId: string };

/** Adds a tab showing the project's files, and goes to it. */
export function addFilesTab({ tabs }: Pick<TabView, "tabs">): TabView {
  const tab = { id: crypto.randomUUID() };
  return { tabs: [...tabs, tab], activeId: tab.id };
}

/** Opens a note picked from the files in the active tab, which becomes that note. */
export function openNote({ tabs, activeId }: TabView, sourceId: NoteTab["sourceId"]): TabView {
  return { tabs: tabs.map((tab) => (tab.id === activeId ? { ...tab, sourceId } : tab)), activeId };
}

/** Closes a tab, going to the next one along if it was showing. The last becomes a new Files tab. */
export function closeTab({ tabs, activeId }: TabView, id: string): TabView {
  const left = tabs.filter((tab) => tab.id !== id);
  if (!left.length) return addFilesTab({ tabs: left });
  if (id !== activeId) return { tabs: left, activeId };
  const index = tabs.findIndex((tab) => tab.id === id);
  return { tabs: left, activeId: left[Math.min(index, left.length - 1)].id };
}

/** Goes to the project's files, in a new tab if none shows them. Null if there's no room for one. */
export function showFiles(view: TabView): TabView | null {
  const { tabs, activeId } = view;
  if (!tabs.find((tab) => tab.id === activeId)?.sourceId) return view;
  const files = tabs.find((tab) => !tab.sourceId);
  if (files) return { tabs, activeId: files.id };
  return tabs.length < MAX_NOTE_TABS ? addFilesTab(view) : null;
}

/** Moves a tab to another place in the row, as far as the row goes. */
export function moveTab({ tabs, activeId }: TabView, id: string, to: number): TabView {
  const tab = tabs.find((tab) => tab.id === id);
  if (!tab) return { tabs, activeId };
  const others = tabs.filter((other) => other !== tab);
  const place = Math.min(Math.max(to, 0), others.length);
  return { tabs: [...others.slice(0, place), tab, ...others.slice(place)], activeId };
}
