const TREE_HINTS: [string[], string][] = [
  [["Click"], "place node"],
  [["Tab"], "child"],
  [["Enter"], "sibling"],
  [["F2"], "rename"],
  [["Del"], "delete"],
  [["←", "↑", "↓", "→"], "navigate"],
  [["Ctrl", "Z"], "undo"],
];

const LOOSE_HINTS: [string[], string][] = [
  [["Enter"], "connect"],
  [["Drag"], "move"],
  [["F2"], "rename"],
  [["Del"], "delete"],
  [["Ctrl", "Z"], "undo"],
];

type Props = { grid: boolean; linking: boolean; looseSelected: boolean };

export function ShortcutHints({ grid, linking, looseSelected }: Props) {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-white/85 px-2.5 py-1.5 text-xs text-neutral-500 backdrop-blur-sm">
      {linking ? (
        <span className="text-blue-700">
          Click a node to connect it · <kbd className="kbd">Esc</kbd> leaves it floating
        </span>
      ) : (
        (looseSelected ? LOOSE_HINTS : TREE_HINTS).map(([keys, label]) => (
          <span key={label} className="flex items-center gap-1">
            {keys.map((k) => (
              <kbd key={k} className="kbd">
                {k}
              </kbd>
            ))}
            {label}
          </span>
        ))
      )}
      <span className="flex items-center gap-1">
        <kbd className="kbd">G</kbd>
        grid {grid ? "on" : "off"}
      </span>
    </div>
  );
}
