import { BookOpen, Brain, Columns2, Keyboard, MoreHorizontal, PencilRuler } from "lucide-react";
import { commitEdits } from "../editor/commitEdits";
import { AccountMenu } from "./AccountMenu";
import { Badge } from "./ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./ui/breadcrumb";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Separator } from "./ui/separator";
import { SidebarTrigger, useSidebar } from "./ui/sidebar";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import type { ReactNode } from "react";

export type Mode = "build" | "recall" | "compare";
const MODES = [
  { id: "build", label: "Build", icon: PencilRuler },
  { id: "recall", label: "Recall", icon: Brain },
  { id: "compare", label: "Compare", icon: Columns2 },
] as const;
type Props = {
  project?: string | null;
  title?: string;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  disabled: Partial<Record<Mode, string>>;
  status?: ReactNode;
  actions?: ReactNode;
  vim: boolean;
  onVimToggle: () => void;
  notesOpen: boolean;
  onNotesToggle: () => void;
};

export function TopBar({
  project,
  title,
  mode,
  onModeChange,
  disabled,
  status,
  actions,
  vim,
  onVimToggle,
  notesOpen,
  onNotesToggle,
}: Props) {
  const { open, isMobile } = useSidebar();
  return (
    <header className="shrink-0 border-b bg-background">
      <div className="flex h-14 min-w-0 items-center gap-3 px-3 md:px-5">
        <SidebarTrigger title="Toggle sidebar (Ctrl+\\)" />
        <Separator orientation="vertical" className="h-4!" />
        <Breadcrumb className="min-w-0 flex-1">
          <BreadcrumbList className="flex-nowrap text-xs">
            <BreadcrumbItem className="hidden sm:block">My library</BreadcrumbItem>
            <BreadcrumbSeparator className="hidden sm:block" />
            {project && (
              <>
                <BreadcrumbItem className="hidden min-w-0 truncate lg:block">
                  {project}
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden lg:block" />
              </>
            )}
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage className="truncate font-medium">
                {title || "Loading map..."}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={notesOpen ? "secondary" : "ghost"}
              size="icon-sm"
              aria-label={notesOpen ? "Hide source notes" : "Show source notes"}
              aria-pressed={notesOpen}
              onClick={onNotesToggle}
            >
              <BookOpen />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Source notes</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Workspace options">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-64 whitespace-nowrap"
            onKeyDown={(e) => e.stopPropagation()}
          >
            <DropdownMenuLabel>Workspace</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={vim} onCheckedChange={onVimToggle}>
              <Keyboard />
              <span className="flex-1">Vim keyboard mode</span>
              <kbd className="ml-3 text-xs text-muted-foreground">M</kbd>
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={notesOpen} onCheckedChange={onNotesToggle}>
              <BookOpen />
              Source notes
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {(!open || isMobile) && <AccountMenu compact />}
      </div>
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-t border-border/60 px-3 py-2 md:px-5">
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(value) => {
            if (value && !disabled[value as Mode]) {
              commitEdits();
              onModeChange(value as Mode);
            }
          }}
          variant="outline"
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
                    {label}
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
        <div className="flex flex-wrap items-center gap-2">
          {status && (
            <Badge variant="secondary" className="font-normal">
              {status}
            </Badge>
          )}
          {actions}
        </div>
      </div>
    </header>
  );
}
