import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { fileProblem } from "../../convex/model";

/**
 * A file being uploaded, shown in the list until its source is. `sourceId` is
 * set once the server has added it, which the list may hear about a little later.
 */
export type PendingUpload = {
  id: string;
  name: string;
  projectId: Id<"projects">;
  sourceId?: Id<"sources">;
};

/** How long an added file's row is kept for the list to catch up, if it never does. */
const LISTED_WITHIN_MS = 60_000;

/** Uploads files to a project's sources: each gets a one-use upload URL, then is posted to it. */
export function useUpload(
  projectId: Id<"projects"> | undefined,
  onError: (projectId: Id<"projects">, message: string) => void,
) {
  const prepareUpload = useMutation(api.sources.prepareUpload);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // An upload can finish after the panel has gone.
  const mounted = useRef(true);
  useEffect(() => {
    const pendingTimers = timers.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingTimers.forEach(clearTimeout);
    };
  }, []);
  /** Stops showing uploads, e.g. once the list has their sources. */
  const forget = (ids: string[]) => {
    for (const id of ids) {
      clearTimeout(timers.current.get(id));
      timers.current.delete(id);
    }
    setPending((uploads) => uploads.filter((upload) => !ids.includes(upload.id)));
  };

  const uploadOne = async (projectId: Id<"projects">, file: File) => {
    const problem = fileProblem(file.name, file.size);
    if (problem) return onError(projectId, problem);
    const id = crypto.randomUUID();
    setPending((uploads) => [...uploads, { id, name: file.name, projectId }]);
    const done = () => forget([id]);
    try {
      const url = await prepareUpload({ projectId, name: file.name, size: file.size });
      const response = await fetch(url, {
        method: "POST",
        headers: file.type ? { "Content-Type": file.type } : undefined,
        body: file,
      });
      const body = (await response.json().catch(() => null)) as {
        sourceId?: Id<"sources">;
        error?: string;
      } | null;
      if (!response.ok || !body?.sourceId) {
        done();
        onError(projectId, body?.error ?? `Couldn't upload ${file.name}`);
        return;
      }
      // Shown until the list has the source, which then forgets it.
      const { sourceId } = body;
      if (!mounted.current) return;
      setPending((uploads) =>
        uploads.map((upload) => (upload.id === id ? { ...upload, sourceId } : upload)),
      );
      timers.current.set(id, setTimeout(done, LISTED_WITHIN_MS));
    } catch (error) {
      console.error(error);
      done();
      onError(
        projectId,
        error instanceof ConvexError ? String(error.data) : `Couldn't upload ${file.name}`,
      );
    }
  };

  const upload = (files: Iterable<File>) => {
    if (!projectId) return;
    for (const file of files) void uploadOne(projectId, file);
  };

  return { pending, upload, forget };
}
