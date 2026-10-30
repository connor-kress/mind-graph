import { BookOpen, ImageDown, Keyboard, MoreHorizontal } from "lucide-react";
import { AccountMenu } from "./AccountMenu";
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
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Separator } from "./ui/separator";
import { SidebarTrigger, useSidebar } from "./ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

type Props = {
  project?: string | null;
  title?: string;
  vim: boolean;
  onVimToggle: () => void;
  notesOpen: boolean;
  onNotesToggle: () => void;
  onExport: () => void;
  /** Why the map can't be exported right now, if it can't. */
  exportDisabled?: string;
};

export function TopBar({
  project,
  title,
  vim,
  onVimToggle,
  notesOpen,
  onNotesToggle,
  onExport,
  exportDisabled,
}: Props) {
  const { open, openMobile, isMobile } = useSidebar();
  const sidebarOpen = isMobile ? openMobile : open;
  return (
    <header className="shrink-0 border-b bg-background">
      <div className="flex h-14 min-w-0 items-center gap-3 px-3 md:px-5">
        {!sidebarOpen && (
          <>
            <SidebarTrigger title="Toggle sidebar (Ctrl+\\)" />
            <Separator orientation="vertical" className="h-4!" />
          </>
        )}
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
            <DropdownMenuCheckboxItem
              checked={vim}
              onCheckedChange={onVimToggle}
              onSelect={(event) => event.preventDefault()}
            >
              <Keyboard />
              <span className="flex-1">Vim keyboard mode</span>
              <kbd className="ml-3 text-xs text-muted-foreground">M</kbd>
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={notesOpen}
              onCheckedChange={onNotesToggle}
              onSelect={(event) => event.preventDefault()}
            >
              <BookOpen />
              Source notes
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuItem
                  aria-disabled={!!exportDisabled}
                  onSelect={(event) => {
                    if (exportDisabled) event.preventDefault();
                    else onExport();
                  }}
                  className={exportDisabled ? "cursor-not-allowed opacity-40" : ""}
                >
                  <ImageDown />
                  Export as PNG
                </DropdownMenuItem>
              </TooltipTrigger>
              {exportDisabled && <TooltipContent side="left">{exportDisabled}</TooltipContent>}
            </Tooltip>
          </DropdownMenuContent>
        </DropdownMenu>
        {(!open || isMobile) && <AccountMenu compact />}
      </div>
    </header>
  );
}
