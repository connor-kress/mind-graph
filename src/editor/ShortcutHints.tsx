type Hint = [string[], string];

const treeHints = (vim: boolean): Hint[] => [
  [["Click"], "place node"],
  [[vim ? "l" : "Tab"], vim ? "child (from a leaf)" : "child"],
  [[vim ? "o" : "Enter"], "sibling"],
  [["Shift", vim ? "o" : "Enter"], "sibling above"],
  [[vim ? "i" : "F2"], "rename"],
  [[vim ? "d" : "Del"], "delete"],
  [vim ? ["h", "j", "k", "l"] : ["←", "↑", "↓", "→"], "navigate"],
  [vim ? ["u"] : ["Ctrl", "z"], "undo"],
];

const looseHints = (vim: boolean): Hint[] => [
  [["Enter"], "connect"],
  [["Drag"], "move"],
  [[vim ? "i" : "F2"], "rename"],
  [[vim ? "d" : "Del"], "delete"],
  [vim ? ["u"] : ["Ctrl", "z"], "undo"],
];

type Props = { grid: boolean; linking: boolean; vim: boolean; looseSelected: boolean };

export function ShortcutHints({ grid, linking, vim, looseSelected }: Props) {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-white/85 px-2.5 py-1.5 text-xs text-neutral-500 backdrop-blur-sm">
      {linking ? (
        <span className="text-blue-700">
          Click a node to connect it · <kbd className="kbd">Esc</kbd> leaves it floating
        </span>
      ) : (
        (looseSelected ? looseHints(vim) : treeHints(vim)).map(([keys, label]) => (
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
        <kbd className="kbd">g</kbd>
        grid {grid ? "on" : "off"}
      </span>
      <span className="flex items-center gap-1">
        <kbd className="kbd">m</kbd>
        cycle mode
      </span>
    </div>
  );
}
