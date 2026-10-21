import type { ReactNode } from "react";
import { commitEdits } from "../editor/commitEdits";

export type Mode = "build" | "recall" | "compare";

const MODES: { id: Mode; label: string }[] = [
  { id: "build", label: "Build" },
  { id: "recall", label: "Recall" },
  { id: "compare", label: "Compare" },
];

type Props = {
  course?: string;
  title?: string;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  /** Modes that can't be opened right now, with the reason why. */
  disabled: Partial<Record<Mode, string>>;
  status?: ReactNode;
  actions?: ReactNode;
};

export function TopBar({ course, title, mode, onModeChange, disabled, status, actions }: Props) {
  return (
    <header className="flex h-13 shrink-0 items-center gap-3 border-b border-neutral-300 px-4">
      <h1 className="text-[17px] font-semibold">Mind Graph</h1>
      {course && title && (
        <span className="min-w-0 truncate text-sm text-neutral-500">
          {course} / {title}
        </span>
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
      </div>
    </header>
  );
}
