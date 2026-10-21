export type Mode = "build" | "recall";

const MODES: { id: Mode | "compare"; label: string }[] = [
  { id: "build", label: "Build" },
  { id: "recall", label: "Recall" },
  { id: "compare", label: "Compare" },
];

type Props = {
  course?: string;
  title?: string;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
};

export function TopBar({ course, title, mode, onModeChange }: Props) {
  return (
    <header className="flex h-13 shrink-0 items-center gap-3 border-b border-neutral-300 px-4">
      <h1 className="text-[17px] font-semibold">Mind Graph</h1>
      {course && title && (
        <span className="truncate text-sm text-neutral-500">
          {course} / {title}
        </span>
      )}
      <div className="ml-auto flex overflow-hidden rounded-md border border-neutral-300 text-sm">
        {MODES.map(({ id, label }) => {
          const active = id === mode;
          const disabled = id === "compare";
          return (
            <button
              key={id}
              type="button"
              disabled={disabled}
              title={disabled ? "Coming soon" : undefined}
              onClick={() => {
                if (id === "compare") return;
                // Commit any label being edited before the editor unmounts.
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
                onModeChange(id);
              }}
              // Keep focus on the canvas so its shortcuts keep working.
              onMouseDown={(e) => e.preventDefault()}
              className={`border-l border-neutral-300 px-4 py-1.5 first:border-l-0 ${
                active
                  ? "bg-neutral-900 font-medium text-white"
                  : disabled
                    ? "cursor-not-allowed text-neutral-400"
                    : "text-neutral-800 hover:bg-neutral-100"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </header>
  );
}
