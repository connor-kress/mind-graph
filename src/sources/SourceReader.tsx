import { useMutation, useQuery } from "convex/react";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { Block, ListItem } from "../../convex/model";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";

type Props = { sourceId: Id<"sources">; onClose: () => void };

type Content = { url: string; blocks?: Block[]; failed?: boolean };

/** The extracted blocks at a URL. Content files never change, so each is fetched once. */
function useContent(url: string | null) {
  const [content, setContent] = useState<Content | null>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`Status ${response.status}`);
        return response.json() as Promise<Block[]>;
      })
      .then(
        (blocks) => !cancelled && setContent({ url, blocks }),
        (error) => {
          console.error(error);
          if (!cancelled) setContent({ url, failed: true });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [url]);
  return content?.url === url ? content : null;
}

/** A source's text with its headings, and a link to the original file. */
export function SourceReader({ sourceId, onClose }: Props) {
  const source = useQuery(api.sources.open, { sourceId });
  const retry = useMutation(api.sources.retry);
  const content = useContent(source?.contentUrl ?? null);

  // Deleted, here or elsewhere.
  useEffect(() => {
    if (source === null) onClose();
  }, [source, onClose]);

  let body;
  if (!source) body = null;
  else if (source.status === "processing") body = <Message>Reading the file…</Message>;
  else if (source.status === "failed") {
    body = (
      <Message>
        Couldn't read this file.{" "}
        <button
          type="button"
          className="font-medium text-foreground underline underline-offset-4"
          onClick={() => retry({ sourceId }).catch(console.error)}
        >
          Try again
        </button>
      </Message>
    );
  } else if (!source.contentUrl) {
    body = (
      <Message>
        A preview isn't available for {source.kind.toUpperCase()} files yet. Open the original to
        read it.
      </Message>
    );
  } else if (!content) body = null;
  else if (!content.blocks) body = <Message>Couldn't load the text.</Message>;
  else if (!content.blocks.length) body = <Message>No text found in this file.</Message>;
  else {
    body = (
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-5 text-sm leading-7 text-muted-foreground">
          {content.blocks.map((block, i) => (
            <BlockView key={i} block={block} />
          ))}
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
        <h3 className="min-w-0 flex-1 truncate text-xs font-medium" title={source?.name}>
          {source?.name}
        </h3>
        {source?.url && (
          <Button variant="ghost" size="xs" asChild>
            <a href={source.url} target="_blank" rel="noreferrer">
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

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "heading": {
      // Below the panel's h2 and the file name's h3.
      const Tag = `h${Math.min(block.level + 3, 6)}` as "h4";
      return (
        <Tag
          className={`pt-1 font-semibold leading-6 text-foreground ${block.level === 1 ? "text-base" : ""}`}
        >
          {block.text}
        </Tag>
      );
    }
    case "paragraph":
      return <p className="whitespace-pre-line">{block.text}</p>;
    case "list":
      return <List ordered={block.ordered} items={block.items} />;
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="text-xs">
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className="border px-2 py-1 align-top">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function List({ ordered, items }: { ordered: boolean; items: ListItem[] }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={`space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>
      {items.map((item, i) => (
        <li key={i}>
          {item.text}
          {item.items && (
            <div className="mt-1">
              <List ordered={ordered} items={item.items} />
            </div>
          )}
        </li>
      ))}
    </Tag>
  );
}
