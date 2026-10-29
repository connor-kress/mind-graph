import { useMutation, useQuery } from "convex/react";
import { AArrowDown, AArrowUp, ChevronLeft, ExternalLink } from "lucide-react";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { Block, ListItem } from "../../convex/model";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";

type Props = { sourceId: Id<"sources">; onClose: () => void };

type Content = { url: string; blocks?: Block[]; failed?: boolean };

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
  const text = useTextSize();

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
    // Added before files of its kind could be read.
    body = (
      <Message>
        This file hasn't been read yet.{" "}
        <button
          type="button"
          className="font-medium text-foreground underline underline-offset-4"
          onClick={() => retry({ sourceId }).catch(console.error)}
        >
          Read it now
        </button>
      </Message>
    );
  } else if (!content) body = null;
  else if (!content.blocks) body = <Message>Couldn't load the text.</Message>;
  else if (!content.blocks.length) {
    body = (
      <Message>
        {source.kind === "pdf"
          ? "This PDF has no text to show. It may be a scan; open the original to read it."
          : "No text found in this file."}
      </Message>
    );
  } else {
    const unit = source.kind === "pptx" ? "Slide" : "Page";
    body = (
      <ScrollArea className="min-h-0 flex-1">
        {/* Sizes inside are in em, so they follow the chosen text size. */}
        <div
          className="space-y-[1.15em] p-5 leading-[2] text-muted-foreground"
          style={{ fontSize: text.size }}
        >
          {content.blocks.map((block, i) => (
            <Fragment key={i}>
              {block.page && block.page !== content.blocks?.[i - 1]?.page && (
                <PageLabel>
                  {unit} {block.page}
                </PageLabel>
              )}
              <BlockView block={block} />
            </Fragment>
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
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Smaller text"
          title="Smaller text"
          disabled={!text.smaller}
          onClick={text.smaller}
        >
          <AArrowDown />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Larger text"
          title="Larger text"
          disabled={!text.larger}
          onClick={text.larger}
        >
          <AArrowUp />
        </Button>
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

function PageLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-2 text-[0.8em] font-medium uppercase tracking-wide text-muted-foreground/70 first:pt-0">
      {children}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "heading": {
      // Below the panel's h2 and the file name's h3.
      const Tag = `h${Math.min(block.level + 3, 6)}` as "h4";
      return (
        <Tag
          className={`pt-1 font-semibold leading-[1.7] text-foreground ${block.level === 1 ? "text-[1.15em]" : ""}`}
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
          <table className="text-[0.85em]">
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
