import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { slotAt } from "./tabView";

/** How far the pointer has to move before a press on a tab is a drag, not a click. */
const DRAG_FROM_PX = 5;
/** How close to an end of the row the pointer has to be to scroll it, and how fast. */
const SCROLL_EDGE_PX = 40;
const SCROLL_PX_PER_FRAME = 8;

type Press = {
  id: string;
  index: number;
  pointerId: number;
  element: HTMLElement;
  startX: number;
  x: number;
  startScroll: number;
  /** Every tab's width, measured once as tabs moving aside don't change them. */
  widths: number[];
  dragging: boolean;
  /** Where it would go now, ahead of what's been rendered. */
  to: number;
};

type Drag = { id: string; from: number; to: number; offset: number; width: number };

/** Dragging tabs along their row with a mouse or pen. On touch, a swipe scrolls the row instead. */
export function useTabDrag(
  row: RefObject<HTMLElement | null>,
  /** Changes with the tabs or their sizes, which ends a drag that measured them before. */
  contents: unknown,
  onMove: (id: string, to: number) => void,
) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const press = useRef<Press | null>(null);
  const dragged = useRef(false);

  const follow = useCallback(() => {
    const current = press.current;
    if (!current || !row.current) return;
    const { index, widths, startX, x, startScroll, id } = current;
    const width = widths[index];
    const left = widths.slice(0, index).reduce((sum, w) => sum + w, 0);
    const total = widths.reduce((sum, w) => sum + w, 0);
    const moved = x - startX + row.current.scrollLeft - startScroll;
    const offset = Math.min(Math.max(moved, -left), total - left - width);
    const to = slotAt(widths, index, left + offset);
    current.to = to;
    setDrag({ id, from: index, to, offset, width });
  }, [row]);

  const stop = useCallback(() => {
    const current = press.current;
    press.current = null;
    setDrag(null);
    if (current?.element.hasPointerCapture(current.pointerId)) {
      current.element.releasePointerCapture(current.pointerId);
    }
    // Only the click that this drag's release is about to cause, not any later one.
    if (dragged.current) setTimeout(() => (dragged.current = false));
  }, []);

  useEffect(() => {
    if (press.current) stop();
  }, [contents, stop]);
  useEffect(() => stop, [stop]);

  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    let frame = requestAnimationFrame(function scrollAtEdges() {
      const current = press.current;
      if (current && row.current) {
        const { left, right } = row.current.getBoundingClientRect();
        const by =
          current.x < left + SCROLL_EDGE_PX
            ? -SCROLL_PX_PER_FRAME
            : current.x > right - SCROLL_EDGE_PX
              ? SCROLL_PX_PER_FRAME
              : 0;
        if (by) {
          row.current.scrollBy({ left: by, behavior: "instant" });
          follow();
        }
      }
      frame = requestAnimationFrame(scrollAtEdges);
    });
    // Escape puts the tab back where it was.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      stop();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", stop);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", stop);
    };
  }, [dragging, row, follow, stop]);

  const handlers = (id: string, index: number) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || e.pointerType === "touch" || !row.current) return;
      press.current = {
        id,
        index,
        pointerId: e.pointerId,
        element: e.currentTarget,
        startX: e.clientX,
        x: e.clientX,
        startScroll: row.current.scrollLeft,
        widths: [...row.current.children].map((tab) => tab.getBoundingClientRect().width),
        dragging: false,
        to: index,
      };
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const current = press.current;
      if (!current || e.pointerId !== current.pointerId) return;
      // Released off the tab before the drag began, which this tab wouldn't have heard.
      if (!(e.buttons & 1)) return stop();
      current.x = e.clientX;
      if (!current.dragging) {
        if (Math.abs(current.x - current.startX) < DRAG_FROM_PX) return;
        current.dragging = true;
        dragged.current = true;
        current.element.setPointerCapture(current.pointerId);
      }
      follow();
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const current = press.current;
      if (!current || e.pointerId !== current.pointerId) return;
      if (current.dragging && current.to !== current.index) onMove(current.id, current.to);
      stop();
    },
    onPointerCancel: stop,
    // Taken away by the browser. After a normal end, there's nothing left to stop.
    onLostPointerCapture: stop,
  });

  /** How far a tab is moved along for now: the dragged one with the pointer, others aside. */
  const shiftOf = (index: number) => {
    if (!drag) return 0;
    const { from, to, offset, width } = drag;
    if (index === from) return offset;
    if (index > from && index <= to) return -width;
    if (index < from && index >= to) return width;
    return 0;
  };

  return {
    drag,
    handlers,
    shiftOf,
    /** Whether a click only ended a drag, which isn't selecting the tab. */
    endedDrag: () => dragged.current,
  };
}
