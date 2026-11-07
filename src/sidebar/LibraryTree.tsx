import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ChevronRight,
  FileText,
  FileUp,
  FolderKanban as Project,
  FolderOpen as ProjectOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { movedBefore } from "../../convex/model";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
} from "../components/ui/sidebar";

import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { NO_DRAG, useDragSort } from "../hooks/use-drag-sort";
import { cn } from "../lib/utils";

export type Library = FunctionReturnType<typeof api.library.list>;
export type LibraryTarget =
  | { kind: "project"; id: Id<"projects">; name: string }
  | { kind: "map"; id: Id<"topics">; name: string };
type Props = {
  library: Library;
  activeTopicId?: Id<"topics">;
  collapsed: Set<string>;
  onProjectOpenChange: (id: string, open: boolean) => void;
  onOpenMap: (id: Id<"topics">) => void;
  onNewMap: (id: Id<"projects">) => void;
  onImportMap: (id: Id<"projects">) => void;
  /** A file was dropped on a project, to import as a map. */
  onDropMapFile: (id: Id<"projects">, file: File) => void;
  onRename: (target: LibraryTarget) => void;
  onDelete: (target: LibraryTarget) => void;
  onError: (message: string) => void;
};

export function LibraryTree({
  library,
  activeTopicId,
  collapsed,
  onProjectOpenChange,
  onOpenMap,
  onNewMap,
  onImportMap,
  onDropMapFile,
  onRename,
  onDelete,
  onError,
}: Props) {
  const [dropTarget, setDropTarget] = useState<Id<"projects"> | null>(null);
  const dropZone = (projectId: Id<"projects">) => ({
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDropTarget(projectId);
    },
    onDragLeave: (e: DragEvent) => {
      // Moving onto a child element also leaves this one.
      if (!e.currentTarget.contains(e.relatedTarget as Node | null))
        setDropTarget((target) => (target === projectId ? null : target));
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDropTarget(null);
      const file = e.dataTransfer.files[0];
      if (file) onDropMapFile(projectId, file);
    },
  });
  return (
    <SidebarMenu>
      {library.map((project) => {
        const open = !collapsed.has(project._id);
        const canManage = project.role === "owner";
        const renameProject = () =>
          onRename({ kind: "project", id: project._id, name: project.name });
        return (
          <Collapsible
            key={project._id}
            open={open}
            onOpenChange={(next) => onProjectOpenChange(project._id, next)}
            asChild
          >
            <SidebarMenuItem
              {...dropZone(project._id)}
              className={
                dropTarget === project._id
                  ? "rounded-md bg-sidebar-accent/60 ring-2 ring-sidebar-ring ring-inset"
                  : undefined
              }
            >
              <div className="group/project-row relative">
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton className="h-9 pr-0! transition-none [--fading-title-room:3.5rem] group-hover/project-row:[--fading-title-end:3.5rem] group-has-[:focus-visible]/project-row:[--fading-title-end:3.5rem] group-has-[[data-sidebar=menu-action][aria-expanded=true]]/project-row:[--fading-title-end:3.5rem] [@media(hover:none)]:[--fading-title-end:3.5rem]">
                        <ChevronRight
                          className={`size-3.5 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
                        />
                        {open ? <ProjectOpen /> : <Project />}
                        <span className="fading-title">{project.name}</span>
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                  </ContextMenuTrigger>
                  <ContextMenuContent
                    className="w-44 whitespace-nowrap"
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <ContextMenuItem onSelect={() => onNewMap(project._id)}>
                      <Plus />
                      New map
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => onImportMap(project._id)}>
                      <FileUp />
                      Import map…
                    </ContextMenuItem>
                    {canManage && (
                      <>
                        <ContextMenuItem onSelect={renameProject}>
                          <Pencil />
                          Rename project
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          variant="destructive"
                          onSelect={() =>
                            onDelete({ kind: "project", id: project._id, name: project.name })
                          }
                        >
                          <Trash2 />
                          Delete project
                        </ContextMenuItem>
                      </>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <SidebarMenuAction
                      type="button"
                      showOnHover
                      aria-label={`Add map to ${project.name}`}
                      onClick={() => onNewMap(project._id)}
                      className="top-2! right-7 group-hover/project-row:opacity-100 group-has-[:focus-visible]/project-row:opacity-100"
                    >
                      <Plus />
                    </SidebarMenuAction>
                  </TooltipTrigger>
                  <TooltipContent>Add map</TooltipContent>
                </Tooltip>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuAction
                      showOnHover
                      aria-label={`Actions for ${project.name}`}
                      data-library-actions={project._id}
                      className="top-2! group-hover/project-row:opacity-100 group-has-[:focus-visible]/project-row:opacity-100"
                    >
                      <MoreHorizontal />
                    </SidebarMenuAction>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    className="w-44 whitespace-nowrap"
                    side="right"
                    align="start"
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <DropdownMenuItem onSelect={() => onNewMap(project._id)}>
                      <Plus />
                      New map
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onImportMap(project._id)}>
                      <FileUp />
                      Import map…
                    </DropdownMenuItem>
                    {canManage && (
                      <>
                        <DropdownMenuItem onSelect={renameProject}>
                          <Pencil />
                          Rename project
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() =>
                            onDelete({ kind: "project", id: project._id, name: project.name })
                          }
                        >
                          <Trash2 />
                          Delete project
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <CollapsibleContent>
                <ProjectMaps
                  maps={project.maps}
                  activeTopicId={activeTopicId}
                  onOpenMap={onOpenMap}
                  onRename={onRename}
                  onDelete={onDelete}
                  onError={onError}
                />
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        );
      })}
    </SidebarMenu>
  );
}

type ProjectMapsProps = Pick<
  Props,
  "activeTopicId" | "onOpenMap" | "onRename" | "onDelete" | "onError"
> & {
  maps: Library[number]["maps"];
};

/** A project's maps, which can be dragged to arrange them for everyone in the project. */
function ProjectMaps({
  maps,
  activeTopicId,
  onOpenMap,
  onRename,
  onDelete,
  onError,
}: ProjectMapsProps) {
  const moveMap = useMutation(api.library.moveMap).withOptimisticUpdate(
    (store, { topicId, before }) => {
      const library = store.getQuery(api.library.list, {});
      if (!library) return;
      store.setQuery(
        api.library.list,
        {},
        library.map((project) => {
          const moving = project.maps.find((map) => map._id === topicId);
          if (!moving) return project;
          const next = before && project.maps.find((map) => map._id === before);
          return { ...project, maps: movedBefore(project.maps, moving, next || null) };
        }),
      );
    },
  );
  const moveTo = (topicId: Id<"topics">, to: number, keepFocus = false) => {
    const others = maps.filter((map) => map._id !== topicId);
    if (keepFocus) refocus.current = topicId;
    moveMap({ topicId, before: others[to]?._id ?? null }).catch((error) => {
      console.error(error);
      onError("Couldn't move the map");
    });
  };
  const list = useRef<HTMLUListElement>(null);
  const { drag, handlers, styleOf, endedDrag } = useDragSort({
    axis: "y",
    list,
    scroller: () => list.current?.closest<HTMLElement>('[data-sidebar="content"]') ?? null,
    contents: maps.map((map) => map._id + map.title).join(),
    onMove: (id, to) => moveTo(id as Id<"topics">, to),
  });

  // A row moved in the page can lose focus, and moving with the keyboard needs to keep it.
  const refocus = useRef<Id<"topics"> | null>(null);
  const order = maps.map((map) => map._id).join();
  useEffect(() => {
    if (!refocus.current) return;
    const row = document.querySelector<HTMLElement>(`[data-map-row="${refocus.current}"]`);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
    refocus.current = null;
  }, [order]);

  return (
    <SidebarMenuSub ref={list} className="mr-0 pr-0">
      {maps.map((map, index) => {
        const renameMap = () => onRename({ kind: "map", id: map._id, name: map.title });
        return (
          <SidebarMenuSubItem
            key={map._id}
            {...handlers(map._id, index)}
            style={styleOf(index)}
            className={cn(
              "group/map-row select-none",
              // Only while dragging, or the rows would slide again as they settle.
              drag &&
                (drag.id === map._id
                  ? "z-10 cursor-grabbing rounded-md bg-sidebar shadow-md"
                  : "motion-safe:transition-transform motion-safe:duration-150"),
            )}
          >
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <SidebarMenuButton
                  className="h-8 pr-0! text-[13px] transition-none [--fading-title-room:2rem] group-hover/map-row:[--fading-title-end:2rem] group-has-[:focus-visible]/map-row:[--fading-title-end:2rem] group-has-[[data-sidebar=menu-action][aria-expanded=true]]/map-row:[--fading-title-end:2rem] [@media(hover:none)]:[--fading-title-end:2rem]"
                  isActive={map._id === activeTopicId}
                  aria-current={map._id === activeTopicId ? "page" : undefined}
                  data-map-row={map._id}
                  onClick={() => {
                    if (!endedDrag()) onOpenMap(map._id);
                  }}
                  onKeyDown={(e) => {
                    if (!e.shiftKey) return;
                    const to = { ArrowUp: index - 1, ArrowDown: index + 1 }[e.key];
                    if (to === undefined) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (maps[to]) moveTo(map._id, to, true);
                  }}
                >
                  <FileText className="text-muted-foreground" />
                  <span className="fading-title">{map.title}</span>
                </SidebarMenuButton>
              </ContextMenuTrigger>
              <ContextMenuContent
                className="w-44 whitespace-nowrap"
                onKeyDown={(e) => e.stopPropagation()}
              >
                <ContextMenuItem onSelect={renameMap}>
                  <Pencil />
                  Rename map
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  variant="destructive"
                  onSelect={() => onDelete({ kind: "map", id: map._id, name: map.title })}
                >
                  <Trash2 />
                  Delete map
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuAction
                  {...NO_DRAG}
                  showOnHover
                  aria-label={`Actions for ${map.title}`}
                  data-library-actions={map._id}
                  className="group-hover/map-row:opacity-100 group-has-[:focus-visible]/map-row:opacity-100"
                >
                  <MoreHorizontal />
                </SidebarMenuAction>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-44 whitespace-nowrap"
                side="right"
                align="start"
                onKeyDown={(e) => e.stopPropagation()}
              >
                <DropdownMenuItem onSelect={renameMap}>
                  <Pencil />
                  Rename map
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => onDelete({ kind: "map", id: map._id, name: map.title })}
                >
                  <Trash2 />
                  Delete map
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuSubItem>
        );
      })}
      {maps.length === 0 && (
        <li className="px-2 py-2 text-xs text-muted-foreground">No maps yet</li>
      )}
    </SidebarMenuSub>
  );
}

const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");
