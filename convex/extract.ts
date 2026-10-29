/// <reference types="node" />
"use node";

import { v } from "convex/values";
import mammoth from "mammoth";
import type { List, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toString } from "mdast-util-to-string";
import { gfm } from "micromark-extension-gfm";
import { HTMLElement, parse, type Node } from "node-html-parser";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { pdfBlocks } from "./extractPdf";
import { slideBlocks } from "./extractSlides";
import type { Block, ListItem, SourceKind } from "./model";

/** Extracts a source's text, keeping its headings and lists, and stores it as JSON. */
export const run = internalAction({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    const source = await ctx.runQuery(internal.sources.forExtraction, { sourceId });
    if (!source) return;
    let contentId, pageCount;
    try {
      const file = await ctx.storage.get(source.storageId);
      if (!file) throw new Error("File missing from storage");
      const content = await extract(source.kind, file);
      const json = new Blob([JSON.stringify(content.blocks)], { type: "application/json" });
      contentId = await ctx.storage.store(json);
      pageCount = content.pageCount;
    } catch (error) {
      console.error(`Couldn't extract source ${sourceId}`, error);
      await ctx.runMutation(internal.sources.finish, { sourceId, failed: true });
      return;
    }
    await ctx.runMutation(internal.sources.finish, {
      sourceId,
      failed: false,
      contentId,
      pageCount,
    });
  },
});

/** A file's blocks, and its number of pages or slides if it has them. */
async function extract(
  kind: SourceKind,
  file: Blob,
): Promise<{ blocks: Block[]; pageCount?: number }> {
  switch (kind) {
    case "md": {
      // With GitHub's extensions, for tables.
      const tree = fromMarkdown(await file.text(), {
        extensions: [gfm()],
        mdastExtensions: [gfmFromMarkdown()],
      });
      return { blocks: fromMdast(tree.children) };
    }
    case "txt": {
      const blocks: Block[] = (await file.text())
        .replace(/\r\n?/g, "\n")
        .split(/\n\s*\n/)
        .map((text) => text.trim())
        .filter(Boolean)
        .map((text) => ({ type: "paragraph", text }));
      return { blocks };
    }
    case "docx": {
      // Mammoth maps Word's heading styles to <h1>–<h6>.
      const buffer = Buffer.from(await file.arrayBuffer());
      const { value } = await mammoth.convertToHtml({ buffer });
      return { blocks: fromHtml(parse(value).childNodes) };
    }
    case "pdf":
      return pdfBlocks(new Uint8Array(await file.arrayBuffer()));
    case "pptx":
      return slideBlocks(new Uint8Array(await file.arrayBuffer()));
  }
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

function fromMdast(nodes: RootContent[]): Block[] {
  return nodes.flatMap((node): Block[] => {
    switch (node.type) {
      case "heading":
        return [{ type: "heading", level: node.depth, text: clean(toString(node)) }];
      case "paragraph": {
        const text = clean(toString(node));
        return text ? [{ type: "paragraph", text }] : [];
      }
      case "code":
        return [{ type: "paragraph", text: node.value }];
      case "blockquote":
        return fromMdast(node.children);
      case "list":
        return [{ type: "list", ordered: !!node.ordered, items: mdastItems(node) }];
      case "table":
        return [
          {
            type: "table",
            rows: node.children.map((row) => row.children.map((cell) => clean(toString(cell)))),
          },
        ];
      default:
        return [];
    }
  });
}

function mdastItems(list: List): ListItem[] {
  return list.children.map((item) => {
    const isList = (node: RootContent): node is List => node.type === "list";
    const text = clean(
      item.children
        .filter((node) => !isList(node))
        .map((node) => toString(node))
        .join(" "),
    );
    const items = item.children.filter(isList).flatMap(mdastItems);
    return items.length ? { text, items } : { text };
  });
}

const tagOf = (node: Node) => (node instanceof HTMLElement ? node.rawTagName?.toLowerCase() : "");

const isHtmlList = (node: Node): node is HTMLElement => /^[ou]l$/.test(tagOf(node));

function fromHtml(nodes: Node[]): Block[] {
  return nodes.flatMap((node): Block[] => {
    if (!(node instanceof HTMLElement)) return [];
    const tag = tagOf(node);
    const heading = /^h([1-6])$/.exec(tag);
    if (heading) return [{ type: "heading", level: Number(heading[1]), text: clean(node.text) }];
    switch (tag) {
      case "p": {
        const text = clean(node.text);
        return text ? [{ type: "paragraph", text }] : [];
      }
      case "ul":
      case "ol":
        return [{ type: "list", ordered: tag === "ol", items: htmlItems(node) }];
      case "table":
        return [
          {
            type: "table",
            rows: node
              .querySelectorAll("tr")
              .map((row) =>
                row.childNodes
                  .filter((cell) => /^t[dh]$/.test(tagOf(cell)))
                  .map((cell) => clean(cell.text)),
              ),
          },
        ];
      default:
        return fromHtml(node.childNodes);
    }
  });
}

function htmlItems(list: HTMLElement): ListItem[] {
  return list.childNodes
    .filter((node) => tagOf(node) === "li")
    .map((item) => {
      const text = clean(
        item.childNodes
          .filter((node) => !isHtmlList(node))
          .map((node) => node.text)
          .join(""),
      );
      const items = item.childNodes.filter(isHtmlList).flatMap(htmlItems);
      return items.length ? { text, items } : { text };
    });
}
