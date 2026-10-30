import type { ReactNode } from "react";
import { Brain, Columns2, PencilRuler } from "lucide-react";
import { commitEdits } from "../editor/commitEdits";
import { Badge } from "./ui/badge";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export type Mode = "build" | "recall" | "compare";
const MODES = [
  { id: "build", label: "Build", icon: PencilRuler },
  { id: "recall", label: "Recall", icon: Brain },
  { id: "compare", label: "Compare", icon: Columns2 },
] as const;
type Props = {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  disabled: Partial<Record<Mode, string>>;
  status?: ReactNode;
  actions?: ReactNode;
};

export function MapControls({ mode, onModeChange, disabled, status, actions }: Props) {
  return (
    <section
      aria-label="Map controls"
      className="pointer-events-none absolute top-3 right-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-col items-end gap-2"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="pointer-events-auto rounded-xl border bg-background/95 p-1.5 shadow-sm backdrop-blur-sm">
        <ToggleGroup
          className="shrink-0"
          type="single"
          value={mode}
          onValueChange={(value) => {
            if (value && !disabled[value as Mode]) {
              commitEdits();
              onModeChange(value as Mode);
            }
          }}
          variant="default"
          size="sm"
          aria-label="Map mode"
        >
          {MODES.map(({ id, label, icon: Icon }) => (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <ToggleGroupItem
                    value={id}
                    aria-label={label}
                    aria-disabled={!!disabled[id]}
                    onClick={(e) => {
                      if (disabled[id]) e.preventDefault();
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    className={disabled[id] ? "cursor-not-allowed opacity-40" : ""}
                  >
                    <Icon className="size-3.5" />
                    <span className="hidden sm:inline">{label}</span>
                  </ToggleGroupItem>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {disabled[id] ||
                  {
                    build: "Build your reference map",
                    recall: "Practice from memory",
                    compare: "Review your recall",
                  }[id]}
              </TooltipContent>
            </Tooltip>
          ))}
        </ToggleGroup>
      </div>
      {(status || actions) && (
        <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-end gap-2 rounded-xl border bg-background/95 p-1.5 shadow-sm backdrop-blur-sm">
          {status && (
            <Badge variant="secondary" className="font-normal">
              {status}
            </Badge>
          )}
          {actions}
        </div>
      )}
    </section>
  );
}
