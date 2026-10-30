import { MAX_MAP_FILE_BYTES, parseMapFile } from "../../convex/mapFile";
import type { MapNode } from "../../convex/model";

/** A chosen map file, read and checked, or why it can't be imported. */
export type MapFileChoice = { fileName: string } & (
  { title: string; nodes: MapNode[] } | { problem: string }
);

/** Reads a file chosen for import. */
export async function readMapFile(file: File): Promise<MapFileChoice> {
  const fileName = file.name;
  if (file.size > MAX_MAP_FILE_BYTES) return { fileName, problem: "This file is too large" };
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return { fileName, problem: "This file isn't a Mind Graph map" };
  }
  try {
    return { fileName, ...parseMapFile(data) };
  } catch (error) {
    return { fileName, problem: error instanceof Error ? error.message : String(error) };
  }
}
