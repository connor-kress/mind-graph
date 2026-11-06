import { ConvexError } from "convex/values";
import { requireUser } from "./auth";
import { query, type MutationCtx, type QueryCtx } from "./_generated/server";

// What each user's transcriptions cost, against a limit for each period. A row
// can be edited by hand, e.g. to lift the limit of an admin or testing account.

export const DEFAULT_LIMIT_USD = 0.5;
export const DEFAULT_RESET_MS = 7 * 24 * 60 * 60_000;
export const OVER_LIMIT = "You've reached your transcription limit. Try again after it resets.";

function findUsage(ctx: QueryCtx, userId: string) {
  return ctx.db
    .query("transcriptionUsage")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

/**
 * A user's usage as of a request for transcription. The first request after a
 * period is over starts the next, so a user who comes back always gets a whole one.
 */
export async function usageForRequest(ctx: MutationCtx, userId: string) {
  const now = Date.now();
  const usage = await findUsage(ctx, userId);
  if (!usage) {
    const id = await ctx.db.insert("transcriptionUsage", {
      userId,
      limitUsd: DEFAULT_LIMIT_USD,
      usageUsd: 0,
      resetMs: DEFAULT_RESET_MS,
      lastResetAt: now,
    });
    return (await ctx.db.get(id))!;
  }
  if (now < usage.lastResetAt + usage.resetMs) return usage;
  await ctx.db.patch(usage._id, { usageUsd: 0, lastResetAt: now });
  return { ...usage, usageUsd: 0, lastResetAt: now };
}

export function isOverLimit(usage: { usageUsd: number; limitUsd: number }) {
  return usage.usageUsd >= usage.limitUsd;
}

/** Throws if the user can't ask for anything more to be transcribed yet. */
export async function requireBelowLimit(ctx: MutationCtx, userId: string) {
  if (isOverLimit(await usageForRequest(ctx, userId))) throw new ConvexError(OVER_LIMIT);
}

/**
 * Adds what a job cost to the user's current row, returning their usage. A job
 * ending isn't a request, so it never starts a new period itself.
 */
export async function addUsage(ctx: MutationCtx, userId: string, costUsd: number) {
  const usage = (await findUsage(ctx, userId)) ?? (await usageForRequest(ctx, userId));
  const usageUsd = usage.usageUsd + costUsd;
  await ctx.db.patch(usage._id, { usageUsd });
  return { ...usage, usageUsd };
}

/** The current user's limit and usage, for showing them. No row means they haven't started. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const usage = await findUsage(ctx, await requireUser(ctx));
    return {
      limitUsd: usage?.limitUsd ?? DEFAULT_LIMIT_USD,
      usageUsd: usage?.usageUsd ?? 0,
      resetMs: usage?.resetMs ?? DEFAULT_RESET_MS,
      lastResetAt: usage?.lastResetAt ?? null,
    };
  },
});
