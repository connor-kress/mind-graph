import { useMutation, useQuery } from "convex/react";
import { BookOpen, MoreHorizontal, Pencil, RotateCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { kindOfFile, MAX_SOURCE_TITLE_LENGTH, titleFromFileName } from "../../convex/model";
import { RenameDialog } from "../components/RenameDialog";
import { Button } from "../components/ui/button";
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
import { ScrollArea } from "../components/ui/scroll-area";
import { Skeleton } from "../components/ui/skeleton";
import { FileIcon } from "./FileIcon";
import type { PendingUpload } from "./useUpload";

type Props = {
  projectId?: Id<"projects">;
  pending: PendingUpload[];
  onOpen: (sourceId: Id<"sources">) => void;
  onError: (message: string) => void;
};

const STATUS_TEXT: Partial<Record<Doc<"sources">["status"], string>> = {
  queued: "Waiting to transcribe…",
  processing: "Transcribing…",
  failed: "Couldn't transcribe this file",
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** A project's source files, plus the ones still uploading. */
export function SourceList({ projectId, pending, onOpen, onError }: Props) {
  const sources = useQuery(api.sources.list, projectId ? { projectId } : "skip");
  const remove = useMutation(api.sources.remove);
  const retry = useMutation(api.sources.retry);
  const rename = useMutation(api.sources.rename);
  const [renamingId, setRenamingId] = useState<Id<"sources"> | null>(null);
  const renaming = renamingId && sources?.find((source) => source._id === renamingId);
  // Deleted, here or by someone else, while its title was being changed.
  if (renamingId && sources && !renaming) setRenamingId(null);

  if (sources === undefined) {
    return (
      <div role="status" aria-label="Loading source notes" className="space-y-3 p-5">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  if (!sources.length && !pending.length) {
    return (
      <div className="px-7 py-10 text-center text-sm">
        <BookOpen className="mx-auto mb-3 size-7 text-muted-foreground/50" />
        <p className="font-medium text-foreground">No source notes yet</p>
        <p className="mt-1 leading-6 text-muted-foreground">
          Drag files here or click Upload. Markdown, text, Word, PDF, and PowerPoint files up to 15
          MB.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <ul className="p-2">
        {sources.map((source) => {
          const renameNote = () => setRenamingId(source._id);
          const deleteNote = () => {
            if (
              !confirm(
                `Delete ${source.title}? It will be removed from the notes of every map in this project.`,
              )
            ) {
              return;
            }
            remove({ sourceId: source._id }).catch(() =>
              onError(`Couldn't delete ${source.title}`),
            );
          };
          return (
            <li
              key={source._id}
              className="group flex items-center gap-1 rounded-lg hover:bg-muted"
            >
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left"
                    // The whole title, which may be cut off, and the file it came from.
                    title={`${source.title}\n${source.name}`}
                    onClick={() => onOpen(source._id)}
                  >
                    <FileIcon kind={source.kind} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-foreground">{source.title}</span>
                      <span
                        className={`block text-xs ${source.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}
                      >
                        {STATUS_TEXT[source.status] ?? formatSize(source.size)}
                      </span>
                    </span>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent
                  className="w-44 whitespace-nowrap"
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <ContextMenuItem onSelect={renameNote}>
                    <Pencil />
                    Rename note
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive" onSelect={deleteNote}>
                    <Trash2 />
                    Delete note
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              {source.status === "failed" && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Transcribe ${source.title} again`}
                  title="Try again"
                  onClick={() =>
                    retry({ sourceId: source._id }).catch(() => onError("Couldn't try again"))
                  }
                >
                  <RotateCw />
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Actions for ${source.title}`}
                    data-source-actions={source._id}
                    className="mr-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100 [@media(hover:none)]:opacity-100"
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-44 whitespace-nowrap"
                  align="end"
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <DropdownMenuItem onSelect={renameNote}>
                    <Pencil />
                    Rename note
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={deleteNote}>
                    <Trash2 />
                    Delete note
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
        {pending.map((upload) => (
          <li key={upload.id} className="flex items-center gap-3 px-2 py-2 opacity-60">
            <FileIcon kind={kindOfFile(upload.name)} />
            <span className="min-w-0">
              <span className="block truncate text-sm text-foreground">
                {titleFromFileName(upload.name)}
              </span>
              <span className="block text-xs text-muted-foreground">Uploading…</span>
            </span>
          </li>
        ))}
      </ul>
      {renaming && (
        <RenameDialog
          key={renaming._id}
          heading="Rename note"
          description="The new title is shown to everyone in this project. The file keeps its name."
          label="Title"
          saveLabel="Save title"
          initialValue={renaming.title}
          maxLength={MAX_SOURCE_TITLE_LENGTH}
          onSave={async (title) => {
            await rename({ sourceId: renaming._id, title });
          }}
          onClose={() => setRenamingId(null)}
          returnFocus={() =>
            document.querySelector<HTMLElement>(`[data-source-actions="${renaming._id}"]`) ??
            // Deleted while being renamed: another note's instead, or Upload if none is left.
            document.querySelector<HTMLElement>("[data-source-actions]") ??
            document.querySelector<HTMLElement>("[data-notes-upload]")
          }
        />
      )}
    </ScrollArea>
  );
}
