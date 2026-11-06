import { httpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
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

/** Stores a file for an upload ticket from `sources.prepareUpload`, and adds it as a source. */
http.route({
  path: "/sources/upload",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const fail = (error: string, status = 400) =>
      Response.json({ error }, { status, headers: cors });
    let storageId: Id<"_storage"> | undefined;
    try {
      const token = new URL(request.url).searchParams.get("token");
      const ticket = token && (await ctx.runMutation(internal.sources.claimUpload, { token }));
      if (!ticket) return fail("This upload expired. Try again.", 403);

      // Read into one buffer of the ticket's size, rather than trusting Content-Length.
      const bytes = new Uint8Array(ticket.size);
      let size = 0;
      const reader = request.body?.getReader();
      for (;;) {
        const chunk = await reader?.read();
        if (!chunk || chunk.done) break;
        if (size + chunk.value.byteLength > ticket.size) {
          await reader!.cancel();
          return fail(`${ticket.name} is larger than when the upload started`);
        }
        bytes.set(chunk.value, size);
        size += chunk.value.byteLength;
      }
      if (size !== ticket.size) return fail(`${ticket.name} didn't upload completely. Try again.`);

      const type = request.headers.get("Content-Type") || "application/octet-stream";
      storageId = await ctx.storage.store(new Blob([bytes], { type }));
      const sourceId = await ctx.runMutation(internal.sources.completeUpload, {
        ...ticket,
        storageId,
      });
      return Response.json({ sourceId }, { headers: cors });
    } catch (error) {
      if (storageId) {
        const id = storageId;
        await ctx.storage
          .delete(id)
          .catch((cleanup) => console.error("Couldn't delete an upload that failed", id, cleanup));
      }
      if (error instanceof ConvexError) return fail(String(error.data), 403);
      console.error("Upload failed", error);
      return fail("Couldn't upload the file. Try again.", 500);
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
