import { useMutation } from "convex/react";
import { FolderPlus, Plus, Search, ShieldCheck } from "lucide-react";
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
import { DeleteLibraryDialog } from "./DeleteLibraryDialog";
import { useCollapsedFolders } from "./useCollapsedFolders";

type Props = {
  library?: Library;
  activeTopicId?: Id<"topics">;
  onOpenMap: (id: Id<"topics">) => void;
  onError: (message: string) => void;
  onDelete: (target: LibraryTarget, confirmation: string) => Promise<void>;
};

export function Sidebar({ library, activeTopicId, onOpenMap, onError, onDelete }: Props) {
  const { collapsed, setOpen } = useCollapsedFolders();
  const { setOpenMobile } = useSidebar();
  const [searchOpen, setSearchOpen] = useState(false);
  const [renaming, setRenaming] = useState<LibraryTarget | null>(null);
  const [deleting, setDeleting] = useState<LibraryTarget | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [saving, setSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const createFolder = useMutation(api.library.createFolder);
  const createMap = useMutation(api.library.createMap);
  const renameFolder = useMutation(api.library.renameFolder);
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
  const newFolder = async () => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      const id = await createFolder({ name: "Untitled folder" });
      setOpen(id, true);
      startRename({ kind: "folder", id, name: "Untitled folder" });
    } catch {
      onError("Couldn't create the folder");
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const newMap = async (folderId?: Id<"folders">) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      folderId ??= await createFolder({ name: "Untitled folder" });
      const id = await createMap({ folderId });
      setOpen(folderId, true);
      openMap(id);
      startRename({ kind: "map", id, name: "Untitled map" });
    } catch {
      onError("Couldn't create the map");
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const currentFolderId =
    library?.find((folder) => folder.maps.some((map) => map._id === activeTopicId))?._id ??
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
            disabled={!library || busy}
            onClick={() => void newMap(currentFolderId)}
          >
            <Plus />
            New map
          </Button>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>My library</SidebarGroupLabel>
            <SidebarGroupAction
              title="New folder"
              aria-label="New folder"
              disabled={!library || busy}
              onClick={() => void newFolder()}
            >
              <FolderPlus />
            </SidebarGroupAction>
            {library ? (
              <LibraryTree
                library={library}
                activeTopicId={activeTopicId}
                collapsed={collapsed}
                onFolderOpenChange={setOpen}
                onOpenMap={openMap}
                onNewMap={(id) => void newMap(id)}
                onRename={startRename}
                onDelete={setDeleting}
                busy={busy}
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
          <div className="flex items-center gap-2 px-2 pb-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" />
            Your library is private
          </div>
          <SidebarSeparator className="mx-0 w-full" />
          <AccountMenu />
        </SidebarFooter>
      </SidebarShell>
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
          {library?.map((folder) => (
            <CommandGroup heading={folder.name} key={folder._id}>
              {folder.maps.map((map) => (
                <CommandItem
                  key={map._id}
                  value={`${folder.name} ${map.title} ${map._id}`}
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
                if (renaming.kind === "folder")
                  await renameFolder({ folderId: renaming.id, name: name.trim() });
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
              <DialogTitle>Rename {renaming?.kind === "folder" ? "folder" : "map"}</DialogTitle>
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
