import type { OptimisticLocalStore } from "convex/browser";
import { useConvex, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useEffect, useMemo, useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { CompareSummary } from "./compare/compare";
import { CompareView } from "./compare/CompareView";
import { NotesPanel } from "./components/NotesPanel";
import { RecallStart } from "./components/RecallStart";
import { commitEdits } from "./editor/commitEdits";
import { TopBar, type Mode } from "./components/TopBar";
import { MapEditor } from "./editor/MapEditor";

function modeFromHash(): Mode {
  if (window.location.hash === "#recall") return "recall";
  if (window.location.hash === "#compare") return "compare";
  return "build";
}

const LOCKED = "Finish or abandon your recall attempt first";

/**
 * Ends the attempt in the local workspace right away, so the view switches and
 * nothing more can be typed into it while the server catches up.
 */
function endAttempt(store: OptimisticLocalStore, mapId: Id<"maps">, finished: boolean) {
  const current = store.getQuery(api.workspace.get, {});
  if (!current) return;
  store.setQuery(
    api.workspace.get,
    {},
    {
      ...current,
      recallMapId: null,
      resultMapId: finished ? mapId : current.resultMapId,
    },
  );
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof ConvexError ? String(error.data) : fallback;

export default function App() {
  const convex = useConvex();
  const workspace = useQuery(api.workspace.get);
  const seed = useMutation(api.workspace.seed);
  const startRecall = useMutation(api.workspace.startRecall);
  const finish = useMutation(api.workspace.finishRecall);
  const abandon = useMutation(api.workspace.abandonRecall);
  const finishRecall = useMemo(
    () => finish.withOptimisticUpdate((store, { mapId }) => endAttempt(store, mapId, true)),
    [finish],
  );
  const abandonRecall = useMemo(
    () => abandon.withOptimisticUpdate((store, { mapId }) => endAttempt(store, mapId, false)),
    [abandon],
  );
  const [requestedMode, setRequestedMode] = useState<Mode>(modeFromHash);
  const [summary, setSummary] = useState<CompareSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onHashChange = () => setRequestedMode(modeFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (workspace === null) seed().catch(console.error);
  }, [workspace, seed]);

  // An attempt in progress locks Build and Compare, which would reveal the answers.
  const recallMapId = workspace?.recallMapId;
  const resultMapId = workspace?.resultMapId;
  const disabled: Partial<Record<Mode, string>> = !workspace
    ? {}
    : recallMapId
      ? { build: LOCKED, compare: LOCKED }
      : resultMapId
        ? {}
        : { compare: "Finish a recall attempt to compare it" };
  // Adjust the requested mode during render (no flash of the wrong view):
  // - if the attempt being worked on was finished elsewhere, show its results;
  // - if Compare was asked for but there's nothing to compare, fall back to Build.
  const [prevRecallMapId, setPrevRecallMapId] = useState(recallMapId);
  if (recallMapId !== prevRecallMapId) {
    setPrevRecallMapId(recallMapId);
    if (prevRecallMapId && !recallMapId && resultMapId === prevRecallMapId) {
      setRequestedMode("compare");
    }
  }
  if (workspace && requestedMode === "compare" && !recallMapId && !resultMapId) {
    setRequestedMode("build");
  }

  let mode = requestedMode;
  if (recallMapId) mode = "recall";
  else if (mode === "compare" && workspace && !resultMapId) mode = "build";

  // Keep the URL in step with what's shown (including forced modes).
  useEffect(() => {
    if (!workspace) return;
    const hash = mode === "build" ? "" : `#${mode}`;
    if (location.hash !== hash) {
      history.replaceState(null, "", location.pathname + location.search + hash);
    }
  }, [mode, workspace]);

  let main = null;
  if (workspace?.referenceMapId) {
    if (mode === "build") {
      main = <MapEditor key={workspace.referenceMapId} mapId={workspace.referenceMapId} />;
    } else if (mode === "recall") {
      main = recallMapId ? (
        <MapEditor key={recallMapId} mapId={recallMapId} />
      ) : (
        <RecallStart
          hasPreviousAttempt={!!resultMapId}
          onStart={() =>
            startRecall({ topicId: workspace.topic._id }).catch((e) =>
              setError(errorMessage(e, "Couldn't start a recall attempt")),
            )
          }
        />
      );
    } else if (resultMapId) {
      main = (
        <CompareView
          key={resultMapId}
          referenceMapId={workspace.referenceMapId}
          resultMapId={resultMapId}
          onSummary={setSummary}
          onError={setError}
        />
      );
    }
  }

  const actions = recallMapId ? (
    <>
      <button
        type="button"
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (!confirm("Abandon this recall attempt? Everything you've added will be deleted.")) {
            return;
          }
          setError(null);
          setRequestedMode("build");
          abandonRecall({ mapId: recallMapId }).catch((e) =>
            setError(errorMessage(e, "Couldn't abandon the attempt")),
          );
        }}
      >
        Abandon
      </button>
      <button
        type="button"
        className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          commitEdits();
          // Only the tree is compared, so floating nodes are discarded. Read
          // the local copy, which includes a label that was just committed.
          const nodes = convex
            .watchQuery(api.nodes.list, { mapId: recallMapId })
            .localQueryResult();
          const floating = nodes?.filter((n) => !n.isRoot && !n.parentKey).length ?? 0;
          const discard =
            floating === 1
              ? "Your unconnected node will be discarded."
              : `Your ${floating} unconnected nodes will be discarded.`;
          if (floating && !confirm(`${discard} Finish anyway?`)) return;
          setError(null);
          setRequestedMode("compare");
          finishRecall({ mapId: recallMapId }).catch((e) =>
            setError(`${errorMessage(e, "Couldn't finish the attempt")}. It's still open.`),
          );
        }}
      >
        Finish and compare
      </button>
    </>
  ) : null;

  const status =
    mode === "compare" && summary
      ? `${summary.recalled} of ${summary.total} recalled · ${summary.misplaced} misplaced`
      : undefined;

  return (
    <div className="flex h-full flex-col p-3">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-neutral-300 bg-white shadow-sm">
        <TopBar
          course={workspace?.topic.course}
          title={workspace?.topic.title}
          mode={mode}
          onModeChange={(next) => {
            setError(null);
            setRequestedMode(next);
          }}
          disabled={disabled}
          status={status}
          actions={actions}
        />
        <div className="flex min-h-0 flex-1">
          <div className="relative flex min-w-0 flex-1 flex-col bg-neutral-50">
            {main}
            {error && (
              <div
                role="alert"
                // Below the editor's own save-error banner, so both stay readable.
                className="absolute left-1/2 top-14 z-30 flex -translate-x-1/2 items-center gap-3 rounded-md bg-red-700 px-3 py-2 text-sm text-white shadow-lg"
              >
                {error}
                <button
                  type="button"
                  className="font-medium underline"
                  onClick={() => setError(null)}
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
          <NotesPanel notes={workspace?.topic.notes} hidden={mode === "recall"} />
        </div>
      </div>
    </div>
  );
}
