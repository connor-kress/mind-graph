import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo, useLayoutEffect, useRef, useState } from "react";
import { MAX_LABEL_LENGTH } from "../../convex/model";
import { useEditor, type CommitVia } from "./EditorContext";

export type MindNodeData = {
  label: string;
  variant: "root" | "tree" | "floating";
  draft: boolean;
  selected: boolean;
  editing: boolean;
  dropTarget: boolean;
  deleteAffected: boolean;
  dragging: boolean;
};

export type MindFlowNode = Node<MindNodeData, "mind">;

const PLACEHOLDER = "New node";

function nodeClasses(data: MindNodeData) {
  const classes = [
    "mind-node group relative w-max min-w-[7.5rem] max-w-[15rem] rounded-md border px-3.5 py-2",
    "text-[15px] leading-snug transition-[box-shadow,background-color,border-color] duration-150",
  ];
  if (data.dropTarget) {
    classes.push("border-dashed border-blue-600 bg-blue-50 text-neutral-900");
  } else if (data.deleteAffected) {
    classes.push("border-dashed border-orange-500 bg-orange-50 text-neutral-900");
  } else if (data.draft) {
    classes.push("border-dashed border-blue-600 bg-blue-50/70 text-blue-900");
  } else if (data.variant === "root") {
    classes.push("border-neutral-900 bg-neutral-900 font-semibold text-white");
  } else {
    classes.push("border-neutral-800 bg-white text-neutral-900");
  }
  if (data.variant === "floating" && !data.draft) {
    classes.push("shadow-[0_2px_8px_rgba(0,0,0,0.12)]");
  }
  if (data.selected || data.editing) {
    classes.push(
      data.variant === "root"
        ? "ring-2 ring-blue-500 ring-offset-2"
        : "border-blue-600 ring-4 ring-blue-500/20",
    );
  }
  if (data.dragging) classes.push("shadow-lg");
  return classes.join(" ");
}

function MindNodeView({ id, data }: NodeProps<MindFlowNode>) {
  return (
    <div className={nodeClasses(data)} data-selected={data.selected}>
      {data.variant !== "root" && (
        <Handle
          type="target"
          position={Position.Left}
          isConnectable={false}
          className="anchor-handle"
        />
      )}
      {data.editing ? (
        <LabelEditor nodeKey={id} initial={data.label} />
      ) : (
        <div className="whitespace-pre-wrap break-words">
          {data.label || <span className="italic text-blue-700/70">{PLACEHOLDER}</span>}
        </div>
      )}
      {data.variant !== "floating" && (
        <Handle
          type="source"
          position={Position.Right}
          isConnectable={!data.draft && !data.editing}
          className="branch-handle"
          title="Drag to add a child"
        />
      )}
    </div>
  );
}

function LabelEditor({ nodeKey, initial }: { nodeKey: string; initial: string }) {
  const { actions } = useEditor();
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  // New nodes stay hidden until React Flow measures them, and hidden elements
  // can't take focus, so keep trying for a while.
  useLayoutEffect(() => {
    let frame = 0;
    let attempts = 0;
    const focus = () => {
      const el = ref.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      if (document.activeElement === el) el.select();
      else if (attempts++ < 60) frame = requestAnimationFrame(focus);
    };
    focus();
    return () => cancelAnimationFrame(frame);
  }, []);

  const finish = (via: CommitVia) => {
    if (done.current) return;
    done.current = true;
    actions.commitEdit(nodeKey, value, via);
  };

  return (
    <div className="relative">
      {/* Invisible copy of the text that gives the node its size. */}
      <div aria-hidden className="invisible whitespace-pre-wrap break-words">
        {value || PLACEHOLDER}
        {"​"}
      </div>
      <textarea
        ref={ref}
        value={value}
        rows={1}
        spellCheck={false}
        placeholder={PLACEHOLDER}
        maxLength={MAX_LABEL_LENGTH}
        aria-label="Node label"
        className="nodrag nopan nowheel absolute inset-0 resize-none overflow-hidden bg-transparent p-0 outline-none placeholder:italic placeholder:text-blue-700/60"
        onChange={(e) => setValue(e.target.value.replace(/[\r\n]+/g, " "))}
        onBlur={() => {
          // Switching windows blurs too; keep editing (focus returns with the window).
          if (document.hasFocus()) finish("blur");
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          // Let input methods use Enter and Escape to pick candidates.
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          // A held Enter/Tab would otherwise commit the next draft while empty.
          if (e.repeat && (e.key === "Enter" || e.key === "Tab")) {
            e.preventDefault();
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            finish("enter");
          } else if (e.key === "Tab") {
            e.preventDefault();
            finish("tab");
          } else if (e.key === "Escape") {
            e.preventDefault();
            done.current = true;
            actions.cancelEdit(nodeKey);
          }
        }}
      />
    </div>
  );
}

export const MindNode = memo(MindNodeView);
