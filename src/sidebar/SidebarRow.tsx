import { useRef, useState, type ReactNode } from "react";

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
  /** Replaces the label (and the button) while the row is being renamed. */
  editor?: ReactNode;
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
  editor,
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
      {editor ? (
        <div
          className={`flex h-full min-w-0 flex-1 items-center gap-2 ${nested ? "pl-11" : "pl-2"} pr-2`}
        >
          {leading}
          <span className="text-neutral-500">{icon}</span>
          {editor}
        </div>
      ) : (
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
      )}
      {!editor && trailing && (
        <div className="flex shrink-0 items-center gap-0.5 pr-2">{trailing}</div>
      )}
    </div>
  );
}

/** A small square icon button for a row's actions, shown on hover. */
export function RowAction({
  label,
  onClick,
  visible,
  children,
}: {
  label: string;
  onClick?: () => void;
  /** Shown even when the row isn't hovered. */
  visible?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      className={`flex size-5.5 items-center justify-center rounded-md text-neutral-500 hover:bg-sidebar-active ${
        visible ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      }`}
    >
      {children}
    </button>
  );
}

/** An inline text field for renaming a row. Enter or leaving it saves; Esc cancels. */
export function RenameField({
  initial,
  label,
  onSubmit,
  onCancel,
}: {
  initial: string;
  label: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  // Saving unmounts the field, so make sure it only ends once.
  const done = useRef(false);
  const end = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const next = value.trim();
    if (save && next && next !== initial) onSubmit(next);
    else onCancel();
  };
  return (
    <input
      aria-label={label}
      value={value}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => end(true)}
      onKeyDown={(e) => {
        // Keep the editor's window-level shortcuts (e.g. undo) out of the field.
        e.stopPropagation();
        if (e.key === "Enter") end(true);
        else if (e.key === "Escape") end(false);
      }}
      className="min-w-0 flex-1 rounded border border-accent bg-white px-1 py-0.5 text-sm text-neutral-900 outline-none"
    />
  );
}
