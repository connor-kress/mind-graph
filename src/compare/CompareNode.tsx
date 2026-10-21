import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { NODE_BASE } from "../editor/nodeStyle";
import type { CompareStatus, Note } from "./compare";
import { StatusBadge } from "./StatusBadge";
import { STATUS_CLASSES } from "./statusStyle";

export type CompareNodeData = {
  label: string;
  status: CompareStatus;
  note?: Note;
  /** The student's own label, for manual matches (which show the reference's). */
  answer?: string;
  /** A placeholder whose match is elsewhere; clicking it selects that node. */
  linked: boolean;
  revealed: boolean;
  selected: boolean;
  dropTarget: boolean;
  dragging: boolean;
};

export type CompareFlowNode = Node<CompareNodeData, "compare">;

const NOTE_CLASSES: Partial<Record<CompareStatus, string>> = {
  misplaced: "bg-yellow-700",
  belongs: "bg-yellow-700",
  extra: "bg-red-700",
};

const DROP_TARGET = "border-dashed border-blue-600 bg-blue-50 text-neutral-900";

function CompareNodeView({ data }: NodeProps<CompareFlowNode>) {
  const revealable = data.answer !== undefined;
  return (
    <div
      className={`${NODE_BASE} ${data.dropTarget ? DROP_TARGET : STATUS_CLASSES[data.status]} ${
        data.selected ? "ring-4 ring-blue-500/20" : ""
      } ${data.dragging ? "shadow-lg" : ""} ${(revealable && data.status !== "extra") || data.linked ? "cursor-pointer" : ""}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="anchor-handle"
      />
      {revealable ? (
        // Both labels share one cell, so revealing doesn't resize the node.
        <div className="grid whitespace-pre-wrap break-words group-hover:text-neutral-500">
          <span className={`col-start-1 row-start-1 ${data.revealed ? "invisible" : ""}`}>
            {data.label}
          </span>
          <span className={`col-start-1 row-start-1 ${data.revealed ? "" : "invisible"}`}>
            {data.answer}
          </span>
        </div>
      ) : (
        <div className="whitespace-pre-wrap break-words">{data.label}</div>
      )}
      <StatusBadge
        status={data.status}
        className="pointer-events-none absolute -right-2 -top-2 not-italic ring-2 ring-white"
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="anchor-handle"
      />
      {revealable && !data.revealed && !data.dragging && (
        <div className="pointer-events-none absolute bottom-full left-1/2 mb-2.5 hidden w-max -translate-x-1/2 rounded-md bg-neutral-900 px-2 py-1 text-xs font-normal not-italic text-white shadow-md group-hover:block">
          Reveal your answer
        </div>
      )}
      {data.note && !data.dragging && (
        <div
          className={`pointer-events-none absolute left-full top-1/2 ml-3 w-max max-w-56 -translate-y-1/2 rounded-md px-2.5 py-1.5 text-xs font-normal not-italic text-white shadow-md ${
            NOTE_CLASSES[data.status] ?? "bg-neutral-700"
          } ${data.selected ? "block" : "hidden group-hover:block"}`}
        >
          {data.note.map((part, i) =>
            typeof part === "string" ? (
              part
            ) : (
              <em key={i} className="italic">
                {part.em}
              </em>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export const CompareNode = memo(CompareNodeView);
