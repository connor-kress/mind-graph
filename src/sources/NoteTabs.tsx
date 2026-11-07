import { useQuery } from "convex/react";
import { FolderOpen, Plus, X } from "lucide-react";
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
import { addFilesTab, closeTab, openNote, type TabView } from "./tabView";
import { TranscriptionUsage } from "./TranscriptionUsage";
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
const panelElementId = (sourceId?: Id<"sources">) => `note-panel-${sourceId ?? "files"}`;

/** Keeps a panel's place while it's out of sight, without laying it out. */
const OUT_OF_SIGHT = "invisible [content-visibility:hidden]";

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

  // A note loads the first time it's shown, then stays where it was left.
  const [shown] = useState(() => new Set<Id<"sources">>());
  if (active.sourceId) shown.add(active.sourceId);

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
    const element = document.getElementById(tabElementId(activeId));
    // With its close button, which is beside it.
    element?.parentElement?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (focusActive.current) element?.focus({ preventScroll: true });
    focusActive.current = false;
  }, [view, activeId]);

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
        <div
          role="tablist"
          aria-label="Open notes"
          className="flex h-full min-w-0 overflow-x-auto [scrollbar-width:none]"
          onKeyDown={(e) => {
            const index = tabs.indexOf(active);
            const to: Record<string, number> = {
              ArrowRight: index + 1,
              ArrowLeft: index - 1,
              Home: 0,
              End: tabs.length - 1,
            };
            if (e.key === "Delete") change(closeTab(view, active.id));
            else if (e.key in to) {
              const tab = tabs[(to[e.key] + tabs.length) % tabs.length];
              if (tab !== active) change({ tabs, activeId: tab.id });
            } else return;
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {tabs.map((tab) => {
            const source = sources?.find(({ _id }) => _id === tab.sourceId);
            const selected = tab === active;
            const label = tab.sourceId ? (source?.title ?? "Note") : "Files";
            return (
              <div
                key={tab.id}
                className={cn(
                  "group/tab relative flex max-w-44 min-w-0 shrink-0 items-center border-r text-xs",
                  selected
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
                    !tab.sourceId || shown.has(tab.sourceId)
                      ? panelElementId(tab.sourceId)
                      : undefined
                  }
                  tabIndex={selected ? 0 : -1}
                  title={source ? `${source.title}\n${source.name}` : undefined}
                  className="flex h-full w-full min-w-0 items-center gap-1.5 pl-2.5 outline-none focus-visible:underline focus-visible:underline-offset-4"
                  onClick={() => {
                    if (!selected) change({ tabs, activeId: tab.id });
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
                  onClick={() => change(closeTab(view, tab.id))}
                >
                  <X className="size-3" />
                </Button>
              </div>
            );
          })}
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
          id={panelElementId()}
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
        {tabs.map(
          ({ id, sourceId }) =>
            sourceId &&
            shown.has(sourceId) && (
              <div
                key={sourceId}
                role="tabpanel"
                id={panelElementId(sourceId)}
                aria-labelledby={tabElementId(id)}
                className={cn(
                  "absolute inset-0 flex flex-col bg-background",
                  id !== active.id && OUT_OF_SIGHT,
                )}
              >
                <SourceReader sourceId={sourceId} textSize={text.size} />
              </div>
            ),
        )}
      </div>
    </>
  );
}
