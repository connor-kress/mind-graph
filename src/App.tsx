import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../convex/_generated/api";
import { NotesPanel } from "./components/NotesPanel";
import { TopBar, type Mode } from "./components/TopBar";
import { MapEditor } from "./editor/MapEditor";

function modeFromHash(): Mode {
  return window.location.hash === "#recall" ? "recall" : "build";
}

export default function App() {
  const workspace = useQuery(api.workspace.get);
  const seed = useMutation(api.workspace.seed);
  const startRecall = useMutation(api.workspace.startRecall);
  const [mode, setMode] = useState<Mode>(modeFromHash);

  useEffect(() => {
    const onHashChange = () => setMode(modeFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (workspace === null) seed().catch(console.error);
  }, [workspace, seed]);

  const topicId = workspace?.topic._id;
  const needsRecall = mode === "recall" && workspace && !workspace.recallMapId;
  useEffect(() => {
    if (needsRecall && topicId) startRecall({ topicId }).catch(console.error);
  }, [needsRecall, topicId, startRecall]);

  const mapId = mode === "build" ? workspace?.referenceMapId : workspace?.recallMapId;

  return (
    <div className="flex h-full flex-col p-3">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-neutral-300 bg-white shadow-sm">
        <TopBar
          course={workspace?.topic.course}
          title={workspace?.topic.title}
          mode={mode}
          onModeChange={(next) => {
            history.replaceState(null, "", next === "recall" ? "#recall" : location.pathname);
            setMode(next);
          }}
        />
        <div className="flex min-h-0 flex-1">
          <div className="relative flex min-w-0 flex-1 flex-col bg-neutral-50">
            {mapId ? <MapEditor key={mapId} mapId={mapId} /> : null}
          </div>
          <NotesPanel notes={workspace?.topic.notes} hidden={mode === "recall"} />
        </div>
      </div>
    </div>
  );
}
