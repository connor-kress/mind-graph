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
import { isTextInput } from "./editor/isTextInput";
import { MapEditor } from "./editor/MapEditor";
import { Sidebar } from "./sidebar/Sidebar";

function modeFromHash(): Mode {
  if (window.location.hash === "#recall") return "recall";
  if (window.location.hash === "#compare") return "compare";
  return "build";
}

/** The open map (topic) is kept in the URL's query, the mode in its hash. */
const MAP_PARAM = "map";

const topicFromUrl = () => new URLSearchParams(location.search).get(MAP_PARAM) ?? undefined;

const VIM_STORAGE_KEY = "mind-graph:vim";

const SIDEBAR_STORAGE_KEY = "mind-graph:sidebar";

const LOCKED = "Finish or abandon your recall attempt first";

/**
 * Ends the attempt in the local workspace right away, so the view switches and
 * nothing more can be typed into it while the server catches up.
 */
function endAttempt(store: OptimisticLocalStore, mapId: Id<"maps">, finished: boolean) {
  for (const { args, value } of store.getAllQueries(api.workspace.get)) {
    if (value?.recallMapId !== mapId) continue;
    store.setQuery(api.workspace.get, args, {
      ...value,
      recallMapId: null,
      resultMapId: finished ? mapId : value.resultMapId,
    });
  }
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof ConvexError ? String(error.data) : fallback;

export default function App() {
  const convex = useConvex();
  const [topicId, setTopicId] = useState(topicFromUrl);
  const workspace = useQuery(api.workspace.get, { topicId });
  const library = useQuery(api.library.list);
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
  const [vim, setVim] = useState(() => localStorage.getItem(VIM_STORAGE_KEY) === "on");
  const toggleVim = () => setVim((on) => !on);
  useEffect(() => localStorage.setItem(VIM_STORAGE_KEY, vim ? "on" : "off"), [vim]);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem(SIDEBAR_STORAGE_KEY) !== "closed",
  );
  const toggleSidebar = () => setSidebarOpen((open) => !open);
  useEffect(
    () => localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarOpen ? "open" : "closed"),
    [sidebarOpen],
  );

  // Ctrl+\ toggles the sidebar anywhere (as in Notion). M switches the
  // keyboard mode anywhere, except while typing.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === "Backslash") {
        e.preventDefault();
        setSidebarOpen((open) => !open);
        return;
      }
      if (isTextInput(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      // The printed letter, falling back to the physical key on non-Latin layouts.
      if (e.key.toLowerCase() === "m" || (!/^[a-z]$/i.test(e.key) && e.code === "KeyM")) {
        e.preventDefault();
        setVim((on) => !on);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const onHashChange = () => setRequestedMode(modeFromHash());
    // Back and forward between maps.
    const onPopState = () => {
      setTopicId(topicFromUrl());
      setRequestedMode(modeFromHash());
      setSummary(null);
      setError(null);
    };
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  useEffect(() => {
    if (library?.length === 0) seed().catch(console.error);
  }, [library, seed]);

  const openMap = (id: Id<"topics">) => {
    if (id === workspace?.topic._id) return;
    commitEdits();
    history.pushState(null, "", `${location.pathname}?${MAP_PARAM}=${id}`);
    setTopicId(id);
    setRequestedMode("build");
    setSummary(null);
    setError(null);
  };

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

  // Keep the URL in step with what's shown (including forced modes, and the
  // map opened when the URL named none or an unknown one).
  useEffect(() => {
    if (!workspace) return;
    const search = `?${MAP_PARAM}=${workspace.topic._id}`;
    const hash = mode === "build" ? "" : `#${mode}`;
    if (location.search !== search || location.hash !== hash) {
      history.replaceState(null, "", location.pathname + search + hash);
    }
  }, [mode, workspace]);

  let main = null;
  if (workspace?.referenceMapId) {
    if (mode === "build") {
      main = (
        <MapEditor key={workspace.referenceMapId} mapId={workspace.referenceMapId} vim={vim} />
      );
    } else if (mode === "recall") {
      main = recallMapId ? (
        <MapEditor key={recallMapId} mapId={recallMapId} vim={vim} />
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
    <div className="flex h-full bg-white">
      <Sidebar
        open={sidebarOpen}
        onToggle={toggleSidebar}
        library={library}
        activeTopicId={workspace?.topic._id}
        onOpenMap={openMap}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          folder={workspace?.folderName}
          title={workspace?.topic.title}
          mode={mode}
          onModeChange={(next) => {
            setError(null);
            setRequestedMode(next);
          }}
          disabled={disabled}
          status={status}
          actions={actions}
          vim={vim}
          onVimToggle={toggleVim}
          sidebarOpen={sidebarOpen}
          onSidebarToggle={toggleSidebar}
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
          <NotesPanel
            notes={workspace && (workspace.topic.notes ?? null)}
            hidden={mode === "recall"}
          />
        </div>
      </div>
    </div>
  );
}
