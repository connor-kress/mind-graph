import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MAX_LABEL_LENGTH } from "../../convex/model";
import { onCommitEdits } from "./commitEdits";
import { useEditor, type CommitVia } from "./EditorContext";
import { NODE_BASE } from "./nodeStyle";

/**
 * How editing a label starts: with all of it selected, the cursor at one end,
 * or the text cleared.
 */
export type Caret = "all" | "start" | "end" | "clear";

export type MindNodeData = {
  label: string;
  variant: "root" | "tree" | "floating";
  draft: boolean;
  selected: boolean;
  editing: boolean;
  caret: Caret;
  dropTarget: boolean;
  deleteAffected: boolean;
  dragging: boolean;
};

export type MindFlowNode = Node<MindNodeData, "mind">;

const PLACEHOLDER = "New node";

function nodeClasses(data: MindNodeData) {
  const classes = [
    "mind-node",
    NODE_BASE,
    "transition-[box-shadow,background-color,border-color] duration-150",
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
    <div className={nodeClasses(data)} data-selected={data.selected} data-variant={data.variant}>
      {data.variant !== "root" && (
        <Handle
          type="target"
          position={Position.Left}
          isConnectable={false}
          className="anchor-handle"
        />
      )}
      {data.editing ? (
        <LabelEditor nodeKey={id} initial={data.label} caret={data.caret} />
      ) : (
        <div className="whitespace-pre-wrap break-words">
          {data.label || <span className="italic text-blue-700/70">{PLACEHOLDER}</span>}
        </div>
      )}
      {/* Always rendered: React Flow only measures handles when a node resizes,
          so one added when a floating node is linked would never get edges. */}
      {data.variant === "floating" ? (
        <Handle
          type="source"
          position={Position.Right}
          isConnectable={false}
          className="anchor-handle"
        />
      ) : (
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

type LabelEditorProps = { nodeKey: string; initial: string; caret: Caret };

function LabelEditor({ nodeKey, initial, caret }: LabelEditorProps) {
  const { actions } = useEditor();
  const [value, setValue] = useState(caret === "clear" ? "" : initial);
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
      if (document.activeElement === el) {
        if (caret === "all") el.select();
        else {
          const at = caret === "start" ? 0 : el.value.length;
          el.setSelectionRange(at, at);
        }
      } else if (attempts++ < 60) frame = requestAnimationFrame(focus);
    };
    focus();
    return () => cancelAnimationFrame(frame);
  }, [caret]);

  const finish = (via: CommitVia) => {
    if (done.current) return;
    done.current = true;
    actions.commitEdit(nodeKey, value, via);
  };

  // Commit when the app is about to switch views (e.g. "Finish and compare").
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => onCommitEdits(() => finishRef.current("blur")), []);

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
          // Escape keeps the text too, like Enter.
          if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();
            finish("enter");
          } else if (e.key === "Tab") {
            e.preventDefault();
            finish("tab");
          }
        }}
      />
    </div>
  );
}

export const MindNode = memo(MindNodeView);
