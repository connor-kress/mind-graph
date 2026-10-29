import { BookOpen, LockKeyhole, X } from "lucide-react";
import { useIsMobile } from "../hooks/use-mobile";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";
import { Skeleton } from "./ui/skeleton";

type Notes = { heading: string; paragraphs: string[] };
type Props = {
  notes?: Notes | null;
  hidden: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function NotesPanel({ notes, hidden, open, onOpenChange }: Props) {
  const mobile = useIsMobile();
  const content = hidden ? (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-7 text-center">
      <LockKeyhole className="size-5 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Notes hidden during recall.</p>
    </div>
  ) : (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-5 p-5 text-sm leading-7 text-muted-foreground">
        {notes ? (
          <>
            <h3 className="font-semibold leading-6 text-foreground">{notes.heading}</h3>
            {notes.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </>
        ) : notes === null ? (
          <div className="py-10 text-center">
            <BookOpen className="mx-auto mb-3 size-7 text-muted-foreground/50" />
            <p className="font-medium text-foreground">No source notes yet</p>
          </div>
        ) : (
          <div role="status" aria-label="Loading source notes" className="space-y-3">
            <Skeleton className="h-5 w-3/4" />
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-3 w-full" />
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
  if (mobile)
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="flex w-[min(90vw,22rem)] flex-col gap-0 p-0"
          onKeyDown={(e) => e.stopPropagation()}
        >
          <SheetHeader className="border-b p-5">
            <SheetTitle className="text-sm">Source notes</SheetTitle>
            <SheetDescription className="sr-only">
              Reference material for the current map.
            </SheetDescription>
          </SheetHeader>
          {content}
        </SheetContent>
      </Sheet>
    );
  if (!open) return null;
  return (
    <aside
      aria-label="Source notes"
      className="flex w-72 shrink-0 flex-col border-l bg-background xl:w-80"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-5">
        <BookOpen className="size-4 text-muted-foreground" />
        <h2 className="flex-1 text-xs font-semibold">Source notes</h2>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Hide source notes"
          onClick={() => onOpenChange(false)}
        >
          <X />
        </Button>
      </div>
      {content}
    </aside>
  );
}
