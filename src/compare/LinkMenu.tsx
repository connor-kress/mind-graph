import { useLayoutEffect, useRef } from "react";
import { StatusBadge } from "./StatusBadge";

type Props = {
  /** Where the menu hangs from, in screen coordinates (below the target). */
  anchor: { x: number; y: number };
  answer: string;
  target: string;
  /** Whether the dropped node is under a different parent than the target. */
  misplaced: boolean;
  onChoose: (correct: boolean) => void;
  onCancel: () => void;
};

/**
 * Asks how a node dropped onto a missed one should count. Marking it correct
 * is focused, so Enter picks it; Tab moves to the other option.
 */
export function LinkMenu({ anchor, answer, target, misplaced, onChoose, onCancel }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);

  // Center the menu below the anchor, inside the canvas.
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    const box = parent.getBoundingClientRect();
    const x = anchor.x - box.left - el.offsetWidth / 2;
    const y = anchor.y - box.top + 10;
    const maxX = parent.clientWidth - el.offsetWidth - 8;
    const maxY = parent.clientHeight - el.offsetHeight - 8;
    el.style.left = `${Math.max(8, Math.min(x, maxX))}px`;
    el.style.top = `${Math.max(8, Math.min(y, maxY))}px`;
  }, [anchor.x, anchor.y]);

  // Select the default option.
  useLayoutEffect(() => first.current?.focus(), []);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={`Link “${answer}” to “${target}”`}
      className="absolute z-20 rounded-lg border border-neutral-300 bg-white p-2 text-sm shadow-xl"
      // Keep focus on the options when clicking elsewhere in the menu.
      onMouseDown={(e) => {
        if (!(e.target as Element).closest("button")) e.preventDefault();
      }}
      // Clicking anywhere else (even outside the canvas) cancels.
      onBlur={(e) => {
        // Not when the whole window loses focus (e.g. switching apps).
        if (document.hasFocus() && !e.currentTarget.contains(e.relatedTarget)) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        } else if (e.key === "Tab") {
          // Keep focus on the two options.
          e.preventDefault();
          const buttons = [...(ref.current?.querySelectorAll("button") ?? [])];
          const next = buttons.indexOf(document.activeElement as HTMLButtonElement) + 1;
          buttons[next % buttons.length]?.focus();
        }
      }}
    >
      <div aria-hidden className="max-w-md truncate px-1 pb-2 text-neutral-500">
        Link “{answer}” to “{target}”
      </div>
      <div className="flex gap-2">
        <button
          ref={first}
          type="button"
          className={`flex items-center gap-2 rounded-md border px-3 py-1.5 font-medium text-neutral-900 outline-none focus:ring-2 focus:ring-offset-1 ${
            misplaced
              ? "border-yellow-500 bg-yellow-50 hover:bg-yellow-100 focus:ring-yellow-500"
              : "border-green-600 bg-green-50 hover:bg-green-100 focus:ring-green-600"
          }`}
          onClick={() => onChoose(true)}
        >
          <span aria-hidden className="flex">
            <StatusBadge status={misplaced ? "misplaced" : "recalled"} />
          </span>
          {misplaced ? "Mark as correct (but misplaced)" : "Mark as correct"}
        </button>
        <button
          type="button"
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-800 outline-none hover:bg-neutral-100 focus:ring-2 focus:ring-neutral-500 focus:ring-offset-1"
          onClick={() => onChoose(false)}
        >
          Just associate items
        </button>
      </div>
    </div>
  );
}
