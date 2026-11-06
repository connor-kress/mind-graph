import { useQuery } from "convex/react";
import { RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { cn } from "../lib/utils";
import { dayAndTime, percentLeft, shortDuration } from "./usageDisplay";

const money = (usd: number) => `$${usd.toFixed(2)}`;

/** Marks the part of the bar that's been used. */
const USED_STRIPES =
  "repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in oklab, var(--muted-foreground) 30%, transparent) 4px 5px)";

/** The current time, updated often enough to notice a period ending while the panel is open. */
function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** How much of their transcription limit the user has left, with the details on click. */
export function TranscriptionUsage() {
  const usage = useQuery(api.usage.mine);
  const now = useNow();
  if (!usage) return null;
  const { limitUsd, resetMs, lastResetAt } = usage;
  const resetsAt = lastResetAt === null ? null : lastResetAt + resetMs;
  // Once a period is over, the next transcription starts another, so nothing counts against it.
  const inPeriod = resetsAt !== null && now < resetsAt;
  const usageUsd = inPeriod ? usage.usageUsd : 0;
  const left = percentLeft(usageUsd, limitUsd);
  const resetsIn = inPeriod ? shortDuration(resetsAt - now) : null;
  return (
    <div className="absolute right-3 bottom-3 w-64 max-w-[calc(100%-1.5rem)]">
      <Popover>
        <PopoverTrigger
          aria-label={`Transcription limit: ${left}% left${resetsIn ? `, resets in ${resetsIn}` : ""}`}
          className="flex w-full flex-col gap-1.5 rounded-lg bg-background/90 p-2 text-left backdrop-blur-sm transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex w-full items-center justify-between text-xs leading-none">
            <span
              className={cn("flex shrink-0 items-baseline gap-1", left === 0 && "text-destructive")}
            >
              <span className="font-semibold tabular-nums">{left}%</span>
              <span className={cn(left > 0 && "text-muted-foreground")}>left</span>
            </span>
            {resetsIn && (
              <span className="flex shrink-0 items-center gap-1 tabular-nums">
                <RotateCw aria-hidden className="size-3" />
                {resetsIn}
              </span>
            )}
          </span>
          <span
            className="relative h-2.5 w-full overflow-hidden rounded-md bg-muted"
            style={{ backgroundImage: USED_STRIPES }}
          >
            <span
              className="absolute inset-y-0 left-0 rounded-md bg-[color-mix(in_oklab,var(--primary)_40%,var(--background))] transition-[width]"
              style={{ width: `${left}%` }}
            />
          </span>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="w-max max-w-[calc(100vw-1rem)]">
          <p className="mb-2 text-xs font-medium">Transcription limit</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Left</dt>
            <dd className="tabular-nums">
              {left}% ({money(Math.max(0, limitUsd - usageUsd))} of {money(limitUsd)})
            </dd>
            <dt className="text-muted-foreground">Resets</dt>
            <dd className="tabular-nums">
              {inPeriod
                ? `${dayAndTime(resetsAt, now)} · in ${resetsIn}`
                : `${shortDuration(resetMs)} after your next transcription`}
            </dd>
          </dl>
        </PopoverContent>
      </Popover>
    </div>
  );
}
