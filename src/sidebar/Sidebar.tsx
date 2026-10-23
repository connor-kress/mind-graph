import type { ReactNode } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { Logo } from "../components/Logo";
import {
  ChevronIcon,
  ClockIcon,
  CollapseIcon,
  GroupIcon,
  MapIcon,
  RecallIcon,
  SearchIcon,
  SettingsIcon,
  TrashIcon,
  UpDownIcon,
} from "./icons";
import { LibraryTree, type Library } from "./LibraryTree";
import { COMING_SOON, mockDueCount, mockProfile, mockSharedGroups } from "./mockData";
import { SidebarRow } from "./SidebarRow";

type Props = {
  open: boolean;
  onToggle: () => void;
  library?: Library;
  activeTopicId?: Id<"topics">;
  onOpenMap: (topicId: Id<"topics">) => void;
};

/** The collapsible navigation sidebar: library, shared maps, and account. */
export function Sidebar({ open, onToggle, library, activeTopicId, onOpenMap }: Props) {
  return (
    <aside
      aria-label="Sidebar"
      // Collapsed, it keeps its contents but can't be reached by keyboard.
      inert={!open}
      className={`shrink-0 overflow-hidden border-neutral-200 bg-sidebar transition-[width] duration-200 ${
        open ? "w-66 border-r" : "w-0"
      }`}
    >
      <div className="flex h-full w-66 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-2 px-4">
          <Logo />
          <span className="text-[15px] font-bold tracking-[-0.01em]">Mind Graph</span>
          <button
            type="button"
            title="Collapse sidebar (Ctrl+\)"
            aria-label="Collapse sidebar"
            onClick={onToggle}
            onMouseDown={(e) => e.preventDefault()}
            className="ml-auto flex size-6 items-center justify-center rounded-md text-neutral-500 hover:bg-sidebar-hover"
          >
            <CollapseIcon />
          </button>
        </div>

        <button
          type="button"
          title={COMING_SOON}
          onMouseDown={(e) => e.preventDefault()}
          className="mx-2 flex h-8 shrink-0 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2 text-[13px] text-neutral-400"
        >
          <SearchIcon className="size-3.5" />
          Search maps
          <span className="kbd ml-auto border-neutral-200 bg-white px-1.5">Ctrl K</span>
        </button>

        <div className="mt-4 space-y-0.5">
          <SidebarRow icon={<ClockIcon />} label="Recent" title={COMING_SOON} />
          <SidebarRow
            icon={<RecallIcon />}
            label="Due for recall"
            title={COMING_SOON}
            trailing={
              <span className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-due-soft px-1.5 text-[11px] font-semibold text-due">
                {mockDueCount}
              </span>
            }
          />
        </div>

        <nav aria-label="Maps" className="mt-5 min-h-0 flex-1 overflow-y-auto pb-4">
          <SectionHeading>Library</SectionHeading>
          {library && (
            <LibraryTree library={library} activeTopicId={activeTopicId} onOpenMap={onOpenMap} />
          )}

          <SectionHeading className="mt-5">Shared</SectionHeading>
          <ul className="space-y-0.5">
            {mockSharedGroups.map((group) => (
              <li key={group.name} className="space-y-0.5">
                <SidebarRow
                  leading={
                    <span className="flex w-3.5 justify-center text-neutral-500">
                      <ChevronIcon open />
                    </span>
                  }
                  icon={<GroupIcon />}
                  label={group.name}
                  title={COMING_SOON}
                  trailing={<span className="text-xs text-neutral-400">{group.members}</span>}
                />
                {group.maps.map((map) => (
                  <SidebarRow key={map} nested icon={<MapIcon />} label={map} title={COMING_SOON} />
                ))}
              </li>
            ))}
          </ul>
        </nav>

        <div className="shrink-0 space-y-0.5 pb-2">
          <SidebarRow icon={<TrashIcon />} label="Trash" title={COMING_SOON} />
          <SidebarRow icon={<SettingsIcon />} label="Settings" title={COMING_SOON} />
        </div>
        <button
          type="button"
          title={COMING_SOON}
          onMouseDown={(e) => e.preventDefault()}
          className="mx-3 flex shrink-0 items-center gap-2.5 border-t border-neutral-200 py-4 pl-1 text-left"
        >
          <span className="flex size-7.5 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
            {mockProfile.initials}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{mockProfile.name}</span>
            <span className="block truncate text-xs text-neutral-500">{mockProfile.school}</span>
          </span>
          <UpDownIcon className="size-4 text-neutral-400" />
        </button>
      </div>
    </aside>
  );
}

function SectionHeading({
  children,
  action,
  className = "",
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-1 flex h-7 items-center px-4 ${className}`}>
      <h2 className="text-xs font-semibold text-neutral-500">{children}</h2>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}
