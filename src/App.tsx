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
import { Button } from "./components/ui/button";
import { SidebarProvider, SidebarInset } from "./components/ui/sidebar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { X } from "lucide-react";

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
  const [notesOpen, setNotesOpen] = useState(() => window.innerWidth >= 1024);
  const [recallBusy, setRecallBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    label: string;
    action: () => void;
  } | null>(null);
  useEffect(
    () => localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarOpen ? "open" : "closed"),
    [sidebarOpen],
  );

  // M switches keyboard mode when focus is outside app controls.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      if (
        e.target instanceof HTMLElement &&
        e.target.closest("button, a, [role=menu], [role=dialog], [role=alertdialog]")
      )
        return;
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
      <Button
        variant="ghost"
        size="sm"
        disabled={recallBusy}
        onClick={() =>
          setConfirmation({
            title: "Abandon this attempt?",
            description:
              "Everything you added in this recall attempt will be deleted. Your reference map is safe.",
            label: "Abandon attempt",
            action: () => {
              setRecallBusy(true);
              setError(null);
              setRequestedMode("build");
              abandonRecall({ mapId: recallMapId })
                .catch((e) => setError(errorMessage(e, "Couldn't abandon the attempt")))
                .finally(() => setRecallBusy(false));
            },
          })
        }
      >
        Abandon
      </Button>
      <Button
        size="sm"
        disabled={recallBusy}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          commitEdits();
          const nodes = convex
            .watchQuery(api.nodes.list, { mapId: recallMapId })
            .localQueryResult();
          const floating = nodes?.filter((n) => !n.isRoot && !n.parentKey).length ?? 0;
          const complete = () => {
            setRecallBusy(true);
            setError(null);
            setRequestedMode("compare");
            finishRecall({ mapId: recallMapId })
              .catch((e) =>
                setError(`${errorMessage(e, "Couldn't finish the attempt")}. It's still open.`),
              )
              .finally(() => setRecallBusy(false));
          };
          if (floating)
            setConfirmation({
              title: "Finish with unconnected nodes?",
              description: `${floating === 1 ? "Your unconnected node" : `Your ${floating} unconnected nodes`} will be discarded. Connect them to the tree to include them in your comparison.`,
              label: "Finish and compare",
              action: complete,
            });
          else complete();
        }}
      >
        {recallBusy ? "Saving..." : "Finish and compare"}
      </Button>
    </>
  ) : null;

  const status =
    mode === "compare" && summary
      ? `${summary.recalled} of ${summary.total} recalled · ${summary.misplaced} misplaced`
      : undefined;

  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      className="h-full min-h-0 overflow-hidden"
      onKeyDown={(e) => {
        if (
          e.target instanceof HTMLElement &&
          e.target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')
        )
          e.stopPropagation();
      }}
    >
      <Sidebar
        library={library}
        activeTopicId={workspace?.topic._id}
        onOpenMap={openMap}
        onError={setError}
      />
      <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
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
          notesOpen={notesOpen}
          onNotesToggle={() => setNotesOpen((open) => !open)}
        />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="relative flex min-w-0 flex-1 flex-col bg-neutral-50">
            {main}
            {error && (
              <div
                role="alert"
                // Below the editor's own save-error banner, so both stay readable.
                className="absolute left-4 right-4 top-14 z-30 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-3 rounded-lg border border-destructive/20 bg-background px-4 py-3 text-sm text-destructive shadow-lg"
              >
                {error}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Dismiss error"
                  onClick={() => setError(null)}
                >
                  <X />
                </Button>
              </div>
            )}
          </div>
          <NotesPanel
            notes={workspace && (workspace.topic.notes ?? null)}
            hidden={mode === "recall"}
            open={notesOpen}
            onOpenChange={setNotesOpen}
          />
        </div>
      </SidebarInset>
      <AlertDialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmation?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmation?.action()}>
              {confirmation?.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  );
}
