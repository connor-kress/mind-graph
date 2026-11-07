import { useEffect, useState } from "react";

const TEXT_SIZE_STORAGE_KEY = "mind-graph:source-text-size";
/** Reading sizes in pixels; 14 matches the rest of the panel. */
const TEXT_SIZES = [12, 14, 16, 18, 20, 24];
const DEFAULT_TEXT_SIZE = 14;

/** The reader's text size, remembered across sources and visits. */
export function useTextSize() {
  const [size, setSize] = useState(() => {
    const stored = Number(localStorage.getItem(TEXT_SIZE_STORAGE_KEY));
    return TEXT_SIZES.includes(stored) ? stored : DEFAULT_TEXT_SIZE;
  });
  useEffect(() => localStorage.setItem(TEXT_SIZE_STORAGE_KEY, String(size)), [size]);
  const index = TEXT_SIZES.indexOf(size);
  return {
    size,
    smaller: index > 0 ? () => setSize(TEXT_SIZES[index - 1]) : undefined,
    larger: index < TEXT_SIZES.length - 1 ? () => setSize(TEXT_SIZES[index + 1]) : undefined,
  };
}

export type TextSize = ReturnType<typeof useTextSize>;
