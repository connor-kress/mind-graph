import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { followNoteLink } from "./followNoteLink";

type Props = {
  children: string;
  /** The note's own images by name, which it links to as `asset:<name>`. */
  assets?: Record<string, string | null>;
};

const ASSET = "asset:";

/** A note's Markdown, with GitHub tables and lists, KaTeX math, and the note's own images. */
export function Markdown({ children, assets = {} }: Props) {
  return (
    <div className="note-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        // Limits keep a note's math from freezing the page with huge or recursive macros.
        rehypePlugins={[
          [rehypeKatex, { throwOnError: false, strict: "ignore", maxSize: 20, maxExpand: 500 }],
        ]}
        // Notes come from uploads; raw HTML could run scripts or load anything.
        skipHtml
        // Kept as written for images only; `img` looks it up.
        urlTransform={(url, key) =>
          key === "src" && url.startsWith(ASSET) ? url : defaultUrlTransform(url)
        }
        components={{
          a: (props) => {
            const attributes = { ...props, node: undefined };
            if (!props.href?.startsWith("#"))
              return <a {...attributes} target="_blank" rel="noreferrer" />;
            return <a {...attributes} onClick={(e) => followNoteLink(e, props.href!)} />;
          },
          img: ({ alt, src }) => {
            const url =
              typeof src === "string" &&
              src.startsWith(ASSET) &&
              Object.hasOwn(assets, src.slice(ASSET.length))
                ? assets[src.slice(ASSET.length)]
                : null;
            // Images outside the note's own would make requests to arbitrary sites.
            if (!url) return <span className="text-muted-foreground/70">[{alt || "Image"}]</span>;
            return <img src={url} alt={alt ?? ""} loading="lazy" />;
          },
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
