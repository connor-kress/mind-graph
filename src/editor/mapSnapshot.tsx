import { ReactFlow, ReactFlowProvider, useReactFlow, type Edge } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { captureMap } from "./exportImage";
import { layoutTree } from "./layout";
import { MindNode, type MindFlowNode } from "./MindNode";
import { buildTree, type MapNode, type Size } from "./tree";

const nodeTypes = { mind: MindNode };

/** How long a map gets to be drawn, so that a failure can't leave an export waiting forever. */
const MAX_WAIT_MS = 30_000;

type SnapshotProps = {
  nodes: MapNode[];
  onImage: (url: string | null) => void;
  onError: (error: unknown) => void;
};

/** A map laid out as the editor would show it, which reports its image once it's drawn. */
function Snapshot({ nodes, onImage, onError }: SnapshotProps) {
  const flow = useReactFlow<MindFlowNode>();
  const wrapper = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState(() => new Map<string, Size>());
  const tree = useMemo(() => buildTree(new Map(nodes.map((node) => [node.key, node]))), [nodes]);
  const positions = useMemo(() => layoutTree(tree, (key) => sizes.get(key)), [tree, sizes]);
  const measured = nodes.every((node) => sizes.has(node.key));

  useEffect(() => {
    if (!measured) return;
    // Give React Flow time to place the edges at the nodes' final positions.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        captureMap(wrapper.current, flow.getNodes()).then(onImage, onError);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [measured, flow, onImage, onError]);

  const flowNodes: MindFlowNode[] = nodes.map((node) => {
    const floating = !tree.depth.has(node.key);
    return {
      id: node.key,
      type: "mind",
      position: positions.get(node.key) ?? { x: 0, y: 0 },
      measured: sizes.get(node.key),
      zIndex: floating ? 10 : 0,
      data: {
        label: node.label,
        variant: node.isRoot ? "root" : floating ? "floating" : "tree",
        draft: false,
        selected: false,
        editing: false,
        caret: "all",
        dropTarget: false,
        deleteAffected: false,
        dragging: false,
      },
    };
  });
  const edges: Edge[] = nodes
    .filter((node) => node.parentKey && tree.depth.has(node.key))
    .map((node) => ({ id: node.key, source: node.parentKey!, target: node.key }));

  return (
    <div ref={wrapper} style={{ width: "100%", height: "100%" }}>
      <ReactFlow<MindFlowNode>
        nodes={flowNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={(changes) =>
          setSizes((previous) => {
            const next = new Map(previous);
            for (const change of changes) {
              if (change.type === "dimensions" && change.dimensions) {
                next.set(change.id, change.dimensions);
              }
            }
            return next;
          })
        }
        elementsSelectable={false}
        disableKeyboardA11y
      />
    </div>
  );
}

/**
 * An image of a map that may not be open, as a data URL. It's drawn out of sight
 * by the same nodes as the editor, as that's the only way to measure and show them.
 */
export async function mapImage(nodes: MapNode[]) {
  // So nodes aren't measured with a fallback font.
  await document.fonts.ready;
  const host = document.createElement("div");
  host.inert = true;
  host.style.cssText = "position:fixed;left:-20000px;top:0;width:1200px;height:800px;";
  document.body.append(host);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unmount = () => {};
  try {
    return await new Promise<string | null>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("The map took too long to draw")), MAX_WAIT_MS);
      const root = createRoot(host, { onUncaughtError: reject });
      unmount = () => root.unmount();
      root.render(
        <ReactFlowProvider>
          <Snapshot nodes={nodes} onImage={resolve} onError={reject} />
        </ReactFlowProvider>,
      );
    });
  } finally {
    clearTimeout(timer);
    unmount();
    host.remove();
  }
}
