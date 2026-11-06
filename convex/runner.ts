/// <reference types="node" />
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { MAX_SOURCE_PAGES } from "./model";
import { addUsage, isOverLimit, OVER_LIMIT, usageForRequest } from "./usage";

// The document runner transcribes queued sources. It asks for work over these
// endpoints; Convex never needs to reach it, though it can nudge a runner with
// a public address to ask now. Each request is signed with RUNNER_SECRET.

/** How long a claim lasts without a heartbeat. */
export const LEASE_MS = 2 * 60_000;
/** Claims a source can use up before it's marked failed, e.g. when the runner keeps crashing. */
export const MAX_ATTEMPTS = 3;
/** Files of one user's transcribed at once, so one user's queue doesn't hold up everyone else's. */
export const MAX_JOBS_PER_USER = 3;
/** How far a signed request's time can be from Convex's, either way. */
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
export const MAX_ASSETS = 200;
/** Bytes in any one file of a result: the Markdown, or an image. */
export const MAX_RESULT_BYTES = 10 * 1024 * 1024;
/** Bytes in a request that isn't an upload. */
const MAX_JSON_BYTES = 256 * 1024;
const MAX_ERROR_LENGTH = 500;
const CANCEL_BATCH = 100;
const ASSET_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const MARKDOWN_TYPE = "text/markdown; charset=utf-8";
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

const STALLED = "Transcription stopped before it finished. Try again.";
const FAILED = "Couldn't transcribe this file.";

const encoder = new TextEncoder();

/**
 * Hex HMAC-SHA256 of a request, as the runner computes it: of its time,
 * method, path with any query, and body, each but the body followed by a newline.
 */
export async function sign(
  secret: string,
  timestamp: string,
  method: string,
  path: string,
  body: string | Uint8Array<ArrayBuffer>,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const head = encoder.encode(`${timestamp}\n${method}\n${path}\n`);
  const tail = typeof body === "string" ? encoder.encode(body) : body;
  const message = new Uint8Array(head.length + tail.length);
  message.set(head);
  message.set(tail, head.length);
  const mac = await crypto.subtle.sign("HMAC", key, message);
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A request's body, or null if it's longer than limit bytes, which are all that are read. */
export async function readAtMost(request: Request, limit: number) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  for (;;) {
    const chunk = await reader?.read();
    if (!chunk || chunk.done) break;
    size += chunk.value.byteLength;
    if (size > limit) {
      await reader!.cancel();
      return null;
    }
    chunks.push(chunk.value);
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.byteLength;
  }
  return body;
}

/** Compares in time independent of where they differ. */
function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type Reply = { status?: number; body: unknown };

/**
 * An endpoint for the runner. The handler gets the request's body once its
 * signature checks out, and returns the JSON response body.
 */
function signedEndpoint(
  maxBytes: number,
  handler: (
    ctx: ActionCtx,
    body: Uint8Array<ArrayBuffer>,
    url: URL,
    request: Request,
  ) => Promise<Reply>,
) {
  return httpAction(async (ctx, request) => {
    const secret = process.env.RUNNER_SECRET;
    if (!secret) return Response.json({ error: "No runner is configured" }, { status: 503 });
    const timestamp = request.headers.get("X-Runner-Timestamp") ?? "";
    const signature = request.headers.get("X-Runner-Signature") ?? "";
    const unsigned = Response.json({ error: "Bad signature" }, { status: 401 });
    // Checked before reading the body, so a request that can't be valid costs little.
    if (
      !/^[0-9a-f]{64}$/.test(signature) ||
      !(Math.abs(Date.now() - Number(timestamp)) <= MAX_CLOCK_SKEW_MS)
    ) {
      return unsigned;
    }
    const tooLarge = Response.json({ error: "Too large" }, { status: 413 });
    if (Number(request.headers.get("Content-Length") ?? 0) > maxBytes) return tooLarge;
    const url = new URL(request.url);
    const body = await readAtMost(request, maxBytes);
    if (!body) return tooLarge;
    const expected = await sign(secret, timestamp, request.method, url.pathname + url.search, body);
    if (!sameText(signature, expected)) return unsigned;
    try {
      const result = await handler(ctx, body, url, request);
      return Response.json(result.body, { status: result.status ?? 200 });
    } catch (error) {
      console.error("Runner request failed", url.pathname, error);
      return Response.json({ error: "Request failed" }, { status: 400 });
    }
  });
}

/** An endpoint for the runner that takes a JSON object. */
function jsonEndpoint(handler: (ctx: ActionCtx, body: Record<string, unknown>) => Promise<Reply>) {
  return signedEndpoint(MAX_JSON_BYTES, async (ctx, bytes) => {
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return { status: 400, body: { error: "Expected JSON" } };
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return { status: 400, body: { error: "Expected a JSON object" } };
    }
    return handler(ctx, body as Record<string, unknown>);
  });
}

const lost = { status: 409, body: { error: "This job is no longer yours" } };

export const claimEndpoint = jsonEndpoint(async (ctx) => ({
  body: { job: await ctx.runMutation(internal.runner.claim, {}) },
}));

export const heartbeatEndpoint = jsonEndpoint(async (ctx, body) => {
  const expiresAt = await ctx.runMutation(internal.runner.heartbeat, lease(body));
  return expiresAt === null ? lost : { body: { expiresAt } };
});

/**
 * Stores one file of a claim's result, given as the body. It's recorded
 * against the claim, which is the only one that can use it.
 */
export const uploadEndpoint = signedEndpoint(MAX_RESULT_BYTES, async (ctx, body, url, request) => {
  const claim = lease(Object.fromEntries(url.searchParams));
  const type = request.headers.get("Content-Type") ?? "";
  if (type !== MARKDOWN_TYPE && !IMAGE_TYPES.includes(type)) {
    return { status: 400, body: { error: "Unexpected file type" } };
  }
  if (!(await ctx.runQuery(internal.runner.isLive, claim))) return lost;
  const storageId = await ctx.storage.store(new Blob([body], { type }));
  let recorded = false;
  try {
    recorded = await ctx.runMutation(internal.runner.recordUpload, { ...claim, storageId });
  } finally {
    // Unrecorded, nothing would ever delete it.
    if (!recorded) await ctx.storage.delete(storageId);
  }
  if (!recorded) return lost;
  return { body: { storageId } };
});

export const completeEndpoint = jsonEndpoint(async (ctx, body) => {
  const assets = Array.isArray(body.assets) ? body.assets : [];
  const done = await ctx.runMutation(internal.runner.complete, {
    ...lease(body),
    markdownId: body.markdownId as Id<"_storage">,
    pageCount: typeof body.pageCount === "number" ? body.pageCount : undefined,
    assets: assets.map((asset) => ({
      name: String(asset?.name),
      storageId: asset?.storageId as Id<"_storage">,
    })),
    costUsd: costOf(body),
  });
  return done ? { body: {} } : lost;
});

export const failEndpoint = jsonEndpoint(async (ctx, body) => {
  const done = await ctx.runMutation(internal.runner.fail, {
    ...lease(body),
    error: String(body.error ?? ""),
    release: body.release === true,
    costUsd: costOf(body),
  });
  return done ? { body: {} } : lost;
});

/**
 * Counts what a job cost whose claim was lost, so has no source to charge, e.g.
 * because it was deleted while it was being transcribed.
 */
export const chargeEndpoint = jsonEndpoint(async (ctx, body) => {
  if (typeof body.userId !== "string" || !body.userId) {
    return { status: 400, body: { error: "Expected a user" } };
  }
  await ctx.runMutation(internal.runner.chargeUser, {
    userId: body.userId,
    costUsd: costOf(body),
  });
  return { body: {} };
});

/** What a job says it cost so far. */
function costOf(body: Record<string, unknown>) {
  const { costUsd } = body;
  return typeof costUsd === "number" && Number.isFinite(costUsd) && costUsd > 0 ? costUsd : 0;
}

/** The claim a request names. Convex validates the ID when it's used. */
function lease(body: Record<string, unknown>) {
  return { sourceId: body.sourceId as Id<"sources">, token: String(body.token ?? "") };
}

/** The source a claim is for, if it's still that claim's, even if it has run out. */
async function claimed(ctx: QueryCtx, sourceId: Id<"sources">, token: string) {
  const source = await ctx.db.get(sourceId);
  if (source?.status !== "processing" || !source.lease || !sameText(source.lease.token, token))
    return null;
  return source as Doc<"sources"> & { lease: NonNullable<Doc<"sources">["lease"]> };
}

/** The source a claim is for, if the claim is still the runner's to use. */
async function leased(ctx: QueryCtx, sourceId: Id<"sources">, token: string) {
  const source = await claimed(ctx, sourceId, token);
  return source && source.lease.expiresAt > Date.now() ? source : null;
}

export const isLive = internalQuery({
  args: { sourceId: v.id("sources"), token: v.string() },
  handler: async (ctx, { sourceId, token }) => !!(await leased(ctx, sourceId, token)),
});

export const recordUpload = internalMutation({
  args: { sourceId: v.id("sources"), token: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    if (!(await leased(ctx, args.sourceId, args.token))) return false;
    await ctx.db.insert("runnerUploads", args);
    return true;
  },
});

/** Deletes the files a claim uploaded, except those kept for its result. */
async function endClaim(
  ctx: MutationCtx,
  sourceId: Id<"sources">,
  token: string | undefined,
  keep = new Set<Id<"_storage">>(),
) {
  const uploads = await ctx.db
    .query("runnerUploads")
    .withIndex("by_claim", (q) =>
      token === undefined
        ? q.eq("sourceId", sourceId)
        : q.eq("sourceId", sourceId).eq("token", token),
    )
    .collect();
  for (const upload of uploads) {
    if (!keep.has(upload.storageId)) await ctx.storage.delete(upload.storageId);
    await ctx.db.delete(upload._id);
  }
}

/** Puts a source whose claim ran out back in the queue, or fails it after too many tries. */
async function requeue(ctx: MutationCtx, source: Doc<"sources">) {
  if (source.lease) await endClaim(ctx, source._id, source.lease.token);
  if ((source.attempts ?? 0) >= MAX_ATTEMPTS) {
    await ctx.db.patch(source._id, {
      status: "failed",
      error: STALLED,
      lease: undefined,
      attempts: undefined,
    });
  } else {
    await ctx.db.patch(source._id, { status: "queued", lease: undefined });
    await nudge(ctx);
  }
}

/**
 * Counts what a job cost against whoever queued it. Once that puts them over
 * their limit, their queued files are cancelled; any others running carry on.
 */
async function charge(ctx: MutationCtx, queuedBy: string | undefined, costUsd: number) {
  if (queuedBy === undefined || costUsd === 0) return;
  if (isOverLimit(await addUsage(ctx, queuedBy, costUsd))) await cancelQueued(ctx, queuedBy);
}

export const chargeUser = internalMutation({
  args: { userId: v.string(), costUsd: v.number() },
  handler: (ctx, { userId, costUsd }) => charge(ctx, userId, costUsd),
});

/** Cancels a batch of a user's queued files. Each claim cancels more, if there are any left. */
async function cancelQueued(ctx: MutationCtx, queuedBy: string) {
  const queued = await ctx.db
    .query("sources")
    .withIndex("by_status_queued_by", (q) => q.eq("status", "queued").eq("queuedBy", queuedBy))
    .take(CANCEL_BATCH);
  for (const source of queued) {
    await ctx.db.patch(source._id, { status: "failed", error: OVER_LIMIT, attempts: undefined });
  }
}

/** Asks a runner with a public address to look for work now, if there is one. */
export async function nudge(ctx: MutationCtx) {
  if (process.env.RUNNER_URL) await ctx.scheduler.runAfter(0, internal.runner.ping, {});
}

/**
 * Takes the oldest queued source of a user below their limits for the runner,
 * with a link to download it. Reads a few sources per user with any queued, so
 * neither a long queue nor other users' running jobs add to what it reads.
 */
export const claim = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const sources = () => ctx.db.query("sources");
    let source: Doc<"sources"> | null = null;
    let next = await sources()
      .withIndex("by_status_queued_by", (q) => q.eq("status", "queued"))
      .first();
    while (next) {
      const { queuedBy } = next;
      const running = await sources()
        .withIndex("by_status_queued_by", (q) =>
          q.eq("status", "processing").eq("queuedBy", queuedBy),
        )
        .collect();
      let active = 0;
      for (const job of running) {
        // A claim that ran out doesn't hold up the user's next one until `checkLease` runs.
        if (job.lease && job.lease.expiresAt > now) active++;
        else await requeue(ctx, job);
      }
      if (active < MAX_JOBS_PER_USER) {
        if (queuedBy !== undefined && isOverLimit(await usageForRequest(ctx, queuedBy))) {
          await cancelQueued(ctx, queuedBy);
        } else {
          // Read after requeueing, since those are older.
          const oldest = await sources()
            .withIndex("by_status_queued_by", (q) =>
              q.eq("status", "queued").eq("queuedBy", queuedBy),
            )
            .first();
          if (oldest && (!source || oldest._creationTime < source._creationTime)) source = oldest;
        }
      }
      next = await sources()
        .withIndex("by_status_queued_by", (q) => q.eq("status", "queued").gt("queuedBy", queuedBy))
        .first();
    }
    if (!source) return null;
    const token = crypto.randomUUID();
    const expiresAt = now + LEASE_MS;
    await ctx.db.patch(source._id, {
      status: "processing",
      lease: { token, expiresAt },
      attempts: (source.attempts ?? 0) + 1,
    });
    await ctx.scheduler.runAt(expiresAt, internal.runner.checkLease, {
      sourceId: source._id,
      token,
    });
    return {
      sourceId: source._id,
      token,
      name: source.name,
      kind: source.kind,
      size: source.size,
      fileUrl: await ctx.storage.getUrl(source.storageId),
      leaseMs: LEASE_MS,
      chargeTo: source.queuedBy,
    };
  },
});

/** Requeues a source if its claim ran out, or checks again when the renewed claim would. */
export const checkLease = internalMutation({
  args: { sourceId: v.id("sources"), token: v.string() },
  handler: async (ctx, { sourceId, token }) => {
    const source = await claimed(ctx, sourceId, token);
    if (!source) return;
    if (source.lease.expiresAt > Date.now()) {
      await ctx.scheduler.runAt(source.lease.expiresAt, internal.runner.checkLease, {
        sourceId,
        token,
      });
    } else {
      await requeue(ctx, source);
    }
  },
});

/** Renews a claim. Returns when it now expires, or null if the claim was lost. */
export const heartbeat = internalMutation({
  args: { sourceId: v.id("sources"), token: v.string() },
  handler: async (ctx, { sourceId, token }) => {
    const source = await leased(ctx, sourceId, token);
    if (!source) return null;
    const expiresAt = Date.now() + LEASE_MS;
    await ctx.db.patch(sourceId, { lease: { token, expiresAt } });
    return expiresAt;
  },
});

/**
 * Saves a transcription: the Markdown and the images it links to, replacing
 * any earlier ones. Only files this claim uploaded can be used; any it
 * uploaded but didn't use are deleted.
 */
export const complete = internalMutation({
  args: {
    sourceId: v.id("sources"),
    token: v.string(),
    markdownId: v.id("_storage"),
    pageCount: v.optional(v.number()),
    assets: v.array(v.object({ name: v.string(), storageId: v.id("_storage") })),
    costUsd: v.number(),
  },
  handler: async (ctx, { sourceId, token, markdownId, pageCount, assets, costUsd }) => {
    const source = await leased(ctx, sourceId, token);
    // Deleted, timed out or already finished: its files went with the claim.
    if (!source) return false;
    await charge(ctx, source.queuedBy, costUsd);

    const uploads = await ctx.db
      .query("runnerUploads")
      .withIndex("by_claim", (q) => q.eq("sourceId", sourceId).eq("token", token))
      .collect();
    const ours = new Set(uploads.map((upload) => upload.storageId));
    const used = [markdownId, ...assets.map((asset) => asset.storageId)];
    const typeOf = async (id: Id<"_storage">) => (await ctx.db.system.get(id))?.contentType;
    let valid =
      assets.length <= MAX_ASSETS &&
      new Set(assets.map((asset) => asset.name)).size === assets.length &&
      assets.every((asset) => ASSET_NAME.test(asset.name)) &&
      new Set(used).size === used.length &&
      used.every((id) => ours.has(id)) &&
      (pageCount === undefined ||
        (Number.isSafeInteger(pageCount) && pageCount >= 0 && pageCount <= MAX_SOURCE_PAGES));
    if (valid) {
      valid = (await typeOf(markdownId)) === MARKDOWN_TYPE;
      for (const asset of assets) {
        if (!IMAGE_TYPES.includes((await typeOf(asset.storageId)) ?? "")) valid = false;
      }
    }
    if (!valid) {
      // A bug in the runner, so trying again wouldn't help.
      console.error("Invalid transcription", sourceId);
      await endClaim(ctx, sourceId, token);
      await ctx.db.patch(sourceId, {
        status: "failed",
        error: FAILED,
        lease: undefined,
        attempts: undefined,
      });
      return true;
    }

    await endClaim(ctx, sourceId, token, new Set(used));
    await deleteTranscription(ctx, source);
    for (const { name, storageId } of assets) {
      await ctx.db.insert("sourceAssets", {
        projectId: source.projectId,
        sourceId,
        name,
        storageId,
      });
    }
    await ctx.db.patch(sourceId, {
      status: "ready",
      markdownId,
      pageCount,
      error: undefined,
      lease: undefined,
      attempts: undefined,
    });
    return true;
  },
});

/**
 * Ends a claim without a result. A released source goes back in the queue,
 * e.g. when the runner shuts down; otherwise it's failed with the given reason.
 */
export const fail = internalMutation({
  args: {
    sourceId: v.id("sources"),
    token: v.string(),
    error: v.string(),
    release: v.boolean(),
    costUsd: v.number(),
  },
  handler: async (ctx, { sourceId, token, error, release, costUsd }) => {
    const source = await leased(ctx, sourceId, token);
    if (!source) return false;
    await charge(ctx, source.queuedBy, costUsd);
    await endClaim(ctx, sourceId, token);
    if (release) {
      // Not the file's fault, so the claim doesn't count.
      const attempts = Math.max(0, (source.attempts ?? 1) - 1);
      await ctx.db.patch(sourceId, { status: "queued", lease: undefined, attempts });
      await nudge(ctx);
      return true;
    }
    await ctx.db.patch(sourceId, {
      status: "failed",
      error: error.trim().slice(0, MAX_ERROR_LENGTH) || FAILED,
      lease: undefined,
      attempts: undefined,
    });
    return true;
  },
});

/**
 * Deletes a source's Markdown and images, unless the Markdown is the file
 * itself, and anything a claim on it has uploaded.
 */
export async function deleteTranscription(ctx: MutationCtx, source: Doc<"sources">) {
  const assets = await ctx.db
    .query("sourceAssets")
    .withIndex("by_source", (q) => q.eq("sourceId", source._id))
    .collect();
  for (const asset of assets) {
    await ctx.storage.delete(asset.storageId);
    await ctx.db.delete(asset._id);
  }
  if (source.markdownId && source.markdownId !== source.storageId) {
    await ctx.storage.delete(source.markdownId);
  }
}

/** Deletes everything transcription made for a source that's being deleted. */
export async function deleteSourceFiles(ctx: MutationCtx, source: Doc<"sources">) {
  await deleteTranscription(ctx, source);
  await endClaim(ctx, source._id, undefined);
}

/** Tells the runner at RUNNER_URL that there is work. A missed nudge waits for its next poll. */
export const ping = internalAction({
  args: {},
  handler: async () => {
    const url = process.env.RUNNER_URL;
    const secret = process.env.RUNNER_SECRET;
    if (!url || !secret) return;
    const target = new URL("/nudge", url);
    const timestamp = String(Date.now());
    const body = "{}";
    try {
      const response = await fetch(target, {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/json",
          "X-Runner-Timestamp": timestamp,
          "X-Runner-Signature": await sign(secret, timestamp, "POST", target.pathname, body),
        },
      });
      if (!response.ok) console.warn("The runner didn't take the nudge", response.status);
    } catch (error) {
      console.warn("Couldn't reach the runner", error);
    }
  },
});
