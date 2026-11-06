import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { cn } from "../lib/utils";

const money = (usd: number) => `$${usd.toFixed(2)}`;

/** The current time, updated often enough to notice a period ending while the panel is open. */
function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** How much of their transcription limit the user has used, and when it resets. */
export function TranscriptionUsage() {
  const usage = useQuery(api.usage.mine);
  const now = useNow();
  if (!usage) return null;
  const { limitUsd, resetMs, lastResetAt } = usage;
  const resetsAt = lastResetAt === null ? null : lastResetAt + resetMs;
  // Once a period is over, the next transcription starts another, so nothing counts against it.
  const inPeriod = resetsAt !== null && now < resetsAt;
  const usageUsd = inPeriod ? usage.usageUsd : 0;
  return (
    <div className="flex shrink-0 flex-wrap justify-between gap-x-3 border-t px-5 py-2 text-xs text-muted-foreground">
      <span className={cn(usageUsd >= limitUsd && "font-medium text-destructive")}>
        Transcription: {money(usageUsd)} of {money(limitUsd)}
      </span>
      {inPeriod && (
        <span>
          Resets{" "}
          {new Date(resetsAt).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
      )}
    </div>
  );
}
