import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { ChevronLeft, ExternalLink, Minus, Plus } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import { Markdown } from "./Markdown";

type Props = { sourceId: Id<"sources">; onClose: () => void };

type Content = { url: string; text?: string; failed?: boolean };

const TEXT_SIZE_STORAGE_KEY = "mind-graph:source-text-size";
/** Reading sizes in pixels; 14 matches the rest of the panel. */
const TEXT_SIZES = [12, 14, 16, 18, 20, 24];
const DEFAULT_TEXT_SIZE = 14;

/** The reader's text size, remembered across sources and visits. */
function useTextSize() {
  const [size, setSize] = useState(() => {
    const stored = Number(localStorage.getItem(TEXT_SIZE_STORAGE_KEY));
    return TEXT_SIZES.includes(stored) ? stored : DEFAULT_TEXT_SIZE;
  });
  useEffect(() => localStorage.setItem(TEXT_SIZE_STORAGE_KEY, String(size)), [size]);
  const index = TEXT_SIZES.indexOf(size);
  return {
    size,
    smaller: index > 0 ? () => setSize(TEXT_SIZES[index - 1]) : undefined,
    larger: index < TEXT_SIZES.length - 1 ? () => setSize(TEXT_SIZES[index + 1]) : undefined,
  };
}

/** The note's text at a URL. Stored files never change, so each is fetched once, unless it failed. */
function useContent(url: string | null) {
  const [content, setContent] = useState<Content | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`Status ${response.status}`);
        return response.text();
      })
      .then(
        (text) => !cancelled && setContent({ url, text }),
        (error) => {
          console.error(error);
          if (!cancelled) setContent({ url, failed: true });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [url, attempt]);
  const reload = () => {
    setContent(null);
    setAttempt((n) => n + 1);
  };
  return { content: content?.url === url ? content : null, reload };
}

/** A source's note, and a link to the original file it was transcribed from. */
export function SourceReader({ sourceId, onClose }: Props) {
  const source = useQuery(api.sources.open, { sourceId });
  const retry = useMutation(api.sources.retry);
  const [retryError, setRetryError] = useState<string | null>(null);
  const { content, reload } = useContent(source?.markdownUrl ?? null);
  const text = useTextSize();

  // Deleted, here or elsewhere.
  useEffect(() => {
    if (source === null) onClose();
  }, [source, onClose]);

  let body;
  if (!source) body = null;
  else if (source.status === "queued") body = <Message>Waiting to be transcribed…</Message>;
  else if (source.status === "processing") body = <Message>Transcribing…</Message>;
  else if (source.status === "failed") {
    body = (
      <Message>
        {source.error ?? "Couldn't transcribe this file."}{" "}
        <button
          type="button"
          className="font-medium text-foreground underline underline-offset-4"
          onClick={() => {
            setRetryError(null);
            retry({ sourceId }).catch((error) => {
              console.error(error);
              setRetryError(
                error instanceof ConvexError
                  ? String(error.data)
                  : "Couldn't try again. Check your connection.",
              );
            });
          }}
        >
          Try again
        </button>
        {retryError && (
          <span role="alert" className="mt-2 block text-destructive">
            {retryError}
          </span>
        )}
      </Message>
    );
  } else if (!source.markdownUrl) {
    body = <Message>Couldn't load the note.</Message>;
  } else if (!content) body = null;
  else if (content.text === undefined) {
    body = (
      <Message>
        Couldn't load the note.{" "}
        <button
          type="button"
          className="font-medium text-foreground underline underline-offset-4"
          onClick={reload}
        >
          Try again
        </button>
      </Message>
    );
  } else if (!content.text.trim()) body = <Message>This note is empty.</Message>;
  else {
    body = (
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-5" style={{ fontSize: text.size }}>
          {source.kind === "txt" ? (
            // Plain text isn't Markdown, so show it as written.
            <p className="leading-[2] whitespace-pre-wrap text-muted-foreground">{content.text}</p>
          ) : (
            <Markdown assets={source.assetUrls}>{content.text}</Markdown>
          )}
        </div>
      </ScrollArea>
    );
  }

  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
        <Button variant="ghost" size="icon-xs" aria-label="Back to files" onClick={onClose}>
          <ChevronLeft />
        </Button>
        <h3
          className="min-w-0 flex-1 truncate text-xs font-medium"
          title={source ? `${source.title}\n${source.name}` : undefined}
        >
          {source?.title}
        </h3>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Smaller text"
          title="Smaller text"
          disabled={!text.smaller}
          onClick={text.smaller}
        >
          <Minus />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Larger text"
          title="Larger text"
          disabled={!text.larger}
          onClick={text.larger}
        >
          <Plus />
        </Button>
        {source?.originalUrl && (
          <Button variant="ghost" size="xs" asChild>
            <a href={source.originalUrl} target="_blank" rel="noreferrer">
              Open original
              <ExternalLink data-icon="inline-end" />
            </a>
          </Button>
        )}
      </div>
      {body}
    </>
  );
}

function Message({ children }: { children: ReactNode }) {
  return (
    <p className="px-7 py-10 text-center text-sm leading-6 text-muted-foreground">{children}</p>
  );
}
