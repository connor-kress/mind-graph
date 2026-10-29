import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { fileProblem } from "../../convex/model";

/** A file being uploaded, shown in the list until the server has added it. */
export type PendingUpload = { id: string; name: string };

/** Uploads files to a topic's sources: each is posted to file storage, then added. */
export function useUpload(topicId: Id<"topics"> | undefined, onError: (message: string) => void) {
  const generateUploadUrl = useMutation(api.sources.generateUploadUrl);
  const add = useMutation(api.sources.add);
  const [pending, setPending] = useState<PendingUpload[]>([]);

  const uploadOne = async (topicId: Id<"topics">, file: File) => {
    const problem = fileProblem(file.name, file.size);
    if (problem) return onError(problem);
    const id = crypto.randomUUID();
    setPending((uploads) => [...uploads, { id, name: file.name }]);
    try {
      const response = await fetch(await generateUploadUrl(), {
        method: "POST",
        headers: file.type ? { "Content-Type": file.type } : undefined,
        body: file,
      });
      if (!response.ok) throw new Error(`Upload failed with status ${response.status}`);
      const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
      // Resolves once the new source is in the list.
      const result = await add({ topicId, storageId, name: file.name });
      if (result.error) onError(result.error);
    } catch (error) {
      console.error(error);
      onError(error instanceof ConvexError ? String(error.data) : `Couldn't upload ${file.name}`);
    } finally {
      setPending((uploads) => uploads.filter((upload) => upload.id !== id));
    }
  };

  const upload = (files: Iterable<File>) => {
    if (!topicId) return;
    for (const file of files) void uploadOne(topicId, file);
  };

  return { pending, upload };
}
