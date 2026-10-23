import type { ReactNode } from "react";

type Props = {
  icon: ReactNode;
  label: ReactNode;
  /** Shown before the icon, e.g. a folder's chevron. */
  leading?: ReactNode;
  /** Shown at the end of the row, outside the main button (so it can hold buttons). */
  trailing?: ReactNode;
  /** Indents the row under a folder. */
  nested?: boolean;
  active?: boolean;
  muted?: boolean;
  title?: string;
  onClick?: () => void;
  onDoubleClick?: () => void;
};

/** One row of the sidebar: a button with an icon and label, and optional actions. */
export function SidebarRow({
  icon,
  label,
  leading,
  trailing,
  nested,
  active,
  muted,
  title,
  onClick,
  onDoubleClick,
}: Props) {
  return (
    <div
      className={`group mx-2 flex h-7.5 items-center rounded-md text-sm ${
        active ? "bg-accent-soft" : "hover:bg-sidebar-hover"
      }`}
    >
      <button
        type="button"
        title={title}
        aria-current={active ? "page" : undefined}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        // Keep focus on the canvas so its shortcuts keep working.
        onMouseDown={(e) => e.preventDefault()}
        className={`flex h-full min-w-0 flex-1 items-center gap-2 rounded-md text-left ${
          nested ? "pl-11" : "pl-2"
        } ${active ? "font-semibold text-accent" : muted ? "text-neutral-400" : "text-neutral-700"}`}
      >
        {leading}
        <span className={active ? "text-accent" : "text-neutral-500"}>{icon}</span>
        <span className="truncate">{label}</span>
      </button>
      {trailing && <div className="flex shrink-0 items-center gap-0.5 pr-2">{trailing}</div>}
    </div>
  );
}

/** A small square icon button for a row's actions, shown on hover. */
export function RowAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      className="flex size-5.5 items-center justify-center rounded-md text-neutral-500 opacity-0 group-hover:opacity-100 hover:bg-sidebar-active focus-visible:opacity-100"
    >
      {children}
    </button>
  );
}
