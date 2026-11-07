import { useQuery } from "convex/react";
import {
  Download,
  ExternalLink,
  Loader2,
  Minus,
  MoreHorizontal,
  PanelRightClose,
  Plus,
  Upload,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { downloadFile, downloadNote } from "./download";
import type { TextSize } from "./useTextSize";

/** The notes panel's only bar: tabs or whatever stands in for them, then its menu at the end. */
export function NotesBar({ children, menu }: { children?: ReactNode; menu: ReactNode }) {
  return (
    <div className="flex h-10 shrink-0 items-center border-b bg-muted/50">
      {children}
      <div className="ml-auto shrink-0 pr-2 pl-4">{menu}</div>
    </div>
  );
}

type Props = {
  /** The open note's, if one is showing. */
  sourceId?: Id<"sources">;
  text?: TextSize;
  /** Undefined when nothing can be added. */
  onUpload?: () => void;
  onHide: () => void;
  onError?: (message: string) => void;
};

/** What can be done from the notes panel, including to the open note. */
export function NotesMenu({ sourceId, text, onUpload, onHide, onError }: Props) {
  const source = useQuery(api.sources.open, sourceId ? { sourceId } : "skip");
  const [saving, setSaving] = useState(false);
  // Files are fetched before they can be saved, which can take a while.
  const save = (title: string, start: () => Promise<void>) => {
    setSaving(true);
    start()
      .catch((error) => {
        console.error(error);
        onError?.(`Couldn't download ${title}`);
      })
      .finally(() => setSaving(false));
  };

  const downloads: { label: string; start: () => Promise<void> }[] = [];
  if (source) {
    const { title, name, kind, markdownUrl, originalUrl, assetUrls } = source;
    if (markdownUrl) {
      downloads.push(
        originalUrl
          ? {
              label: Object.values(assetUrls).some(Boolean)
                ? "Download Markdown and images (.zip)"
                : "Download Markdown (.md)",
              start: () => downloadNote(title, markdownUrl, assetUrls),
            }
          : // A Markdown or text file is its own note.
            { label: `Download note (.${kind})`, start: () => downloadFile(markdownUrl, name) },
      );
    }
    if (originalUrl) {
      downloads.push({
        label: `Download original file (.${kind})`,
        start: () => downloadFile(originalUrl, name),
      });
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Notes actions"
          aria-busy={saving}
          title="Actions"
          data-notes-menu
        >
          {saving ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-max min-w-44 whitespace-nowrap"
        onKeyDown={(e) => e.stopPropagation()}
      >
        {sourceId && text && (
          <>
            <div role="group" aria-label="Text size" className="flex items-center text-sm">
              <span className="flex-1 pr-4 pl-1.5">Text size</span>
              {/* These keep the menu open, to change the size more than one step at a time. */}
              <DropdownMenuItem
                aria-label="Smaller text"
                disabled={!text.smaller}
                className="size-7 justify-center p-0"
                onSelect={(e) => {
                  e.preventDefault();
                  text.smaller?.();
                }}
              >
                <Minus />
              </DropdownMenuItem>
              <span className="w-6 text-center text-xs text-muted-foreground tabular-nums">
                {text.size}
              </span>
              <DropdownMenuItem
                aria-label="Larger text"
                disabled={!text.larger}
                className="size-7 justify-center p-0"
                onSelect={(e) => {
                  e.preventDefault();
                  text.larger?.();
                }}
              >
                <Plus />
              </DropdownMenuItem>
            </div>
            <DropdownMenuSeparator />
          </>
        )}
        {source && (source.originalUrl || downloads.length > 0) && (
          <>
            {source.originalUrl && (
              <DropdownMenuItem asChild>
                <a href={source.originalUrl} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Open original
                </a>
              </DropdownMenuItem>
            )}
            {downloads.map(({ label, start }) => (
              <DropdownMenuItem
                key={label}
                disabled={saving}
                onSelect={() => save(source.title, start)}
              >
                <Download />
                {label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem disabled={!onUpload} onSelect={onUpload}>
          <Upload />
          Upload file
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onHide}>
          <PanelRightClose />
          Hide notes
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
