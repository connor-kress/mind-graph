import { useMutation, useQuery } from "convex/react";
import { BookOpen, RotateCw, Trash2 } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { kindOfFile } from "../../convex/model";
import { Button } from "../components/ui/button";
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
        {sources.map((source) => (
          <li key={source._id} className="group flex items-center gap-1 rounded-lg hover:bg-muted">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left"
              onClick={() => onOpen(source._id)}
            >
              <FileIcon kind={source.kind} />
              <span className="min-w-0">
                <span className="block truncate text-sm text-foreground">{source.name}</span>
                <span
                  className={`block text-xs ${source.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {STATUS_TEXT[source.status] ?? formatSize(source.size)}
                </span>
              </span>
            </button>
            {source.status === "failed" && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Transcribe ${source.name} again`}
                title="Try again"
                onClick={() =>
                  retry({ sourceId: source._id }).catch(() => onError("Couldn't try again"))
                }
              >
                <RotateCw />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Delete ${source.name}`}
              title="Delete"
              className="mr-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
              onClick={() => {
                if (
                  !confirm(
                    `Delete ${source.name}? It will be removed from the notes of every map in this project.`,
                  )
                ) {
                  return;
                }
                remove({ sourceId: source._id }).catch(() =>
                  onError(`Couldn't delete ${source.name}`),
                );
              }}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
        {pending.map((upload) => (
          <li key={upload.id} className="flex items-center gap-3 px-2 py-2 opacity-60">
            <FileIcon kind={kindOfFile(upload.name)} />
            <span className="min-w-0">
              <span className="block truncate text-sm text-foreground">{upload.name}</span>
              <span className="block text-xs text-muted-foreground">Uploading…</span>
            </span>
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
}
