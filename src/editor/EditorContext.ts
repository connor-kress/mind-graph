import { createContext, useContext } from "react";

export type CommitVia = "enter" | "tab" | "blur";

export type EditorActions = {
  commitEdit: (key: string, value: string, via: CommitVia) => void;
};

export type EditorContextValue = {
  actions: EditorActions;
  /** Whether a handle drag is currently over a node (so it wouldn't create one). */
  branchOverNode: boolean;
};

export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor() {
  const value = useContext(EditorContext);
  if (!value) throw new Error("useEditor must be used inside the map editor");
  return value;
}
