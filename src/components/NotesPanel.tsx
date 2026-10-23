type Notes = { heading: string; paragraphs: string[] };

/** `notes` is undefined while loading, and null for a map without notes. */
export function NotesPanel({ notes, hidden }: { notes?: Notes | null; hidden: boolean }) {
  if (hidden) {
    return (
      <aside className="flex w-72 shrink-0 flex-col items-center justify-center gap-2 border-l border-neutral-300 bg-neutral-100 px-8 text-center">
        <svg viewBox="0 0 24 24" className="mb-1 size-6 fill-neutral-900" aria-hidden>
          <path d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1Zm2 0h6V7a3 3 0 0 0-6 0v3Z" />
        </svg>
        <h2 className="font-semibold">Source notes hidden</h2>
        <p className="text-sm text-neutral-500">
          Rebuild the map from memory. The reference map and notes return in Compare.
        </p>
      </aside>
    );
  }
  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-neutral-300 bg-neutral-50">
      <h2 className="border-b border-neutral-300 px-4 py-3 font-medium">Source notes</h2>
      {notes && (
        <div className="space-y-3 overflow-y-auto px-4 py-4 text-sm leading-relaxed text-neutral-700">
          <h3 className="font-semibold text-neutral-900">{notes.heading}</h3>
          {notes.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}
      {notes === null && (
        <p className="px-4 py-4 text-sm text-neutral-500">No source notes for this map yet.</p>
      )}
    </aside>
  );
}
