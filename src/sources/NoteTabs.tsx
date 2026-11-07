import { useQuery } from "convex/react";
import { ChevronLeft, ChevronRight, FolderOpen, Plus, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_NOTE_TABS } from "../../convex/model";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { cn } from "../lib/utils";
import { NotesBar, NotesMenu } from "./NotesMenu";
import { SourceList } from "./SourceList";
import { SourceReader } from "./SourceReader";
import { addFilesTab, closeTab, moveTab, openNote, type TabView } from "./tabView";
import { TranscriptionUsage } from "./TranscriptionUsage";
import { useTabDrag } from "./useTabDrag";
import { useTextSize } from "./useTextSize";
import type { PendingUpload } from "./useUpload";

type Props = {
  projectId: Id<"projects">;
  view: TabView;
  onChange: (view: TabView) => void;
  pending: PendingUpload[];
  onListed: (uploadIds: string[]) => void;
  onUpload: () => void;
  onHide: () => void;
  onError: (message: string) => void;
  /** Shown under the tabs, whichever is active. */
  banner: ReactNode;
};

const tabElementId = (id: string) => `note-tab-${id}`;
const panelElementId = (tabId: string) => `note-panel-${tabId}`;
/** Apart from the tabs' own, as any tab's id can become a note's. */
const FILES_PANEL_ID = "note-files-panel";

/** Keeps a panel's place while it's out of sight, without laying it out. */
const OUT_OF_SIGHT = "invisible [content-visibility:hidden]";

/** Brings a tab and its close button, which is beside it, into view at once. */
const REVEAL_TAB: ScrollIntoViewOptions = {
  behavior: "instant",
  block: "nearest",
  inline: "nearest",
};

/** How much of a row's width to scroll by at a time, leaving some context in view. */
const SCROLL_FRACTION = 0.75;

/** Which way a row can scroll, kept up to date as it scrolls, resizes or `contents` change. */
function useScrollableRow(contents: unknown) {
  const row = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    if (!row.current) return;
    const { scrollLeft, clientWidth, scrollWidth } = row.current;
    // A fraction of a pixel short of the end is the end, with display scaling.
    const left = scrollLeft > 1;
    const right = scrollLeft + clientWidth < scrollWidth - 1;
    setCanScroll((was) => (was.left === left && was.right === right ? was : { left, right }));
  }, []);
  useLayoutEffect(measure, [measure, contents]);
  useEffect(() => {
    const element = row.current;
    if (!element) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [measure]);
  const scroll = (direction: -1 | 1) =>
    row.current?.scrollBy({
      left: direction * row.current.clientWidth * SCROLL_FRACTION,
    });
  return { row, canScroll, scroll };
}

/** The notes panel's open tabs, and the files or note the active one shows. */
export function NoteTabs({
  projectId,
  view,
  onChange,
  pending,
  onListed,
  onUpload,
  onHide,
  onError,
  banner,
}: Props) {
  const sources = useQuery(api.sources.list, { projectId });
  const text = useTextSize();
  const { tabs, activeId } = view;
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  // A note loads the first time its tab is shown, then stays where it was left. Each tab
  // has a reader of its own, so that a note open twice can show two places in it.
  const [shown] = useState(() => new Set<string>());
  if (active.sourceId) shown.add(active.id);

  // Picking a tab, closing one or opening a note can remove what had focus.
  const focusActive = useRef(false);
  const change = (next: TabView) => {
    focusActive.current = true;
    onChange(next);
  };
  // Stable, so that changing tabs doesn't re-render the list of files behind them.
  const latest = useRef({ view, change });
  useLayoutEffect(() => {
    latest.current = { view, change };
  });
  const openFromList = useCallback((sourceId: Id<"sources">) => {
    latest.current.change(openNote(latest.current.view, sourceId));
  }, []);
  useEffect(() => {
    if (focusActive.current) {
      const element = document.getElementById(tabElementId(activeId));
      element?.focus({ preventScroll: true });
      element?.parentElement?.scrollIntoView(REVEAL_TAB);
    }
    focusActive.current = false;
  }, [view, activeId]);

  // Titles widen tabs, so the row depends on them as well as on which are open.
  const rowContents = `${tabs.map((tab) => tab.id + (tab.sourceId ?? "")).join()} ${sources?.map((source) => source.title).join()}`;
  const { row, canScroll, scroll } = useScrollableRow(rowContents);
  // Directly, so that where a tab is dropped stays in view rather than the active tab.
  const { drag, handlers, shiftOf, endedDrag } = useTabDrag(row, rowContents, (id, to) =>
    onChange(moveTab(view, id, to)),
  );
  // Not on every change of the view, which would undo scrolling to look at other tabs.
  useEffect(() => {
    document.getElementById(tabElementId(activeId))?.parentElement?.scrollIntoView(REVEAL_TAB);
  }, [activeId, active.sourceId, tabs.length]);

  return (
    <>
      <NotesBar
        menu={
          <NotesMenu
            sourceId={active.sourceId}
            text={text}
            onUpload={onUpload}
            onHide={onHide}
            onError={onError}
          />
        }
      >
        <div className="relative flex h-full min-w-0">
          <div
            ref={row}
            role="tablist"
            aria-label="Open notes"
            className={cn(
              "note-tab-row flex h-full min-w-0 scroll-px-10 overflow-x-auto [scrollbar-width:none] motion-safe:scroll-smooth",
              canScroll.left && "[--note-tab-row-left:2.5rem]",
              canScroll.right && "[--note-tab-row-right:2.5rem]",
            )}
            onKeyDown={(e) => {
              const index = tabs.indexOf(active);
              const to: Record<string, number> = {
                ArrowRight: index + 1,
                ArrowLeft: index - 1,
                Home: 0,
                End: tabs.length - 1,
              };
              if (e.key === "Delete") change(closeTab(view, active.id));
              else if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                if (tabs[to[e.key]]) change(moveTab(view, active.id, to[e.key]));
              } else if (e.key in to) {
                const tab = tabs[(to[e.key] + tabs.length) % tabs.length];
                if (tab !== active) change({ tabs, activeId: tab.id });
              } else return;
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            {tabs.map((tab, index) => {
              const source = sources?.find(({ _id }) => _id === tab.sourceId);
              const selected = tab === active;
              const label = tab.sourceId ? (source?.title ?? "Note") : "New tab";
              const shift = shiftOf(index);
              return (
                <div
                  key={tab.id}
                  {...handlers(tab.id, index)}
                  style={shift ? { transform: `translateX(${shift}px)` } : undefined}
                  className={cn(
                    "group/tab relative flex max-w-44 min-w-0 shrink-0 items-center border-r text-xs select-none",
                    selected
                      ? "bg-background text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    // Only while dragging, or the tabs would slide again as they settle into place.
                    drag &&
                      (drag.id === tab.id
                        ? "z-10 cursor-grabbing bg-background text-foreground shadow-md"
                        : "motion-safe:transition-transform motion-safe:duration-150"),
                  )}
                  // Middle-click closes a tab, as in a browser, instead of starting to scroll.
                  onMouseDown={(e) => {
                    if (e.button === 1) e.preventDefault();
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1) change(closeTab(view, tab.id));
                  }}
                >
                  <button
                    type="button"
                    role="tab"
                    id={tabElementId(tab.id)}
                    aria-selected={selected}
                    // A note's panel only exists once it has been shown.
                    aria-controls={
                      !tab.sourceId
                        ? FILES_PANEL_ID
                        : shown.has(tab.id)
                          ? panelElementId(tab.id)
                          : undefined
                    }
                    tabIndex={selected ? 0 : -1}
                    title={source ? `${source.title}\n${source.name}` : undefined}
                    className="flex h-full w-full min-w-0 items-center gap-1.5 pl-2.5 outline-none focus-visible:underline focus-visible:underline-offset-4"
                    onClick={() => {
                      if (!selected && !endedDrag()) change({ tabs, activeId: tab.id });
                    }}
                  >
                    {!tab.sourceId && <FolderOpen aria-hidden className="size-3.5 shrink-0" />}
                    {tab.sourceId && !sources ? (
                      <Skeleton className="mr-9 h-3 w-16" />
                    ) : (
                      <span
                        className={cn(
                          "note-tab-title",
                          // Where the close button is showing, the title has to fade out before it.
                          selected && "[--note-tab-fade-end:1.5rem]",
                          "group-hover/tab:[--note-tab-fade-end:1.5rem] [@media(hover:none)]:[--note-tab-fade-end:1.5rem]",
                        )}
                      >
                        {label}
                      </span>
                    )}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Close ${label}`}
                    title="Close"
                    tabIndex={-1}
                    className={cn(
                      "absolute top-1/2 right-1 size-5 -translate-y-1/2",
                      !selected &&
                        "opacity-0 group-hover/tab:opacity-100 [@media(hover:none)]:opacity-100",
                    )}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => change(closeTab(view, tab.id))}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              );
            })}
          </div>
          {/* Arrow keys already move between tabs, so these are skipped when tabbing. */}
          {canScroll.left && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Scroll tabs left"
              title="Scroll tabs left"
              tabIndex={-1}
              className="absolute inset-y-0 left-0 h-full w-7 justify-start rounded-none pl-1 text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent"
              onClick={() => scroll(-1)}
            >
              <ChevronLeft />
            </Button>
          )}
          {canScroll.right && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Scroll tabs right"
              title="Scroll tabs right"
              tabIndex={-1}
              className="absolute inset-y-0 right-0 h-full w-7 justify-end rounded-none pr-1 text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent"
              onClick={() => scroll(1)}
            >
              <ChevronRight />
            </Button>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="New tab"
          title={tabs.length < MAX_NOTE_TABS ? "New tab" : "Close a tab to open another"}
          disabled={tabs.length >= MAX_NOTE_TABS}
          className="ml-1 shrink-0"
          onClick={() => change(addFilesTab(view))}
        >
          <Plus />
        </Button>
      </NotesBar>
      {banner}
      <div className="relative min-h-0 flex-1">
        {/* Every Files tab shows the same list, so they can share it and its place. */}
        <div
          role="tabpanel"
          id={FILES_PANEL_ID}
          aria-labelledby={tabElementId(active.id)}
          className={cn("absolute inset-0 flex flex-col", active.sourceId && OUT_OF_SIGHT)}
        >
          <SourceList
            projectId={projectId}
            pending={pending}
            onListed={onListed}
            onOpen={openFromList}
            onError={onError}
          />
          <TranscriptionUsage />
        </div>
        {/* In an order of their own: moving one in the page would lose its place in the note. */}
        {tabs
          .filter(({ id, sourceId }) => sourceId && shown.has(id))
          .sort((a, b) => a.id.localeCompare(b.id))
          .map(({ id, sourceId }) => (
            <div
              key={id}
              role="tabpanel"
              id={panelElementId(id)}
              aria-labelledby={tabElementId(id)}
              className={cn(
                "absolute inset-0 flex flex-col bg-background",
                id !== active.id && OUT_OF_SIGHT,
              )}
            >
              <SourceReader sourceId={sourceId!} textSize={text.size} />
            </div>
          ))}
      </div>
    </>
  );
}
