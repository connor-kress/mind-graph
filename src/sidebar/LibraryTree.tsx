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
import { useState, type DragEvent } from "react";
import type { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
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
                      <SidebarMenuButton className="h-9 pr-2! transition-none group-hover/project-row:pr-14! group-has-[:focus-visible]/project-row:pr-14! group-has-[[data-sidebar=menu-action][aria-expanded=true]]/project-row:pr-14! [@media(hover:none)]:pr-14!">
                        <ChevronRight
                          className={`size-3.5 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
                        />
                        {open ? <ProjectOpen /> : <Project />}
                        <span>{project.name}</span>
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
                <SidebarMenuSub className="mr-0 pr-0">
                  {project.maps.map((map) => {
                    const renameMap = () => onRename({ kind: "map", id: map._id, name: map.title });
                    return (
                      <SidebarMenuSubItem key={map._id} className="group/map-row">
                        <ContextMenu>
                          <ContextMenuTrigger asChild>
                            <SidebarMenuButton
                              className="h-8 pr-2! text-[13px] transition-none group-hover/map-row:pr-8! group-has-[:focus-visible]/map-row:pr-8! group-has-[[data-sidebar=menu-action][aria-expanded=true]]/map-row:pr-8! [@media(hover:none)]:pr-8!"
                              isActive={map._id === activeTopicId}
                              aria-current={map._id === activeTopicId ? "page" : undefined}
                              onClick={() => onOpenMap(map._id)}
                            >
                              <FileText className="text-muted-foreground" />
                              <span>{map.title}</span>
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
                              onSelect={() =>
                                onDelete({ kind: "map", id: map._id, name: map.title })
                              }
                            >
                              <Trash2 />
                              Delete map
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <SidebarMenuAction
                              showOnHover
                              aria-label={`Actions for ${map.title}`}
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
                              onSelect={() =>
                                onDelete({ kind: "map", id: map._id, name: map.title })
                              }
                            >
                              <Trash2 />
                              Delete map
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </SidebarMenuSubItem>
                    );
                  })}
                  {project.maps.length === 0 && (
                    <li className="px-2 py-2 text-xs text-muted-foreground">No maps yet</li>
                  )}
                </SidebarMenuSub>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        );
      })}
    </SidebarMenu>
  );
}

const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");
