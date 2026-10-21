import { getBezierPath, Position, type ConnectionLineComponentProps } from "@xyflow/react";
import { useEditor } from "./EditorContext";

const GHOST_WIDTH = 150;
const GHOST_HEIGHT = 38;

/** The line shown while dragging out of a node's handle to branch. */
export function BranchLine({ fromX, fromY, toX, toY }: ConnectionLineComponentProps) {
  const { branchOverNode } = useEditor();
  const [path] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: Position.Right,
    targetX: toX,
    targetY: toY,
    targetPosition: Position.Left,
  });
  return (
    <g className="pointer-events-none">
      <path
        d={path}
        fill="none"
        className="stroke-blue-600"
        strokeWidth={1.5}
        strokeDasharray="5 4"
      />
      <circle cx={fromX} cy={fromY} r={4} className="fill-blue-600" />
      {!branchOverNode && (
        <g transform={`translate(${toX}, ${toY - GHOST_HEIGHT / 2})`}>
          <rect
            width={GHOST_WIDTH}
            height={GHOST_HEIGHT}
            rx={6}
            className="fill-blue-50 stroke-blue-600"
            strokeDasharray="5 4"
          />
          <text x={14} y={GHOST_HEIGHT / 2 + 5} className="fill-blue-700 text-[14px] italic">
            Release to create
          </text>
        </g>
      )}
    </g>
  );
}
