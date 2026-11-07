import type { Element, Root, RootContent } from "hast";
import { toJsxRuntime, type Components } from "hast-util-to-jsx-runtime";
import { urlAttributes } from "html-url-attributes";
import { Fragment, type ReactNode } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { followNoteLink } from "./followNoteLink";

export type NoteAssets = Record<string, string | null>;

const ASSET = "asset:";

// Notes come from uploads, and raw HTML could run scripts or load anything. By
// default, Markdown's raw HTML doesn't make it through to the result.
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkRehype).freeze();

// Limits keep a note's math from freezing the page with huge or recursive macros.
const typesetter = unified()
  .use(rehypeKatex, { strict: "ignore", maxSize: 20, maxExpand: 500 })
  .freeze();

/** Splits a note into blocks to render one at a time. Parsing is quick; typesetting isn't. */
export function noteBlocks(markdown: string): RootContent[] {
  const tree = parser.runSync(parser.parse(markdown)) as Root;
  return tree.children.filter((block) => block.type !== "text" || block.value.trim());
}

/** Only safe addresses survive, besides the images that `img` looks up. */
function withSafeUrls(tree: Root) {
  visit(tree, "element", (element: Element) => {
    for (const [attribute, elements] of Object.entries(urlAttributes)) {
      if (!Object.hasOwn(element.properties, attribute)) continue;
      if (elements && !elements.includes(element.tagName)) continue;
      const url = String(element.properties[attribute] ?? "");
      element.properties[attribute] =
        attribute === "src" && url.startsWith(ASSET) ? url : defaultUrlTransform(url);
    }
  });
}

function componentsFor(assets: NoteAssets): Partial<Components> {
  return {
    a: (props) => {
      if (!props.href?.startsWith("#")) return <a {...props} target="_blank" rel="noreferrer" />;
      return <a {...props} onClick={(e) => followNoteLink(e, props.href!)} />;
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
  };
}

/** One block of a note, with GitHub tables and lists, KaTeX math, and the note's own images. */
export function renderBlock(block: RootContent, assets: NoteAssets): ReactNode {
  const tree = typesetter.runSync({ type: "root", children: [block] }) as Root;
  withSafeUrls(tree);
  return toJsxRuntime(tree, {
    Fragment,
    jsx,
    jsxs,
    ignoreInvalidStyle: true,
    passKeys: true,
    components: componentsFor(assets),
  });
}
