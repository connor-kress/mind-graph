/// <reference types="node" />
"use node";

import { unzipSync } from "fflate";
import { HTMLElement, parse, type Node } from "node-html-parser";
import { nestItems, type Block } from "./model";

type Paragraph = { text: string; level: number; bullet: "none" | "bullet" | "number" };

/** A PowerPoint file's slides in order: titles become headings, bullets become lists. */
export function slideBlocks(bytes: Uint8Array) {
  const files = unzipSync(bytes);
  const xml = (path: string) => {
    const file = files[path];
    if (!file) throw new Error(`${path} missing from the presentation`);
    return parse(new TextDecoder().decode(file), { lowerCaseTagName: false });
  };

  // The slide list names each slide by relationship id; the relationships give its file.
  const targets = new Map(
    descendants(xml("ppt/_rels/presentation.xml.rels"), "Relationship").map((rel) => [
      rel.getAttribute("Id"),
      rel.getAttribute("Target") ?? "",
    ]),
  );
  const slidePaths = descendants(xml("ppt/presentation.xml"), "p:sldId").map((slide) => {
    const target = targets.get(slide.getAttribute("r:id")) ?? "";
    return target.startsWith("/") ? target.slice(1) : `ppt/${target}`;
  });

  const blocks = slidePaths.flatMap((path, i) =>
    shapeBlocks(descendants(xml(path), "p:spTree")[0]?.childNodes ?? []).map((block): Block => ({
      ...block,
      page: i + 1,
    })),
  );
  return { blocks, pageCount: slidePaths.length };
}

const tagOf = (node: Node) => (node instanceof HTMLElement ? node.rawTagName : "");

const childrenNamed = (node: Node, tag: string) =>
  node.childNodes.filter((child): child is HTMLElement => tagOf(child) === tag);

function descendants(node: Node, tag: string): HTMLElement[] {
  return node.childNodes.flatMap((child) =>
    tagOf(child) === tag ? [child as HTMLElement] : descendants(child, tag),
  );
}

/** Placeholders that repeat on every slide rather than carrying its content. */
const SKIPPED_PLACEHOLDERS = new Set(["dt", "ftr", "sldNum", "hdr"]);

/** Shapes in the order they're drawn, which is usually reading order. */
function shapeBlocks(shapes: Node[]): Block[] {
  return shapes.flatMap((shape): Block[] => {
    switch (tagOf(shape)) {
      case "p:grpSp":
        return shapeBlocks(shape.childNodes);
      case "p:graphicFrame":
        return descendants(shape, "a:tbl").map((table) => ({
          type: "table",
          rows: descendants(table, "a:tr").map((row) =>
            childrenNamed(row, "a:tc").map((cell) =>
              descendants(cell, "a:p").map(paragraphText).filter(Boolean).join(" "),
            ),
          ),
        }));
      case "p:sp": {
        const placeholder = descendants(shape, "p:ph")[0];
        // A placeholder without a type is a body.
        const role = placeholder ? (placeholder.getAttribute("type") ?? "body") : "text";
        if (SKIPPED_PLACEHOLDERS.has(role)) return [];
        const paragraphs = descendants(shape, "p:txBody")
          .flatMap((body) => childrenNamed(body, "a:p"))
          .map((p) => paragraphOf(p, role === "body" || role === "obj"))
          .filter((p) => p.text);
        if (role === "title" || role === "ctrTitle") {
          const text = paragraphs.map((p) => p.text).join(" ");
          return text ? [{ type: "heading", level: role === "ctrTitle" ? 1 : 2, text }] : [];
        }
        return textBlocks(paragraphs);
      }
      default:
        return [];
    }
  });
}

function paragraphText(p: Node) {
  return p.childNodes
    .map((run) => {
      const tag = tagOf(run);
      if (tag === "a:br") return " ";
      return tag === "a:r" || tag === "a:fld" ? (childrenNamed(run, "a:t")[0]?.text ?? "") : "";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Body placeholders are bulleted unless a paragraph says otherwise; other text isn't. */
function paragraphOf(p: HTMLElement, bulletedByDefault: boolean): Paragraph {
  const props = childrenNamed(p, "a:pPr")[0];
  const has = (tag: string) => !!props && childrenNamed(props, tag).length > 0;
  let bullet: Paragraph["bullet"] = bulletedByDefault ? "bullet" : "none";
  if (has("a:buNone")) bullet = "none";
  else if (has("a:buAutoNum")) bullet = "number";
  else if (has("a:buChar") || has("a:buBlip")) bullet = "bullet";
  return { text: paragraphText(p), level: Number(props?.getAttribute("lvl") ?? 0), bullet };
}

/** Runs of bulleted paragraphs become lists, nested by indent level. */
function textBlocks(paragraphs: Paragraph[]): Block[] {
  const blocks: Block[] = [];
  for (let i = 0; i < paragraphs.length;) {
    const { bullet, text } = paragraphs[i];
    if (bullet === "none") {
      blocks.push({ type: "paragraph", text });
      i++;
      continue;
    }
    let end = i;
    while (end < paragraphs.length && paragraphs[end].bullet !== "none") end++;
    blocks.push({
      type: "list",
      ordered: bullet === "number",
      items: nestItems(paragraphs.slice(i, end)),
    });
    i = end;
  }
  return blocks;
}
