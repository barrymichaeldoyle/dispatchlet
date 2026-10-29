import { v } from 'convex/values'
import { internalMutation, type MutationCtx } from '../_generated/server'

const num = (name: string, fallback: number) => {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

export type RateResult = {
  ok: boolean
  limit: number
  remaining: number
  /** Unix seconds when the tightest window resets. */
  reset: number
}

export async function take(
  ctx: MutationCtx,
  key: string,
  windowMs: number,
  limit: number,
): Promise<{ ok: boolean; remaining: number; resetAt: number }> {
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs
  const row = await ctx.db
    .query('apiRateWindows')
    .withIndex('by_key', (q) => q.eq('key', key))
    .first()
  const resetAt = windowStart + windowMs
  if (!row || row.windowStart !== windowStart) {
    if (row) await ctx.db.patch(row._id, { windowStart, count: 1 })
    else await ctx.db.insert('apiRateWindows', { key, windowStart, count: 1 })
    return { ok: true, remaining: limit - 1, resetAt }
  }
  if (row.count >= limit) return { ok: false, remaining: 0, resetAt }
  await ctx.db.patch(row._id, { count: row.count + 1 })
  return { ok: true, remaining: limit - row.count - 1, resetAt }
}

/** An inbound hook's own limit (SPEC §44.5): 10 a minute, not charged to the owner's API hour. */
export const checkHook = internalMutation({
  args: { hookId: v.string() },
  returns: v.object({ ok: v.boolean(), reset: v.number() }),
  handler: async (ctx, { hookId }) => {
    const r = await take(ctx, `hook:${hookId}`, 60_000, num('HOOK_RATE_PER_MINUTE', 10))
    return { ok: r.ok, reset: Math.ceil(r.resetAt / 1000) }
  },
})

/** One channel sync a minute per person, so the shared Buffer budget is not spent by a loop. */
export const claimSync = internalMutation({
  args: { userId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { userId }) => (await take(ctx, `sync:${userId}`, 60_000, 1)).ok,
})

/**
 * Counts one request against the token's minute and the user's hour (SPEC §44.3). The response
 * headers come from the minute window, which is the one a caller can act on.
 */
export const check = internalMutation({
  args: { tokenKey: v.string(), userKey: v.string() },
  returns: v.object({
    ok: v.boolean(),
    limit: v.number(),
    remaining: v.number(),
    reset: v.number(),
  }),
  handler: async (ctx, { tokenKey, userKey }): Promise<RateResult> => {
    const perMinute = num('API_RATE_PER_MINUTE', 60)
    const perHour = num('API_RATE_PER_HOUR', 1000)
    const hour = await take(ctx, `h:${userKey}`, 3_600_000, perHour)
    if (!hour.ok)
      return { ok: false, limit: perHour, remaining: 0, reset: Math.ceil(hour.resetAt / 1000) }
    const minute = await take(ctx, `m:${tokenKey}`, 60_000, perMinute)
    return {
      ok: minute.ok,
      limit: perMinute,
      remaining: minute.remaining,
      reset: Math.ceil(minute.resetAt / 1000),
    }
  },
})
