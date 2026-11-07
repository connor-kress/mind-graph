import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";

/** How far the pointer has to move before a press on an item is a drag, not a click. */
const DRAG_FROM_PX = 5;
/** How close to an end of the scrolling area the pointer has to be to scroll it, and how fast. */
const SCROLL_EDGE_PX = 40;
const SCROLL_PX_PER_FRAME = 8;

/** Pressing on an element with this attribute doesn't start a drag, as with a button in a row. */
export const NO_DRAG = { "data-no-drag": "" };

/**
 * Where an item dragged to start at a point along a list would go, given how much room each
 * takes. It takes a neighbor's place once its leading edge passes the middle of that neighbor
 * where it was, which keeps items of different sizes from swapping back and forth.
 */
export function slotAt(sizes: number[], from: number, start: number) {
  const starts = sizes.map((_, index) => sizes.slice(0, index).reduce((sum, s) => sum + s, 0));
  const middle = (index: number) => starts[index] + sizes[index] / 2;
  let slot = from;
  while (slot < sizes.length - 1 && start + sizes[from] > middle(slot + 1)) slot++;
  if (slot > from) return slot;
  while (slot > 0 && start < middle(slot - 1)) slot--;
  return slot;
}

type Press = {
  id: string;
  index: number;
  pointerId: number;
  element: HTMLElement;
  startAt: number;
  at: number;
  startScroll: number;
  /** The room each item takes, measured once as others moving aside don't change it. */
  sizes: number[];
  /** How far the items can reach, which is less than their sizes by any gap after the last. */
  total: number;
  dragging: boolean;
  /** Where it would go now, ahead of what's been rendered. */
  to: number;
};

type Drag = { id: string; from: number; to: number; offset: number; size: number };

type Options = {
  axis: "x" | "y";
  /** The element whose children are the items. */
  list: RefObject<HTMLElement | null>;
  /** What scrolls when dragging near its ends, if not the list itself. */
  scroller?: () => HTMLElement | null;
  /** Changes with the items or their sizes, which ends a drag that measured them before. */
  contents: unknown;
  onMove: (id: string, to: number) => void;
};

/**
 * Sorting a list by dragging its items with a mouse or pen, within the list. It's for a single
 * row or column with even gaps. On touch, a swipe scrolls instead.
 */
export function useDragSort({ axis, list, scroller, contents, onMove }: Options) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const press = useRef<Press | null>(null);
  const dragged = useRef(false);
  const horizontal = axis === "x";

  const scrolling = useRef(scroller);
  useEffect(() => {
    scrolling.current = scroller;
  });
  const area = useCallback(() => scrolling.current?.() ?? list.current, [list]);
  const scrollOf = useCallback(
    () => (horizontal ? area()?.scrollLeft : area()?.scrollTop) ?? 0,
    [area, horizontal],
  );

  const follow = useCallback(() => {
    const current = press.current;
    if (!current) return;
    const { index, sizes, total, startAt, at, startScroll, id } = current;
    const size = sizes[index];
    const start = sizes.slice(0, index).reduce((sum, s) => sum + s, 0);
    const moved = at - startAt + scrollOf() - startScroll;
    const offset = Math.min(Math.max(moved, -start), total - start - size);
    const to = slotAt(sizes, index, start + offset);
    current.to = to;
    setDrag({ id, from: index, to, offset, size });
  }, [scrollOf]);

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
    let frame = requestAnimationFrame(function scrollAtEnds() {
      const current = press.current;
      const scrolled = area();
      if (current && scrolled) {
        const box = scrolled.getBoundingClientRect();
        const [low, high] = horizontal ? [box.left, box.right] : [box.top, box.bottom];
        const by =
          current.at < low + SCROLL_EDGE_PX
            ? -SCROLL_PX_PER_FRAME
            : current.at > high - SCROLL_EDGE_PX
              ? SCROLL_PX_PER_FRAME
              : 0;
        if (by) {
          scrolled.scrollBy({ [horizontal ? "left" : "top"]: by, behavior: "instant" });
          follow();
        }
      }
      frame = requestAnimationFrame(scrollAtEnds);
    });
    // Escape puts the item back where it was.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      stop();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", stop);
    // The items may not be the sizes that were measured anymore.
    window.addEventListener("resize", stop);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", stop);
      window.removeEventListener("resize", stop);
    };
  }, [dragging, area, horizontal, follow, stop]);

  const handlers = (id: string, index: number) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || e.pointerType === "touch" || !list.current) return;
      if ((e.target as Element).closest("[data-no-drag]")) return;
      const boxes = [...list.current.children].map((item) => {
        const box = item.getBoundingClientRect();
        return horizontal
          ? { start: box.left, size: box.width }
          : { start: box.top, size: box.height };
      });
      const gap = boxes.length > 1 ? boxes[1].start - boxes[0].start - boxes[0].size : 0;
      const sizes = boxes.map(({ size }) => size + gap);
      const at = horizontal ? e.clientX : e.clientY;
      press.current = {
        id,
        index,
        pointerId: e.pointerId,
        element: e.currentTarget,
        startAt: at,
        at,
        startScroll: scrollOf(),
        sizes,
        total: sizes.reduce((sum, s) => sum + s, 0) - gap,
        dragging: false,
        to: index,
      };
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const current = press.current;
      if (!current || e.pointerId !== current.pointerId) return;
      // Released off the item before the drag began, which this item wouldn't have heard.
      if (!(e.buttons & 1)) return stop();
      current.at = horizontal ? e.clientX : e.clientY;
      if (!current.dragging) {
        if (Math.abs(current.at - current.startAt) < DRAG_FROM_PX) return;
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

  /** A style for an item while it's moved along: the dragged one with the pointer, others aside. */
  const styleOf = (index: number) => {
    if (!drag) return undefined;
    const { from, to, offset, size } = drag;
    const shift =
      index === from
        ? offset
        : index > from && index <= to
          ? -size
          : index < from && index >= to
            ? size
            : 0;
    if (!shift) return undefined;
    return { transform: `translate${horizontal ? "X" : "Y"}(${shift}px)` };
  };

  return {
    drag,
    handlers,
    styleOf,
    /** Whether a click only ended a drag, which isn't what it would otherwise do. */
    endedDrag: () => dragged.current,
  };
}
