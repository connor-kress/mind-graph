const MINUTES_PER_DAY = 24 * 60;

/** How much of a limit is left, as 0 or 100 only when it's exactly that. */
export function percentLeft(usageUsd: number, limitUsd: number) {
  if (usageUsd >= limitUsd) return 0;
  if (usageUsd <= 0) return 100;
  return Math.min(99, Math.max(1, Math.round((1 - usageUsd / limitUsd) * 100)));
}

/** A length of time like "6d 23h", "23h 40m" or "40m", rounded up to the minute. */
export function shortDuration(ms: number) {
  const total = Math.max(1, Math.ceil(ms / 60_000));
  const days = Math.floor(total / MINUTES_PER_DAY);
  const hours = Math.floor((total % MINUTES_PER_DAY) / 60);
  const minutes = total % 60;
  if (days > 0) return `${days}d ${hours}h`;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** A moment in the near future like "tomorrow at 3:00 PM" or "Nov 11 at 1:21 PM". */
export function dayAndTime(at: number, now: number) {
  const date = new Date(at);
  const today = new Date(now);
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const day =
    date.toDateString() === today.toDateString()
      ? "today"
      : date.toDateString() === tomorrow.toDateString()
        ? "tomorrow"
        : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} at ${time}`;
}
