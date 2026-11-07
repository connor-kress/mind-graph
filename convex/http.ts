import { httpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { imageTypeOf } from "./model";
import {
  chargeEndpoint,
  claimEndpoint,
  completeEndpoint,
  failEndpoint,
  heartbeatEndpoint,
  uploadEndpoint,
} from "./runner";

const http = httpRouter();

// The app is on another origin. The ticket in the URL is the credential, not cookies.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST",
  "Access-Control-Allow-Headers": "Content-Type",
};

http.route({
  path: "/sources/upload",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: cors })),
});

/** A request's body, read into one buffer of the expected size rather than trusting Content-Length. */
async function readBody(request: Request, expected: number, name: string) {
  const bytes = new Uint8Array(expected);
  let size = 0;
  const reader = request.body?.getReader();
  for (;;) {
    const chunk = await reader?.read();
    if (!chunk || chunk.done) break;
    if (size + chunk.value.byteLength > expected) {
      await reader!.cancel();
      return { problem: `${name} is larger than when the upload started` };
    }
    bytes.set(chunk.value, size);
    size += chunk.value.byteLength;
  }
  if (size !== expected) return { problem: `${name} didn't upload completely. Try again.` };
  return { bytes };
}

/**
 * Stores a file for an upload ticket from `sources.prepareUpload`, and adds it
 * as a source. For one from `sources.prepareNoteImport`, it holds each image
 * named in the URL on the ticket, then adds the note and all of its images.
 */
http.route({
  path: "/sources/upload",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const stored: Id<"_storage">[] = [];
    const fail = async (error: string, status = 400) => {
      await Promise.all(
        stored.map((id) =>
          ctx.storage
            .delete(id)
            .catch((cleanup) =>
              console.error("Couldn't delete an upload that failed", id, cleanup),
            ),
        ),
      );
      return Response.json({ error }, { status, headers: cors });
    };
    const expired = "This upload expired. Try again.";
    try {
      const url = new URL(request.url);
      const token = url.searchParams.get("token");
      const image = url.searchParams.get("image");

      if (image !== null) {
        const wanted =
          token && (await ctx.runQuery(internal.sources.imageUpload, { token, image }));
        if (!wanted) return await fail(expired, 403);
        const { bytes, problem } = await readBody(request, wanted.size, image);
        if (!bytes) return await fail(problem);
        // The bytes say what it is, as it will be shown as whatever it's stored as.
        const type = imageTypeOf(bytes);
        if (!type) return await fail(`${image} isn't a PNG, JPEG, WebP, or GIF image`);
        const storageId = await ctx.storage.store(new Blob([bytes], { type }));
        stored.push(storageId);
        await ctx.runMutation(internal.sources.holdImage, { token, image, storageId });
        return Response.json({}, { headers: cors });
      }

      const ticket = token && (await ctx.runMutation(internal.sources.claimUpload, { token }));
      if (!ticket) return await fail(expired, 403);

      const { bytes, problem } = await readBody(request, ticket.size, ticket.name);
      if (!bytes) return await fail(problem);
      const type = request.headers.get("Content-Type") || "application/octet-stream";
      const storageId = await ctx.storage.store(new Blob([bytes], { type }));
      stored.push(storageId);
      const sourceId = await ctx.runMutation(internal.sources.completeUpload, {
        ...ticket,
        storageId,
      });
      return Response.json({ sourceId }, { headers: cors });
    } catch (error) {
      if (error instanceof ConvexError) return await fail(String(error.data), 403);
      console.error("Upload failed", error);
      return await fail("Couldn't upload the file. Try again.", 500);
    }
  }),
});

// The document runner's endpoints. It calls them from a server, so they need no CORS.
http.route({ path: "/runner/claim", method: "POST", handler: claimEndpoint });
http.route({ path: "/runner/heartbeat", method: "POST", handler: heartbeatEndpoint });
http.route({ path: "/runner/upload", method: "POST", handler: uploadEndpoint });
http.route({ path: "/runner/complete", method: "POST", handler: completeEndpoint });
http.route({ path: "/runner/fail", method: "POST", handler: failEndpoint });
http.route({ path: "/runner/charge", method: "POST", handler: chargeEndpoint });

export default http;
