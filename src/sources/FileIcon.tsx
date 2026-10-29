import type { SourceKind } from "../../convex/model";

const STYLE: Record<SourceKind, { label: string; color: string }> = {
  md: { label: "MD", color: "bg-neutral-600" },
  txt: { label: "TXT", color: "bg-neutral-500" },
  docx: { label: "DOC", color: "bg-blue-600" },
  pdf: { label: "PDF", color: "bg-red-600" },
  pptx: { label: "PPT", color: "bg-orange-600" },
};

/** A file-type badge, for files without a thumbnail. */
export function FileIcon({ kind }: { kind?: SourceKind }) {
  const { label, color } = kind ? STYLE[kind] : { label: "", color: "bg-neutral-400" };
  return (
    <span
      aria-hidden
      className={`flex h-9 w-7 shrink-0 items-end justify-center rounded-sm pb-1 text-[9px] font-bold tracking-wide text-white ${color}`}
    >
      {label}
    </span>
  );
}
