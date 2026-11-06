import type { PDFDocumentLoadingTask } from "pdfjs-dist";
import { MAX_SOURCE_PAGES } from "../../convex/model";

/** How many pages a PDF has, or null if it can't tell, such as when it has a password. */
async function pageCount(file: File) {
  let task: PDFDocumentLoadingTask | undefined;
  try {
    const [pdfjs, worker] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    task = pdfjs.getDocument({ data: await file.arrayBuffer() });
    return (await task.promise).numPages;
  } catch (error) {
    console.warn("Couldn't count a PDF's pages", error);
    return null;
  } finally {
    await task?.destroy().catch(() => {});
  }
}

/**
 * Why a PDF won't be transcribed, or null if it looks fine, so it's not uploaded
 * only to be refused. The runner checks this too, and has the final say.
 */
export async function pdfProblem(file: File) {
  const pages = await pageCount(file);
  if (pages !== null && pages > MAX_SOURCE_PAGES) {
    return `${file.name} has ${pages} pages. PDFs of up to ${MAX_SOURCE_PAGES} pages can be transcribed.`;
  }
  return null;
}
