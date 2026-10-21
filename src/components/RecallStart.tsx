type Props = { hasPreviousAttempt: boolean; onStart: () => void };

/** Shown in Recall mode when no attempt is in progress. */
export function RecallStart({ hasPreviousAttempt, onStart }: Props) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <h2 className="text-lg font-semibold">Rebuild the map from memory</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          You'll start from a blank canvas with just the topic. Your notes and reference map stay
          hidden until you finish
          {hasPreviousAttempt ? ", and your last comparison is replaced when you do" : ""}.
        </p>
        <button
          type="button"
          className="mt-5 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
          onClick={onStart}
        >
          Start recall
        </button>
      </div>
    </div>
  );
}
