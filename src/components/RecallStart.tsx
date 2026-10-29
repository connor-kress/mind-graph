import { Brain } from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";

type Props = { hasPreviousAttempt: boolean; onStart: () => Promise<unknown> };
export function RecallStart({ hasPreviousAttempt, onStart }: Props) {
  const [starting, setStarting] = useState(false);
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <section
        aria-labelledby="recall-title"
        className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-xs"
      >
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Brain className="size-5 text-primary" aria-hidden />
          </div>
          <h2 id="recall-title" className="text-lg font-semibold text-card-foreground">
            Recall practice
          </h2>
        </div>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          Rebuild this map from memory.
        </p>
        {hasPreviousAttempt && (
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Finishing replaces your previous comparison.
          </p>
        )}
        <Button
          className="mt-6 w-full"
          disabled={starting}
          onClick={async () => {
            setStarting(true);
            try {
              await onStart();
            } finally {
              setStarting(false);
            }
          }}
        >
          {starting ? "Starting..." : "Start recall"}
        </Button>
      </section>
    </div>
  );
}
