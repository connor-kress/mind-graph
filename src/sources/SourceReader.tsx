import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ScrollArea } from "../components/ui/scroll-area";
import { Skeleton } from "../components/ui/skeleton";
import { Markdown } from "./Markdown";

type Props = { sourceId: Id<"sources">; textSize: number };

type Content = { url: string; text?: string; failed?: boolean };

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

/** A source's note, or why it can't be read yet. */
export function SourceReader({ sourceId, textSize }: Props) {
  const source = useQuery(api.sources.open, { sourceId });
  const retry = useMutation(api.sources.retry);
  const [retryError, setRetryError] = useState<string | null>(null);
  const { content, reload } = useContent(source?.markdownUrl ?? null);

  let body;
  if (!source) body = <Loading />;
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
  } else if (!content) body = <Loading />;
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
        <div className="p-5" style={{ fontSize: textSize }}>
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

  return body;
}

function Loading() {
  return (
    <div role="status" aria-label="Loading note" className="space-y-3 p-5">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-4/5" />
    </div>
  );
}

function Message({ children }: { children: ReactNode }) {
  return (
    <p className="px-7 py-10 text-center text-sm leading-6 text-muted-foreground">{children}</p>
  );
}
