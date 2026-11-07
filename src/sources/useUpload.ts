import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { fileProblem, kindOfFile } from "../../convex/model";
import { isNoteZip, NoteZipProblem, readNoteZip } from "./noteZip";
import { pdfProblem } from "./pdfProblem";

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

/** Posts a file to an upload URL, returning what the server said about it. */
async function post(url: string, body: Blob) {
  const response = await fetch(url, {
    method: "POST",
    headers: body.type ? { "Content-Type": body.type } : undefined,
    body,
  });
  const result = (await response.json().catch(() => null)) as {
    sourceId?: Id<"sources">;
    error?: string;
  } | null;
  return { ...result, ok: response.ok };
}

/** Uploads files to a project's sources: each gets a one-use upload URL, then is posted to it. */
export function useUpload(
  projectId: Id<"projects"> | undefined,
  onError: (projectId: Id<"projects">, message: string) => void,
) {
  const prepareUpload = useMutation(api.sources.prepareUpload);
  const prepareNoteImport = useMutation(api.sources.prepareNoteImport);
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
  const forget = useCallback((ids: string[]) => {
    for (const id of ids) {
      clearTimeout(timers.current.get(id));
      timers.current.delete(id);
    }
    setPending((uploads) => uploads.filter((upload) => !ids.includes(upload.id)));
  }, []);

  /** Sends a zip's images, then returns the URL for its note and the note itself. */
  const prepareZip = async (projectId: Id<"projects">, zip: File) => {
    const { name, markdown, images } = await readNoteZip(zip);
    const body = new Blob([markdown], { type: "text/markdown" });
    const { url, imageUrls } = await prepareNoteImport({
      projectId,
      name,
      size: body.size,
      images: images.map((image) => ({ name: image.name, size: image.bytes.length })),
    });
    // One at a time, as each one updates the same ticket.
    for (const [i, { type, bytes }] of images.entries()) {
      const { ok, error } = await post(imageUrls[i], new Blob([bytes], { type }));
      if (!ok) throw new NoteZipProblem(error ?? `Couldn't upload ${zip.name}`);
    }
    return { url, body };
  };

  const uploadOne = async (projectId: Id<"projects">, file: File) => {
    const zip = isNoteZip(file.name);
    const problem = zip ? null : fileProblem(file.name, file.size);
    if (problem) return onError(projectId, problem);
    const id = crypto.randomUUID();
    setPending((uploads) => [...uploads, { id, name: file.name, projectId }]);
    const done = () => forget([id]);
    try {
      const tooLarge = kindOfFile(file.name) === "pdf" ? await pdfProblem(file) : null;
      if (tooLarge) {
        done();
        onError(projectId, tooLarge);
        return;
      }
      const { url, body } = zip
        ? await prepareZip(projectId, file)
        : {
            url: await prepareUpload({ projectId, name: file.name, size: file.size }),
            body: file,
          };
      const { ok, sourceId, error } = await post(url, body);
      if (!ok || !sourceId) {
        done();
        onError(projectId, error ?? `Couldn't upload ${file.name}`);
        return;
      }
      // Shown until the list has the source, which then forgets it.
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
        error instanceof ConvexError
          ? String(error.data)
          : error instanceof NoteZipProblem
            ? error.message
            : `Couldn't upload ${file.name}`,
      );
    }
  };

  const upload = (files: Iterable<File>) => {
    if (!projectId) return;
    for (const file of files) void uploadOne(projectId, file);
  };

  return { pending, upload, forget };
}
