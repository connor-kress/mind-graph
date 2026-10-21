import type { CompareStatus } from "./compare";

export const STATUS_CLASSES: Record<CompareStatus, string> = {
  root: "border-neutral-900 bg-neutral-900 font-semibold text-white",
  recalled: "border-green-600 bg-green-50 text-neutral-900",
  misplaced: "border-yellow-500 bg-yellow-50 font-semibold text-neutral-900",
  extra: "border-red-600 bg-red-50 text-neutral-900",
  missed: "border-dashed border-neutral-400 bg-white/60 italic text-neutral-500",
};
