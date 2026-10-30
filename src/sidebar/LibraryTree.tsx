import type { FunctionReturnType } from "convex/server";
import {
  ChevronRight,
  FileText,
  FolderKanban as Project,
  FolderOpen as ProjectOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
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
  onRename: (target: LibraryTarget) => void;
  onDelete: (target: LibraryTarget) => void;
  busy: boolean;
};

export function LibraryTree({
  library,
  activeTopicId,
  collapsed,
  onProjectOpenChange,
  onOpenMap,
  onNewMap,
  onRename,
  onDelete,
  busy,
}: Props) {
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
            <SidebarMenuItem>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton
                      onDoubleClick={canManage ? renameProject : undefined}
                      className="h-9 pr-8"
                    >
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
                  <ContextMenuItem disabled={busy} onSelect={() => onNewMap(project._id)}>
                    <Plus />
                    New map
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuAction
                    showOnHover
                    aria-label={`Actions for ${project.name}`}
                    className="top-2"
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
                  <DropdownMenuItem disabled={busy} onSelect={() => onNewMap(project._id)}>
                    <Plus />
                    New map
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
              <CollapsibleContent>
                <SidebarMenuSub className="mr-0 pr-0">
                  {project.maps.map((map) => {
                    const renameMap = () => onRename({ kind: "map", id: map._id, name: map.title });
                    return (
                      <SidebarMenuSubItem key={map._id}>
                        <ContextMenu>
                          <ContextMenuTrigger asChild>
                            <SidebarMenuButton
                              className="h-8 pr-8 text-[13px]"
                              isActive={map._id === activeTopicId}
                              aria-current={map._id === activeTopicId ? "page" : undefined}
                              onClick={() => onOpenMap(map._id)}
                              onDoubleClick={renameMap}
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
                            <SidebarMenuAction showOnHover aria-label={`Actions for ${map.title}`}>
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
                  <SidebarMenuSubItem>
                    <SidebarMenuButton
                      className="h-8 text-xs text-muted-foreground"
                      disabled={busy}
                      onClick={() => onNewMap(project._id)}
                    >
                      <Plus />
                      <span>New map</span>
                    </SidebarMenuButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        );
      })}
    </SidebarMenu>
  );
}
