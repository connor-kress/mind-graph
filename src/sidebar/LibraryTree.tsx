import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ChevronIcon, FolderIcon, MapIcon, MoreIcon, PlusIcon } from "./icons";
import { COMING_SOON } from "./mockData";
import { RenameField, RowAction, SidebarRow } from "./SidebarRow";

export type Library = FunctionReturnType<typeof api.library.list>;

type Props = {
  library: Library;
  activeTopicId?: Id<"topics">;
  onOpenMap: (topicId: Id<"topics">) => void;
  collapsed: Set<string>;
  onFolderOpenChange: (folderId: Id<"folders">, open: boolean) => void;
  onNewMap: (folderId: Id<"folders">) => void;
  /** The folder or map being renamed. */
  renamingId: string | null;
  onRenamingChange: (id: string | null) => void;
  onRenameFolder: (folderId: Id<"folders">, name: string) => void;
  onRenameMap: (topicId: Id<"topics">, title: string) => void;
};

/** The library's folders, each expandable to list its maps. */
export function LibraryTree({
  library,
  activeTopicId,
  onOpenMap,
  collapsed,
  onFolderOpenChange,
  onNewMap,
  renamingId,
  onRenamingChange,
  onRenameFolder,
  onRenameMap,
}: Props) {
  const stopRenaming = () => onRenamingChange(null);
  return (
    <ul className="space-y-0.5">
      {library.map((folder) => {
        const open = !collapsed.has(folder._id);
        return (
          <li key={folder._id}>
            <SidebarRow
              leading={
                <span className="flex w-3.5 justify-center text-neutral-500">
                  <ChevronIcon open={open} />
                </span>
              }
              icon={<FolderIcon />}
              label={folder.name}
              onClick={() => onFolderOpenChange(folder._id, !open)}
              onDoubleClick={() => onRenamingChange(folder._id)}
              editor={
                renamingId === folder._id && (
                  <RenameField
                    initial={folder.name}
                    label="Folder name"
                    onSubmit={(name) => {
                      onRenameFolder(folder._id, name);
                      stopRenaming();
                    }}
                    onCancel={stopRenaming}
                  />
                )
              }
              trailing={
                <>
                  <RowAction label={COMING_SOON}>
                    <MoreIcon className="size-3.5" />
                  </RowAction>
                  <RowAction
                    label={`New map in ${folder.name}`}
                    onClick={() => onNewMap(folder._id)}
                  >
                    <PlusIcon className="size-3.5" />
                  </RowAction>
                </>
              }
            />
            {open && (
              <ul className="mt-0.5 space-y-0.5">
                {folder.maps.map((map) => (
                  <li key={map._id}>
                    <SidebarRow
                      nested
                      icon={<MapIcon />}
                      label={map.title}
                      active={map._id === activeTopicId}
                      onClick={() => onOpenMap(map._id)}
                      onDoubleClick={() => onRenamingChange(map._id)}
                      editor={
                        renamingId === map._id && (
                          <RenameField
                            initial={map.title}
                            label="Map name"
                            onSubmit={(title) => {
                              onRenameMap(map._id, title);
                              stopRenaming();
                            }}
                            onCancel={stopRenaming}
                          />
                        )
                      }
                    />
                  </li>
                ))}
                {folder.maps.length === 0 && (
                  <li className="mx-2 flex h-7.5 items-center pl-11 text-sm text-neutral-400">
                    No maps yet
                  </li>
                )}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
