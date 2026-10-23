import { useMutation } from "convex/react";
import { useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Logo } from "../components/Logo";
import {
  ChevronIcon,
  ClockIcon,
  CollapseIcon,
  GroupIcon,
  MapIcon,
  PlusIcon,
  RecallIcon,
  SearchIcon,
  SettingsIcon,
  TrashIcon,
  UpDownIcon,
} from "./icons";
import { LibraryTree, type Library } from "./LibraryTree";
import { COMING_SOON, mockDueCount, mockProfile, mockSharedGroups } from "./mockData";
import { RowAction, SidebarRow } from "./SidebarRow";
import { useCollapsedFolders } from "./useCollapsedFolders";

const NEW_FOLDER_NAME = "Untitled folder";

type Props = {
  open: boolean;
  onToggle: () => void;
  library?: Library;
  activeTopicId?: Id<"topics">;
  onOpenMap: (topicId: Id<"topics">) => void;
  onError: (message: string) => void;
};

/** The collapsible navigation sidebar: library, shared maps, and account. */
export function Sidebar({ open, onToggle, library, activeTopicId, onOpenMap, onError }: Props) {
  const { collapsed, setOpen } = useCollapsedFolders();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const createFolder = useMutation(api.library.createFolder);
  const createMap = useMutation(api.library.createMap);
  // Renames show in the library right away.
  const renameFolder = useMutation(api.library.renameFolder).withOptimisticUpdate(
    (store, { folderId, name }) => {
      const current = store.getQuery(api.library.list, {});
      if (!current) return;
      store.setQuery(
        api.library.list,
        {},
        current.map((f) => (f._id === folderId ? { ...f, name } : f)),
      );
    },
  );
  const renameMap = useMutation(api.library.renameMap).withOptimisticUpdate(
    (store, { topicId, title }) => {
      const current = store.getQuery(api.library.list, {});
      if (!current) return;
      store.setQuery(
        api.library.list,
        {},
        current.map((f) => ({
          ...f,
          maps: f.maps.map((m) => (m._id === topicId ? { ...m, title } : m)),
        })),
      );
    },
  );

  /** Creates a map in a folder, opens it, and starts naming it. */
  const newMap = async (folderId?: Id<"folders">) => {
    try {
      folderId ??= await createFolder({ name: NEW_FOLDER_NAME });
      const topicId = await createMap({ folderId });
      setOpen(folderId, true);
      onOpenMap(topicId);
      setRenamingId(topicId);
    } catch {
      onError("Couldn't create the map");
    }
  };

  const newFolder = async () => {
    try {
      setRenamingId(await createFolder({ name: NEW_FOLDER_NAME }));
    } catch {
      onError("Couldn't create the folder");
    }
  };

  // New maps go in the open map's folder, or the first one.
  const currentFolderId =
    library?.find((f) => f.maps.some((m) => m._id === activeTopicId))?._id ?? library?.[0]?._id;

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

        <button
          type="button"
          disabled={!library}
          onClick={() => newMap(currentFolderId)}
          onMouseDown={(e) => e.preventDefault()}
          className="mx-2 mt-2 flex h-8.5 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-accent text-sm font-semibold text-white hover:bg-accent/90"
        >
          <PlusIcon />
          New map
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
          <SectionHeading
            action={
              <RowAction label="New folder" visible onClick={newFolder}>
                <PlusIcon className="size-3.5" />
              </RowAction>
            }
          >
            Library
          </SectionHeading>
          {library && (
            <LibraryTree
              library={library}
              activeTopicId={activeTopicId}
              onOpenMap={onOpenMap}
              collapsed={collapsed}
              onFolderOpenChange={setOpen}
              onNewMap={newMap}
              renamingId={renamingId}
              onRenamingChange={setRenamingId}
              onRenameFolder={(folderId, name) =>
                renameFolder({ folderId, name }).catch(() => onError("Couldn't rename the folder"))
              }
              onRenameMap={(topicId, title) =>
                renameMap({ topicId, title }).catch(() => onError("Couldn't rename the map"))
              }
            />
          )}
          <div className="mt-0.5">
            <SidebarRow muted icon={<PlusIcon />} label="New folder" onClick={newFolder} />
          </div>

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
