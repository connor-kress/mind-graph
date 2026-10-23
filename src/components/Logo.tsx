/** The Mind Graph mark: an M drawn as a small graph. */
export function Logo({ className = "size-5.5" }: { className?: string }) {
  return (
    <svg viewBox="16 16 188 188" className={`shrink-0 ${className}`} aria-hidden>
      <path
        d="M40 170 L40 40 L110 120 L180 40 L180 170"
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="18"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="40" cy="170" r="24" fill="var(--color-accent)" />
      <circle cx="40" cy="40" r="24" fill="var(--color-accent)" />
      <circle cx="180" cy="40" r="24" fill="var(--color-accent)" />
      <circle cx="180" cy="170" r="24" fill="var(--color-accent)" />
      <circle cx="110" cy="120" r="28" fill="#b35a00" />
    </svg>
  );
}
