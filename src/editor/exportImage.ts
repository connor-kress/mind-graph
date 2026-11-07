import { getNodesBounds, useReactFlow, type Node } from "@xyflow/react";
import { toPng } from "html-to-image";
import { FileJson, ImageDown } from "lucide-react";
import { useEffect, type RefObject } from "react";
import type { MapFile } from "../../convex/mapFile";

const PADDING = 40;
const PIXEL_RATIO = 2;
/** Larger images are drawn at a lower resolution so browsers can still encode them. */
const MAX_SIDE = 8000;
const BACKGROUND = "#fafafa";

/** The ways a map can be exported, as menus offer them. */
export const MAP_EXPORTS = [
  { format: "png", label: "Export as PNG", Icon: ImageDown },
  { format: "json", label: "Export as JSON", Icon: FileJson },
] as const;

export type MapExportFormat = (typeof MAP_EXPORTS)[number]["format"];

/** An image of the given nodes as they're drawn in `root`, or null if there's nothing to show. */
export async function captureMap(root: HTMLElement | null, nodes: Node[]) {
  const viewport = root?.querySelector<HTMLElement>(".react-flow__viewport");
  if (!root || !viewport || !nodes.length) return null;
  const bounds = getNodesBounds(nodes);
  const width = Math.ceil(bounds.width + 2 * PADDING);
  const height = Math.ceil(bounds.height + 2 * PADDING);
  root.classList.add("exporting");
  try {
    return await toPng(viewport, {
      width,
      height,
      pixelRatio: Math.min(PIXEL_RATIO, MAX_SIDE / Math.max(width, height)),
      backgroundColor: BACKGROUND,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${PADDING - bounds.x}px, ${PADDING - bounds.y}px)`,
      },
      filter: (node) => !node.classList?.contains("react-flow__handle"),
    });
  } finally {
    root.classList.remove("exporting");
  }
}

type Capture = () => Promise<string | null>;

// The map on screen, which lives in its own ReactFlowProvider away from the
// top bar's export button.
let capture: Capture | null = null;

/** Makes the map in `container` the one `downloadMapImage` saves while it's shown. */
export function useImageExport(container: RefObject<HTMLElement | null>) {
  const flow = useReactFlow();
  useEffect(() => {
    const current: Capture = () => captureMap(container.current, flow.getNodes());
    capture = current;
    return () => {
      if (capture === current) capture = null;
    };
  }, [container, flow]);
}

/** Saves the map on screen as `<name>.png`. */
export async function downloadMapImage(name: string) {
  const url = await capture?.();
  if (!url) throw new Error("There's no map to export yet");
  saveMapImage(name, url);
}

/** Saves an image of a map, from its URL, as `<name>.png`. */
export function saveMapImage(name: string, url: string) {
  saveFile(`${name}.png`, url);
}

/** Saves a map's contents as `<name>.json`, to be imported later. */
export function downloadMapFile(name: string, file: MapFile) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }),
  );
  saveFile(`${name}.json`, url);
  // After the download has started.
  setTimeout(() => URL.revokeObjectURL(url));
}

function saveFile(name: string, href: string) {
  const link = document.createElement("a");
  link.download = name;
  link.href = href;
  link.click();
}

/** A filename-safe version of a map title, e.g. "Cell Biology: Basics" → "cell-biology-basics". */
export function fileName(title: string) {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  return slug || "map";
}
