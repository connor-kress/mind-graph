import { LockKeyhole, X } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { kindOfFile, losesImages, SOURCE_KINDS } from "../../convex/model";
import { useIsMobile } from "../hooks/use-mobile";
import { NotesBar, NotesMenu } from "../sources/NotesMenu";
import { NoteTabs } from "../sources/NoteTabs";
import { showFiles, type TabView } from "../sources/tabView";
import { useUpload } from "../sources/useUpload";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";
import { Skeleton } from "./ui/skeleton";

const ACCEPT = [...Object.keys(SOURCE_KINDS), "zip"].map((ext) => `.${ext}`).join(",");

const hasFiles = (e: { dataTransfer: DataTransfer | null }) =>
  !!e.dataTransfer?.types.includes("Files");

const activeTabStorageKey = (topicId: Id<"topics">) => `mind-graph:note-tab:${topicId}`;
const WIDTH_STORAGE_KEY = "mind-graph:notes-panel-width";
const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 256;

/** A width the panel can take in the current window, leaving room for the canvas. */
function clampWidth(width: number) {
  const max = Math.max(MIN_WIDTH, Math.min(720, window.innerWidth * 0.6));
  return Math.round(Math.min(Math.max(width, MIN_WIDTH), max));
}

type Props = {
  /** The open map, undefined while it loads, and null when no map is open. */
  topicId: Id<"topics"> | null | undefined;
  /** The open map's project, likewise. */
  projectId: Id<"projects"> | null | undefined;
  hidden: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** The project's source files: drop or upload them, then open them in tabs to read them. */
export function NotesPanel({ topicId, projectId, hidden, open, onOpenChange }: Props) {
  const mobile = useIsMobile();
  // Each with the project it came from: uploads and deletions can fail after
  // the user has moved on to another project.
  const [errors, setErrors] = useState<{ projectId: Id<"projects">; message: string }[]>([]);

  // The project whose errors are shown. They stay while the next map loads, as
  // it may be in the same project.
  const [shownId, setShownId] = useState(projectId);
  if (projectId !== undefined && projectId !== shownId) {
    setShownId(projectId);
    setErrors([]);
  }
  const onErrorIn = useCallback(
    (projectId: Id<"projects">, message: string) =>
      setErrors((list) => [...list, { projectId, message }]),
    [],
  );
  const shownErrors = errors.filter((error) => error.projectId === shownId);
  // Files go to the open map's project.
  const { pending, upload, forget } = useUpload(projectId ?? undefined, onErrorIn);
  // Stable while tabs change, so that doing so doesn't re-render the notes or the list of files.
  const projectPending = useMemo(
    () => pending.filter((upload) => upload.projectId === projectId),
    [pending, projectId],
  );
  const onNoteError = useCallback(
    (message: string) => {
      if (projectId) onErrorIn(projectId, message);
    },
    [projectId, onErrorIn],
  );
  const openTabs = useQuery(api.noteTabs.get, topicId ? { topicId } : "skip");
  const saveTabs = useMutation(api.noteTabs.set).withOptimisticUpdate((store, { topicId, tabs }) =>
    store.setQuery(api.noteTabs.get, { topicId }, tabs),
  );
  // Which tab is showing is kept in this browser, not with the tabs, so it follows nothing
  // elsewhere. It's read as a map opens, for other windows here to go their own way too.
  const [chosen, setChosen] = useState<{ topicId: Id<"topics">; tabId: string | null } | null>(
    null,
  );
  if (topicId && chosen?.topicId !== topicId) {
    setChosen({ topicId, tabId: localStorage.getItem(activeTabStorageKey(topicId)) });
  }
  const chosenId = chosen?.topicId === topicId ? chosen?.tabId : undefined;
  const tabView = useMemo<TabView | undefined>(
    () =>
      openTabs && {
        tabs: openTabs,
        activeId: openTabs.some((tab) => tab.id === chosenId) ? chosenId! : openTabs[0].id,
      },
    [openTabs, chosenId],
  );
  // Nothing can be added while the map loads, or its tabs, one of which shows the upload.
  const canAdd = !!projectId && !!tabView;
  const changeTabs = (view: TabView) => {
    if (!topicId) return;
    setChosen({ topicId, tabId: view.activeId });
    localStorage.setItem(activeTabStorageKey(topicId), view.activeId);
    if (view.tabs === openTabs) return;
    saveTabs({ topicId, tabs: view.tabs }).catch((error) => {
      console.error(error);
      if (projectId) onErrorIn(projectId, "Couldn't save your open tabs");
    });
  };
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // Entering a child element fires dragenter before the parent's dragleave.
  const dragDepth = useRef(0);
  const accepting = open && !hidden;
  const [width, setWidth] = useState(() =>
    clampWidth(Number(localStorage.getItem(WIDTH_STORAGE_KEY)) || DEFAULT_WIDTH),
  );
  // Only a width someone chose is kept, so anyone who hasn't gets later changes to the default.
  const resizeTo = (next: number) => {
    const clamped = clampWidth(next);
    setWidth(clamped);
    localStorage.setItem(WIDTH_STORAGE_KEY, String(clamped));
  };
  useEffect(() => {
    const onResize = () => setWidth((w) => clampWidth(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const resizeFrom = useRef<{ x: number; width: number } | null>(null);

  // A file dropped just outside the panel would otherwise replace the app.
  useEffect(() => {
    if (!accepting) return;
    const onDrag = (e: globalThis.DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    window.addEventListener("dragover", onDrag);
    window.addEventListener("drop", onDrag);
    return () => {
      window.removeEventListener("dragover", onDrag);
      window.removeEventListener("drop", onDrag);
    };
  }, [accepting]);

  const addFiles = (files: FileList | null) => {
    if (!files?.length || !projectId || !tabView) return;
    let chosen = [...files];
    if (
      chosen.some((file) => losesImages(kindOfFile(file.name))) &&
      !confirm(
        "Only the text of Word and PowerPoint files is transcribed, not their images. To keep figures, export the file as a PDF and upload that instead.\n\nUpload anyway?",
      )
    ) {
      chosen = chosen.filter((file) => !losesImages(kindOfFile(file.name)));
    }
    if (!chosen.length) return;
    setErrors([]);
    upload(chosen);
    // Where their progress shows.
    const showing = showFiles(tabView);
    if (!showing) onErrorIn(projectId, "Close a tab to see your files as they upload");
    else if (showing !== tabView) changeTabs(showing);
  };

  const dropZone = hidden
    ? {}
    : {
        onDragEnter: (e: DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          dragDepth.current++;
          setDragging(true);
        },
        onDragOver: (e: DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = canAdd ? "copy" : "none";
        },
        onDragLeave: (e: DragEvent) => {
          if (!hasFiles(e)) return;
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        },
        onDrop: (e: DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          addFiles(e.dataTransfer.files);
        },
      };

  const onHide = () => onOpenChange(false);
  const chooseFiles = () => input.current?.click();
  const menu = <NotesMenu onUpload={canAdd && !hidden ? chooseFiles : undefined} onHide={onHide} />;

  const banner = shownErrors.length > 0 && (
    <div
      role="alert"
      className="mx-2 my-2 flex shrink-0 items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <ul className="min-w-0 flex-1 space-y-1">
        {shownErrors.map(({ message }, i) => (
          <li key={i}>{message}</li>
        ))}
      </ul>
      <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={() => setErrors([])}>
        <X />
      </Button>
    </div>
  );

  const content = hidden ? (
    <>
      <NotesBar menu={menu} />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-7 text-center">
        <LockKeyhole className="size-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Notes hidden during recall.</p>
      </div>
    </>
  ) : (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={ACCEPT}
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {topicId === null ? (
        <>
          <NotesBar menu={menu} />
          {banner}
          <p className="px-7 py-10 text-center text-sm leading-6 text-muted-foreground">
            Open a map to see its project's notes.
          </p>
        </>
      ) : !topicId || !projectId || !tabView ? (
        <div role="status" aria-label="Loading source notes">
          <NotesBar menu={menu}>
            <Skeleton className="ml-2.5 h-3 w-16" />
          </NotesBar>
          {banner}
          <div className="space-y-3 p-5">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </div>
      ) : (
        <NoteTabs
          // Fresh for each map, whose tabs are its own.
          key={topicId}
          projectId={projectId}
          view={tabView}
          onChange={changeTabs}
          pending={projectPending}
          onListed={forget}
          onUpload={chooseFiles}
          onHide={onHide}
          onError={onNoteError}
          banner={banner}
        />
      )}
      {dragging && canAdd && (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/90 text-sm font-medium text-foreground">
          Drop files to add them
        </div>
      )}
    </div>
  );

  if (mobile)
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="flex w-[min(90vw,22rem)] flex-col gap-0 p-0"
          // Closed from the panel's menu instead.
          showCloseButton={false}
          onKeyDown={(e) => e.stopPropagation()}
          {...dropZone}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Source notes</SheetTitle>
            <SheetDescription>Reference material for the current project.</SheetDescription>
          </SheetHeader>
          {content}
        </SheetContent>
      </Sheet>
    );
  if (!open) return null;
  return (
    <aside
      aria-label="Source notes"
      className="relative flex shrink-0 flex-col border-l bg-background"
      style={{ width }}
      {...dropZone}
    >
      {/* Drag the left edge to resize; arrow keys work too, and double-click resets. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize source notes"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        tabIndex={0}
        title="Drag to resize"
        className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-[3px] after:w-0.5 after:transition-colors hover:after:bg-primary/40 focus-visible:after:bg-primary"
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          resizeFrom.current = { x: e.clientX, width };
        }}
        onPointerMove={(e) => {
          const from = resizeFrom.current;
          if (from) resizeTo(from.width + from.x - e.clientX);
        }}
        onPointerUp={() => (resizeFrom.current = null)}
        onPointerCancel={() => (resizeFrom.current = null)}
        onDoubleClick={() => {
          setWidth(clampWidth(DEFAULT_WIDTH));
          localStorage.removeItem(WIDTH_STORAGE_KEY);
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 64 : 16;
          if (e.key === "ArrowLeft") resizeTo(width + step);
          else if (e.key === "ArrowRight") resizeTo(width - step);
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      />
      {content}
    </aside>
  );
}
