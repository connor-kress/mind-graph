import { useLayoutEffect, useRef } from "react";
import type { MenuItem } from "./menu";

type Props = {
  x: number;
  y: number;
  /** Names the menu for screen readers. */
  label: string;
  items: MenuItem[];
  active: number;
  onHover: (index: number) => void;
  onChoose: (item: MenuItem) => void;
};

/** Context menu for a node, mostly for choosing how to delete it. */
export function NodeMenu({ x, y, label, items, active, onHover, onChoose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Keep the menu inside the canvas.
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    const maxX = parent.clientWidth - el.offsetWidth - 8;
    const maxY = parent.clientHeight - el.offsetHeight - 8;
    el.style.left = `${Math.max(8, Math.min(x, maxX))}px`;
    el.style.top = `${Math.max(8, Math.min(y, maxY))}px`;
  }, [x, y]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="absolute z-20 w-72 overflow-hidden rounded-lg border border-neutral-300 bg-white text-sm shadow-xl"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-neutral-900 ${
            i === active ? "bg-blue-50" : ""
          }`}
          onPointerEnter={() => onHover(i)}
          onClick={() => onChoose(item)}
        >
          <span>{item.label}</span>
          <span className="flex gap-1">
            {item.keys.map((k, i) => (
              <kbd key={i} className="kbd">
                {k}
              </kbd>
            ))}
          </span>
        </button>
      ))}
    </div>
  );
}
