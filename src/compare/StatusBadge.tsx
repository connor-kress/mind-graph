import type { CompareStatus } from "./compare";

type Badge = { label: string; circle: string; path: string };

const CHECK = "M4.5 8.5l2.5 2.5 4.5-5.5";
const CROSS = "M5.5 5.5l5 5m0-5l-5 5";
const PARTIAL = "M5 8h6";

const BADGES: Partial<Record<CompareStatus, Badge>> = {
  recalled: { label: "Recalled", circle: "bg-green-600 text-white", path: CHECK },
  misplaced: { label: "Wrong parent", circle: "bg-yellow-400 text-neutral-900", path: PARTIAL },
  belongs: { label: "Where it belongs", circle: "bg-yellow-400 text-neutral-900", path: PARTIAL },
  extra: { label: "Not in reference", circle: "bg-red-600 text-white", path: CROSS },
  missed: { label: "Missed", circle: "bg-red-600 text-white", path: CROSS },
};

/** Circled check, cross or dash showing how a compared node fared. */
export function StatusBadge({
  status,
  className = "",
}: {
  status: CompareStatus;
  className?: string;
}) {
  const badge = BADGES[status];
  if (!badge) return null;
  return (
    <span
      role="img"
      aria-label={badge.label}
      className={`inline-flex size-[18px] items-center justify-center rounded-full ${badge.circle} ${className}`}
    >
      <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
        <path
          d={badge.path}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
