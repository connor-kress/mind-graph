import { useMutation } from "convex/react";
import { FolderPlus as ProjectPlus, Plus, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { AccountMenu } from "../components/AccountMenu";
import { Logo } from "../components/Logo";
import { Button } from "../components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import {
  Sidebar as SidebarShell,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenuSkeleton,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "../components/ui/sidebar";
import { LibraryTree, type Library, type LibraryTarget } from "./LibraryTree";
import { CreateMapDialog } from "./CreateMapDialog";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { DeleteLibraryDialog } from "./DeleteLibraryDialog";
import { ImportMapDialog } from "./ImportMapDialog";
import { readMapFile, type MapFileChoice } from "./readMapFile";
import { useCollapsedProjects } from "./useCollapsedProjects";

type Props = {
  library?: Library;
  activeTopicId?: Id<"topics">;
  onOpenMap: (id: Id<"topics">) => void;
  onDelete: (target: LibraryTarget, confirmation: string) => Promise<void>;
};

export function Sidebar({ library, activeTopicId, onOpenMap, onDelete }: Props) {
  const { collapsed, setOpen } = useCollapsedProjects();
  const { setOpenMobile } = useSidebar();
  const [searchOpen, setSearchOpen] = useState(false);
  const [renaming, setRenaming] = useState<LibraryTarget | null>(null);
  const [creatingMap, setCreatingMap] = useState<{ projectId?: Id<"projects"> } | null>(null);
  const [deleting, setDeleting] = useState<LibraryTarget | null>(null);
  // The project a map file is being chosen for, then the file once read.
  const importInto = useRef<Id<"projects"> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<{
    projectId: Id<"projects">;
    choice: MapFileChoice;
    /** Changes with each file chosen, so each starts with a fresh form. */
    id: number;
  } | null>(null);
  const [name, setName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [saving, setSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const renameProject = useMutation(api.library.renameProject);
  const renameMap = useMutation(api.library.renameMap);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && !e.repeat) {
        e.preventDefault();
        setSearchOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // A map file dropped just beside a project would otherwise replace the app.
  useEffect(() => {
    const onDrag = (e: DragEvent) => {
      if (e.defaultPrevented || !e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("dragover", onDrag);
    window.addEventListener("drop", onDrag);
    return () => {
      window.removeEventListener("dragover", onDrag);
      window.removeEventListener("drop", onDrag);
    };
  }, []);

  const openMap = (id: Id<"topics">) => {
    onOpenMap(id);
    setOpenMobile(false);
    setSearchOpen(false);
  };
  const startRename = (target: LibraryTarget) => {
    setName(target.name);
    setRenameError(null);
    setRenaming(target);
  };
  const newMap = (projectId?: Id<"projects">) => setCreatingMap({ projectId });
  const importMapFile = async (projectId: Id<"projects">, file: File) => {
    const choice = await readMapFile(file);
    setImporting({ projectId, choice, id: Date.now() });
  };
  const chooseMapFile = (projectId: Id<"projects">) => {
    importInto.current = projectId;
    fileInput.current?.click();
  };
  const currentProjectId =
    library?.find((project) => project.maps.some((map) => map._id === activeTopicId))?._id ??
    library?.[0]?._id;

  return (
    <>
      <SidebarShell collapsible="offcanvas" aria-label="Main navigation">
        <SidebarHeader className="gap-4 p-4">
          <div className="flex h-8 items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg border bg-background shadow-xs">
              <Logo className="size-5" />
            </div>
            <span className="flex-1 text-sm font-semibold tracking-tight">Mind Graph</span>
            <SidebarTrigger title="Toggle sidebar (Ctrl+\\)" />
          </div>
          <Button
            variant="outline"
            className="w-full justify-start bg-background text-muted-foreground shadow-none"
            onClick={() => setSearchOpen(true)}
          >
            <Search />
            Search maps<kbd className="ml-auto text-xs">⌘ / Ctrl K</kbd>
          </Button>
          <Button
            className="w-full justify-start"
            disabled={!library}
            onClick={() => void newMap(currentProjectId)}
          >
            <Plus />
            New map
          </Button>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarGroupAction
              title="New project"
              aria-label="New project"
              disabled={!library}
              onClick={() => setCreatingProject(true)}
            >
              <ProjectPlus />
            </SidebarGroupAction>
            {library ? (
              <LibraryTree
                library={library}
                activeTopicId={activeTopicId}
                collapsed={collapsed}
                onProjectOpenChange={setOpen}
                onOpenMap={openMap}
                onNewMap={(id) => void newMap(id)}
                onImportMap={chooseMapFile}
                onDropMapFile={(id, file) => void importMapFile(id, file)}
                onRename={startRename}
                onDelete={setDeleting}
              />
            ) : (
              <>
                <SidebarMenuSkeleton showIcon />
                <SidebarMenuSkeleton showIcon />
                <SidebarMenuSkeleton showIcon />
              </>
            )}
            {library?.length === 0 && (
              <p className="px-2 py-4 text-xs text-muted-foreground">Your maps will appear here.</p>
            )}
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="p-3">
          <SidebarSeparator className="mx-0 w-full" />
          <AccountMenu />
        </SidebarFooter>
      </SidebarShell>
      {creatingProject && (
        <CreateProjectDialog
          onClose={() => setCreatingProject(false)}
          onCreated={(projectId) => setOpen(projectId, true)}
        />
      )}
      {creatingMap && (
        <CreateMapDialog
          projectId={creatingMap.projectId}
          projectName={library?.find((project) => project._id === creatingMap.projectId)?.name}
          onClose={() => setCreatingMap(null)}
          onCreated={(topicId) => {
            if (creatingMap.projectId) setOpen(creatingMap.projectId, true);
            openMap(topicId);
          }}
        />
      )}
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          const projectId = importInto.current;
          event.target.value = "";
          if (file && projectId) void importMapFile(projectId, file);
        }}
      />
      {importing && (
        <ImportMapDialog
          key={importing.id}
          projectId={importing.projectId}
          projectName={library?.find((project) => project._id === importing.projectId)?.name}
          choice={importing.choice}
          onChooseAgain={() => chooseMapFile(importing.projectId)}
          onClose={() => setImporting(null)}
          onImported={(topicId) => {
            setOpen(importing.projectId, true);
            openMap(topicId);
          }}
        />
      )}
      {deleting && (
        <DeleteLibraryDialog
          target={deleting}
          onClose={() => setDeleting(null)}
          onConfirm={(confirmation) => onDelete(deleting, confirmation)}
        />
      )}
      <CommandDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        title="Search maps"
        description="Find a map in your library."
      >
        <CommandInput placeholder="Search your maps..." aria-label="Search maps" />
        <CommandList>
          <CommandEmpty>No maps found.</CommandEmpty>
          {library?.map((project) => (
            <CommandGroup heading={project.name} key={project._id}>
              {project.maps.map((map) => (
                <CommandItem
                  key={map._id}
                  value={`${project.name} ${map.title} ${map._id}`}
                  onSelect={() => openMap(map._id)}
                >
                  <Search className="text-muted-foreground" />
                  <span>{map.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
      <Dialog
        open={!!renaming}
        onOpenChange={(open) => {
          if (!open && !saving) setRenaming(null);
        }}
      >
        <DialogContent
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            requestAnimationFrame(() => document.getElementById("library-name")?.focus());
          }}
        >
          <form
            className="space-y-5"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!renaming || saving || !name.trim()) return;
              setSaving(true);
              setRenameError(null);
              try {
                if (renaming.kind === "project")
                  await renameProject({ projectId: renaming.id, name: name.trim() });
                else await renameMap({ topicId: renaming.id, title: name.trim() });
                setRenaming(null);
              } catch {
                setRenameError("Couldn't save the name. Please try again.");
              } finally {
                setSaving(false);
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Rename {renaming?.kind === "project" ? "project" : "map"}</DialogTitle>
              <DialogDescription>Choose a name you can find again later.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <label htmlFor="library-name" className="text-sm font-medium">
                Name
              </label>
              <Input
                id="library-name"
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onFocus={(e) => e.target.select()}
                disabled={saving}
              />
              {renameError && (
                <p role="alert" className="text-sm text-destructive">
                  {renameError}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setRenaming(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? "Saving..." : "Save name"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
