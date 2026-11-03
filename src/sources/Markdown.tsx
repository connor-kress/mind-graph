import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { followNoteLink } from "./followNoteLink";

/** A note's Markdown, with GitHub tables and lists, and KaTeX math. */
export function Markdown({ children }: { children: string }) {
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
        components={{
          a: (props) => {
            const attributes = { ...props, node: undefined };
            if (!props.href?.startsWith("#"))
              return <a {...attributes} target="_blank" rel="noreferrer" />;
            return <a {...attributes} onClick={(e) => followNoteLink(e, props.href!)} />;
          },
          // Images outside the note's own would make requests to arbitrary sites.
          img: ({ alt }) => <span className="text-muted-foreground/70">[{alt || "Image"}]</span>,
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
