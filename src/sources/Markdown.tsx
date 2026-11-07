import "katex/dist/katex.min.css";
import { Fragment, memo, useEffect, useState, type ReactNode } from "react";
import { noteBlocks, renderBlock, type NoteAssets } from "./noteBlocks";

type Props = {
  children: string;
  /** The note's own images by name, which it links to as `asset:<name>`. */
  assets?: NoteAssets;
  /** Shown until the start of the note is ready. */
  placeholder?: ReactNode;
};

/** How long to render for at a time, leaving the page free to respond in between. */
const BATCH_MS = 8;

const NO_ASSETS: NoteAssets = {};

const sameAssets = (a: NoteAssets, b: NoteAssets) => {
  const names = Object.keys(a);
  return names.length === Object.keys(b).length && names.every((name) => a[name] === b[name]);
};

/**
 * A note's Markdown. Typesetting a whole note takes long enough to freeze the page,
 * so it appears a little at a time from the start, and only once per note.
 */
export const Markdown = memo(
  function Markdown({ children, assets = NO_ASSETS, placeholder }: Props) {
    const [progress, setProgress] = useState<{ shown: ReactNode[]; failed: boolean } | null>(null);
    useEffect(() => {
      let timer: ReturnType<typeof setTimeout>;
      let blocks: ReturnType<typeof noteBlocks> | undefined;
      const rendered: ReactNode[] = [];
      const renderSome = () => {
        try {
          blocks ??= noteBlocks(children);
          const until = performance.now() + BATCH_MS;
          while (rendered.length < blocks.length && performance.now() < until) {
            const index = rendered.length;
            rendered.push(<Fragment key={index}>{renderBlock(blocks[index], assets)}</Fragment>);
          }
          setProgress({ shown: [...rendered], failed: false });
          if (rendered.length < blocks.length) timer = setTimeout(renderSome);
        } catch (error) {
          // Outside of rendering, so nothing else would hear of it. Extreme nesting can do this.
          console.error(error);
          setProgress({ shown: [...rendered], failed: true });
        }
      };
      timer = setTimeout(renderSome);
      return () => clearTimeout(timer);
    }, [children, assets]);
    if (!progress) return placeholder;
    const { shown, failed } = progress;
    return (
      <div className="note-markdown">
        {shown}
        {failed && <p>Couldn't show {shown.length ? "the rest of " : ""}this note.</p>}
        {!failed && !shown.length && <p>This note is empty.</p>}
      </div>
    );
  },
  (a, b) => a.children === b.children && sameAssets(a.assets ?? NO_ASSETS, b.assets ?? NO_ASSETS),
);
