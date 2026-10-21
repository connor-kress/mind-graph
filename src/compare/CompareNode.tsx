import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { NODE_BASE } from "../editor/nodeStyle";
import type { CompareStatus } from "./compare";
import { StatusBadge } from "./StatusBadge";
import { STATUS_CLASSES } from "./statusStyle";

export type CompareNodeData = {
  label: string;
  status: CompareStatus;
  note?: string;
  selected: boolean;
};

export type CompareFlowNode = Node<CompareNodeData, "compare">;

const NOTE_CLASSES: Partial<Record<CompareStatus, string>> = {
  misplaced: "bg-yellow-700",
  extra: "bg-red-700",
};

function CompareNodeView({ data }: NodeProps<CompareFlowNode>) {
  return (
    <div
      className={`${NODE_BASE} ${STATUS_CLASSES[data.status]} ${
        data.selected ? "ring-4 ring-blue-500/20" : ""
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="anchor-handle"
      />
      <div className="whitespace-pre-wrap break-words">{data.label}</div>
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
      {data.note && (
        <div
          className={`pointer-events-none absolute left-full top-1/2 ml-3 w-max max-w-56 -translate-y-1/2 rounded-md px-2.5 py-1.5 text-xs font-normal not-italic text-white shadow-md ${
            NOTE_CLASSES[data.status] ?? "bg-neutral-700"
          } ${data.selected ? "block" : "hidden group-hover:block"}`}
        >
          {data.note}
        </div>
      )}
    </div>
  );
}

export const CompareNode = memo(CompareNodeView);
