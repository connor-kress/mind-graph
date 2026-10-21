const COMMIT_EDITS = "mindgraph:commit-edits";

/**
 * Commits any label being edited before the view changes. Label editors commit
 * synchronously on this event, so the edit's mutation is sent before any
 * mutation the caller sends next (Convex runs a client's mutations in order).
 */
export function commitEdits() {
  window.dispatchEvent(new Event(COMMIT_EDITS));
}

/** Calls `commit` whenever `commitEdits` is called; returns a cleanup. */
export function onCommitEdits(commit: () => void) {
  window.addEventListener(COMMIT_EDITS, commit);
  return () => window.removeEventListener(COMMIT_EDITS, commit);
}
