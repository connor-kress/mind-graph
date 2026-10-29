import type { ReactNode } from "react";
import { commitEdits } from "../editor/commitEdits";
import { ExpandIcon } from "../sidebar/icons";
import { AccountMenu } from "./AccountMenu";
import { Logo } from "./Logo";

export type Mode = "build" | "recall" | "compare";

const MODES: { id: Mode; label: string }[] = [
  { id: "build", label: "Build" },
  { id: "recall", label: "Recall" },
  { id: "compare", label: "Compare" },
];

type Props = {
  folder?: string | null;
  title?: string;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  /** Modes that can't be opened right now, with the reason why. */
  disabled: Partial<Record<Mode, string>>;
  status?: ReactNode;
  actions?: ReactNode;
  vim: boolean;
  onVimToggle: () => void;
  /** While the sidebar is collapsed, the bar shows its expand button and the logo. */
  sidebarOpen: boolean;
  onSidebarToggle: () => void;
};

export function TopBar({
  folder,
  title,
  mode,
  onModeChange,
  disabled,
  status,
  actions,
  vim,
  onVimToggle,
  sidebarOpen,
  onSidebarToggle,
}: Props) {
  return (
    <header className="flex h-13 shrink-0 items-center gap-3 border-b border-neutral-200 px-4">
      {!sidebarOpen && (
        <>
          <button
            type="button"
            title="Expand sidebar (Ctrl+\)"
            aria-label="Expand sidebar"
            onClick={onSidebarToggle}
            onMouseDown={(e) => e.preventDefault()}
            className="-ml-1 flex size-6 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
          >
            <ExpandIcon />
          </button>
          <Logo />
          <span className="h-5 w-px shrink-0 bg-neutral-200" aria-hidden />
        </>
      )}
      {title && (
        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 items-center gap-2 text-[13px] text-neutral-500"
        >
          <span className="shrink-0">Library</span>
          <span aria-hidden>/</span>
          {folder && (
            <>
              <span className="truncate">{folder}</span>
              <span aria-hidden>/</span>
            </>
          )}
          <span aria-current="page" className="truncate font-semibold text-neutral-900">
            {title}
          </span>
        </nav>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-3">
        {status && <span className="text-sm font-medium text-neutral-800">{status}</span>}
        <div className="flex overflow-hidden rounded-md border border-neutral-300 text-sm">
          {MODES.map(({ id, label }) => {
            const active = id === mode;
            const reason = disabled[id];
            return (
              <button
                key={id}
                type="button"
                // aria-disabled rather than disabled, so the reason's tooltip shows.
                aria-disabled={!!reason}
                aria-pressed={active}
                title={reason}
                onClick={() => {
                  if (reason || active) return;
                  commitEdits();
                  onModeChange(id);
                }}
                // Keep focus on the canvas so its shortcuts keep working.
                onMouseDown={(e) => e.preventDefault()}
                className={`border-l border-neutral-300 px-4 py-1.5 first:border-l-0 ${
                  active
                    ? "bg-neutral-900 font-medium text-white"
                    : reason
                      ? "cursor-not-allowed text-neutral-400"
                      : "text-neutral-800 hover:bg-neutral-100"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        {actions}
        {!sidebarOpen && <AccountMenu compact />}
        <button
          type="button"
          title="Switch keyboard mode (m)"
          onClick={onVimToggle}
          // Keep focus on the canvas so its shortcuts keep working.
          onMouseDown={(e) => e.preventDefault()}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-800 hover:bg-neutral-100"
        >
          {vim ? "Vim mode" : "Normal mode"}
        </button>
      </div>
    </header>
  );
}
