/// <reference types="node" />
"use node";

import { getDocumentProxy } from "unpdf";
import { nestItems, type Block } from "./model";

type Line = { text: string; size: number; bold: boolean; x: number; y: number; page: number };

type Part = { text: string; size: number; bold: boolean; x: number; y: number; end: number };

/** The parts of PDF.js's text items that are used. */
type TextItem = {
  str: string;
  transform: number[];
  width: number;
  fontName: string;
  hasEOL: boolean;
};

type Draft =
  | { type: "heading"; level: number; text: string; page: number }
  | { type: "paragraph"; text: string; page: number }
  | { type: "list"; ordered: boolean; entries: { text: string; level: number }[]; page: number };

/**
 * A PDF's text, with headings recognized by font: sizes above the body text's
 * become heading levels, as do whole lines in bold. A PDF without text (e.g. a
 * scan) has no blocks.
 */
export async function pdfBlocks(bytes: Uint8Array) {
  const pdf = await getDocumentProxy(bytes, { fontExtraProperties: true });
  try {
    const lines: Line[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const items = (await page.getTextContent()).items.filter((item) => "str" in item);
      if (!items.some((item) => item.str.trim())) continue;
      // Loads the page's fonts, so their weight is known.
      await page.getOperatorList();
      const bold = new Map<string, boolean>();
      const isBold = (id: string) => {
        if (!bold.has(id)) bold.set(id, fontIsBold(page.commonObjs, id));
        return bold.get(id)!;
      };
      lines.push(...withoutNoise(linesOf(items, isBold, n)));
      page.cleanup();
    }
    return { blocks: blocksOf(lines), pageCount: pdf.numPages };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

function fontIsBold(objs: { has(id: string): boolean; get(id: string): unknown }, id: string) {
  if (!objs.has(id)) return false;
  const font = objs.get(id) as { bold?: boolean; black?: boolean; name?: string };
  // Embedded fonts only say so in their name, e.g. "Arial-BoldMT" or "NimbusRomNo9L-Medi".
  return !!(font.bold || font.black) || /bold|black|heavy|demi|medi/i.test(font.name ?? "");
}

/** Joins text items into lines, breaking where the text moves to a new baseline. */
function linesOf(items: TextItem[], isBold: (font: string) => boolean, page: number): Line[] {
  const lines: Line[] = [];
  let parts: Part[] = [];
  const flush = () => {
    const text = parts
      .map((part) => part.text)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (text) {
      // The style of most of the line.
      const main = parts.reduce((a, b) => (b.text.trim().length > a.text.trim().length ? b : a));
      lines.push({
        text,
        size: main.size,
        bold: parts.every((part) => part.bold || !part.text.trim()),
        x: parts[0].x,
        y: parts[0].y,
        page,
      });
    }
    parts = [];
  };

  let endOfLine = false;
  for (const item of items) {
    if (!item.str) {
      endOfLine ||= item.hasEOL;
      continue;
    }
    const [a, b, c, d, x, y] = item.transform;
    // Rotated text, e.g. a margin stamp, isn't part of the reading order.
    if (Math.abs(b) > Math.abs(a) / 10) continue;
    const size = Math.hypot(c, d);
    const first = parts[0];
    const last = parts[parts.length - 1];
    if (
      first &&
      (endOfLine || Math.abs(y - first.y) > Math.max(size, first.size) / 2 || x < last.end - size)
    ) {
      flush();
    }
    let text = item.str;
    const touching = !last || x - last.end < size * 0.15;
    if (!touching && !/\s$/.test(last.text) && !/^\s/.test(text)) text = ` ${text}`;
    parts.push({ text, size, bold: isBold(item.fontName), x, y, end: x + item.width });
    endOfLine = item.hasEOL;
  }
  flush();
  return lines;
}

const PAGE_NUMBER = /^page\s+\d+(\s*(of|\/)\s*\d+)?$/i;

/** Drops lines without words, e.g. page numbers and chart labels, and "Page 2" at a page's edge. */
function withoutNoise(lines: Line[]) {
  return lines.filter(
    (line, i) =>
      /\p{L}/u.test(line.text) &&
      !(PAGE_NUMBER.test(line.text) && (i === 0 || i === lines.length - 1)),
  );
}

// Bullets, including symbol fonts' private-use glyphs, and numbers like "1.".
const LIST_MARKER = /^([•◦▪▫●○■□‣⁃∙·*+\-–\uf000-\uf0ff]|\d{1,2}[.)])\s+/;

const rounded = (size: number) => Math.round(size * 2) / 2;

const isHeadingText = (text: string) => /\p{L}/u.test(text) && text.length <= 200;

/** Glues a line onto the text before it, rejoining words hyphenated across lines. */
function join(text: string, line: string) {
  if (/\p{L}-$/u.test(text) && /^\p{Ll}/u.test(line)) return text.slice(0, -1) + line;
  return `${text} ${line}`;
}

function blocksOf(lines: Line[]): Block[] {
  // The body size is the one most of the text is set in.
  const chars = new Map<number, number>();
  for (const line of lines) {
    const size = rounded(line.size);
    chars.set(size, (chars.get(size) ?? 0) + line.text.length);
  }
  const body = [...chars].reduce((a, b) => (b[1] > a[1] ? b : a), [0, 0])[0];
  const isLarge = (line: Line) => rounded(line.size) >= body * 1.2;
  const headingSizes = [
    ...new Set(
      lines.filter((l) => isLarge(l) && isHeadingText(l.text)).map((l) => rounded(l.size)),
    ),
  ].sort((a, b) => b - a);
  const levels = Math.min(headingSizes.length, 3);
  const spacing = lineSpacing(lines);
  const headingLevel = (line: Line) => {
    if (!isHeadingText(line.text)) return 0;
    if (isLarge(line)) return Math.min(headingSizes.indexOf(rounded(line.size)), 2) + 1;
    return line.bold && rounded(line.size) >= body ? levels + 1 : 0;
  };

  const drafts: Draft[] = [];
  let prev: { line: Line; level: number } | undefined;
  for (const line of lines) {
    const level = headingLevel(line);
    const marker = level ? null : LIST_MARKER.exec(line.text);
    const last = drafts[drafts.length - 1];
    const gap = prev?.line.page === line.page ? prev.line.y - line.y : -1;
    // Within a paragraph, lines are about as far apart as most lines of their size.
    const size = Math.max(line.size, prev?.line.size ?? 0);
    const close = gap > 0 && gap < Math.max(size * 1.4, (spacing.get(rounded(size)) ?? 0) * 1.15);
    if (level) {
      if (last?.type === "heading" && prev?.level === level && close) last.text += ` ${line.text}`;
      else drafts.push({ type: "heading", level, text: line.text, page: line.page });
    } else if (marker) {
      const ordered = /\d/.test(marker[1]);
      const entry = { text: line.text.slice(marker[0].length), level: Math.round(line.x) };
      if (last?.type === "list" && last.ordered === ordered) last.entries.push(entry);
      else drafts.push({ type: "list", ordered, entries: [entry], page: line.page });
    } else if (
      last?.type === "list" &&
      close &&
      // A wrapped list item, indented past its marker.
      line.x > last.entries[last.entries.length - 1].level + 1
    ) {
      const entry = last.entries[last.entries.length - 1];
      entry.text = join(entry.text, line.text);
    } else if (
      last?.type === "paragraph" &&
      !prev?.level &&
      // An indented first line starts a paragraph.
      ((close && line.x - prev!.line.x < line.size) ||
        // Mid-sentence, continued in the next column or on the next page.
        (/[^.!?:]$/.test(last.text) && /^\p{Ll}/u.test(line.text)))
    ) {
      last.text = join(last.text, line.text);
    } else {
      drafts.push({ type: "paragraph", text: line.text, page: line.page });
    }
    prev = { line, level };
  }

  return drafts.map((draft): Block => {
    if (draft.type !== "list") return draft;
    const { ordered, entries, page } = draft;
    return { type: "list", ordered, items: nestItems(entries), page };
  });
}

/** The most common distance between the baselines of consecutive lines, by text size. */
function lineSpacing(lines: Line[]) {
  const counts = new Map<number, Map<number, number>>();
  for (let i = 1; i < lines.length; i++) {
    const [above, line] = [lines[i - 1], lines[i]];
    const size = rounded(line.size);
    const gap = rounded(above.y - line.y);
    if (above.page !== line.page || rounded(above.size) !== size) continue;
    if (gap <= 0 || gap > size * 3) continue;
    const gaps = counts.get(size) ?? new Map<number, number>();
    gaps.set(gap, (gaps.get(gap) ?? 0) + 1);
    counts.set(size, gaps);
  }
  return new Map(
    [...counts].map(([size, gaps]) => [size, [...gaps].reduce((a, b) => (b[1] > a[1] ? b : a))[0]]),
  );
}
