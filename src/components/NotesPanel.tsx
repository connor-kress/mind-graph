import { BookOpen, LockKeyhole, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { SOURCE_KINDS } from "../../convex/model";
import { useIsMobile } from "../hooks/use-mobile";
import { SourceList } from "../sources/SourceList";
import { SourceReader } from "../sources/SourceReader";
import { useUpload } from "../sources/useUpload";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";

const ACCEPT = Object.keys(SOURCE_KINDS)
  .map((ext) => `.${ext}`)
  .join(",");

const hasFiles = (e: { dataTransfer: DataTransfer | null }) =>
  !!e.dataTransfer?.types.includes("Files");

const WIDTH_STORAGE_KEY = "mind-graph:notes-width";
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 256;

/** A width the panel can take in the current window, leaving room for the canvas. */
function clampWidth(width: number) {
  const max = Math.max(MIN_WIDTH, Math.min(720, window.innerWidth * 0.6));
  return Math.round(Math.min(Math.max(width, MIN_WIDTH), max));
}

type Props = {
  topicId?: Id<"topics">;
  hidden: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** The map's source files: drop or upload them, then open one to read it. */
export function NotesPanel({ topicId, hidden, open, onOpenChange }: Props) {
  const mobile = useIsMobile();
  const [openId, setOpenId] = useState<Id<"sources"> | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const onError = (message: string) => setErrors((list) => [...list, message]);
  const { pending, upload } = useUpload(topicId, onError);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // Entering a child element fires dragenter before the parent's dragleave.
  const dragDepth = useRef(0);
  const accepting = open && !hidden;
  const [width, setWidth] = useState(() =>
    clampWidth(Number(localStorage.getItem(WIDTH_STORAGE_KEY)) || DEFAULT_WIDTH),
  );
  useEffect(() => localStorage.setItem(WIDTH_STORAGE_KEY, String(width)), [width]);
  useEffect(() => {
    const onResize = () => setWidth((w) => clampWidth(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const resizeFrom = useRef<{ x: number; width: number } | null>(null);

  // Another map's file isn't in this one's list.
  const [prevTopicId, setPrevTopicId] = useState(topicId);
  if (topicId !== prevTopicId) {
    setPrevTopicId(topicId);
    setOpenId(null);
    setErrors([]);
  }

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
    if (!files?.length) return;
    setErrors([]);
    setOpenId(null);
    upload(files);
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
          e.dataTransfer.dropEffect = "copy";
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

  const uploadButton = !hidden && (
    <>
      <Button variant="ghost" size="xs" disabled={!topicId} onClick={() => input.current?.click()}>
        <Upload data-icon="inline-start" />
        Upload
      </Button>
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
    </>
  );

  const content = hidden ? (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-7 text-center">
      <LockKeyhole className="size-5 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Notes hidden during recall.</p>
    </div>
  ) : (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {openId ? (
        <SourceReader sourceId={openId} onClose={() => setOpenId(null)} />
      ) : (
        <>
          {errors.length > 0 && (
            <div
              role="alert"
              className="mx-2 mt-2 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <ul className="min-w-0 flex-1 space-y-1">
                {errors.map((message, i) => (
                  <li key={i}>{message}</li>
                ))}
              </ul>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Dismiss"
                onClick={() => setErrors([])}
              >
                <X />
              </Button>
            </div>
          )}
          <SourceList topicId={topicId} pending={pending} onOpen={setOpenId} onError={onError} />
        </>
      )}
      {dragging && (
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
          onKeyDown={(e) => e.stopPropagation()}
          {...dropZone}
        >
          <SheetHeader className="flex-row items-center gap-2 border-b p-5 pr-12">
            <SheetTitle className="flex-1 text-sm">Source notes</SheetTitle>
            <SheetDescription className="sr-only">
              Reference material for the current map.
            </SheetDescription>
            {uploadButton}
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
          if (from) setWidth(clampWidth(from.width + from.x - e.clientX));
        }}
        onPointerUp={() => (resizeFrom.current = null)}
        onPointerCancel={() => (resizeFrom.current = null)}
        onDoubleClick={() => setWidth(clampWidth(DEFAULT_WIDTH))}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 64 : 16;
          if (e.key === "ArrowLeft") setWidth((w) => clampWidth(w + step));
          else if (e.key === "ArrowRight") setWidth((w) => clampWidth(w - step));
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      />
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-5 pr-3">
        <BookOpen className="size-4 text-muted-foreground" />
        <h2 className="flex-1 text-xs font-semibold">Source notes</h2>
        {uploadButton}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Hide source notes"
          onClick={() => onOpenChange(false)}
        >
          <X />
        </Button>
      </div>
      {content}
    </aside>
  );
}
