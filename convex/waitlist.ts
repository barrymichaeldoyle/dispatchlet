import { v } from 'convex/values'
import { internalMutation, internalQuery, query } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

const WEEK = 7 * 24 * 60 * 60 * 1000

async function positionOf(ctx: QueryCtx, row: Doc<'waitlist'>): Promise<number> {
  const rows = await ctx.db.query('waitlist').collect()
  return rows.filter((r) => r._creationTime <= row._creationTime).length
}

function makeToken(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replaceAll('-', '')
}

/** Number of people on the list. Public, shown on the page once it reaches 25. */
export const count = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const rows = await ctx.db.query('waitlist').collect()
    return rows.length
  },
})

/** Adds an address, or returns the existing row's position without changing it. */
export const add = internalMutation({
  args: {
    email: v.string(),
    source: v.string(),
    campaign: v.optional(v.string()),
    ip: v.optional(v.string()),
  },
  returns: v.object({ position: v.number(), isNew: v.boolean(), token: v.string() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('waitlist')
      .withIndex('by_email', (q) => q.eq('email', args.email))
      .first()
    if (existing) {
      return { position: await positionOf(ctx, existing), isNew: false, token: existing.token }
    }
    const token = makeToken()
    const id = await ctx.db.insert('waitlist', {
      email: args.email,
      createdAt: Date.now(),
      source: args.source,
      campaign: args.campaign,
      token,
      ip: args.ip,
    })
    const row = (await ctx.db.get(id)) as Doc<'waitlist'>
    return { position: await positionOf(ctx, row), isNew: true, token }
  },
})

/**
 * Someone signed in with Buffer before launch. Buffer has already verified the address, so the
 * row is confirmed straight away and no confirmation email is sent. An existing row is left as
 * it is, including one that unsubscribed.
 */
export async function addSignInToWaitlist(ctx: MutationCtx, email: string): Promise<void> {
  const existing = await ctx.db
    .query('waitlist')
    .withIndex('by_email', (q) => q.eq('email', email))
    .first()
  if (existing) return
  const now = Date.now()
  await ctx.db.insert('waitlist', {
    email,
    createdAt: now,
    source: 'buffer-sign-in',
    confirmedAt: now,
    token: makeToken(),
  })
}

export const recentCountByIp = internalQuery({
  args: { ip: v.string(), since: v.number() },
  returns: v.number(),
  handler: async (ctx, { ip, since }) => {
    const rows = await ctx.db
      .query('waitlist')
      .withIndex('by_ip_createdAt', (q) => q.eq('ip', ip).gte('createdAt', since))
      .collect()
    return rows.length
  },
})

export const confirm = internalMutation({
  args: { token: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { token }) => {
    const row = await ctx.db
      .query('waitlist')
      .withIndex('by_token', (q) => q.eq('token', token))
      .first()
    if (!row) return false
    if (!row.confirmedAt) await ctx.db.patch(row._id, { confirmedAt: Date.now() })
    return true
  },
})

export const unsubscribe = internalMutation({
  args: { token: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { token }) => {
    const row = await ctx.db
      .query('waitlist')
      .withIndex('by_token', (q) => q.eq('token', token))
      .first()
    if (!row) return false
    if (!row.unsubscribedAt) await ctx.db.patch(row._id, { unsubscribedAt: Date.now() })
    return true
  },
})

/** Daily cron: hashed IPs are only for rate limiting, so they go after 7 days. */
export const purgeIps = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const cutoff = Date.now() - WEEK
    const rows = await ctx.db.query('waitlist').collect()
    let cleared = 0
    for (const row of rows) {
      if (row.ip !== undefined && row.createdAt < cutoff) {
        await ctx.db.patch(row._id, { ip: undefined })
        cleared++
      }
    }
    return cleared
  },
})

/** Confirmed, not unsubscribed, not yet sent the launch email. */
export const nextLaunchBatch = internalQuery({
  args: { limit: v.number() },
  returns: v.array(v.object({ _id: v.id('waitlist'), email: v.string(), token: v.string() })),
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db.query('waitlist').collect()
    return rows
      .filter((r) => r.confirmedAt && !r.unsubscribedAt && !r.launchEmailSentAt)
      .slice(0, limit)
      .map((r) => ({ _id: r._id, email: r.email, token: r.token }))
  },
})

export const markLaunchSent = internalMutation({
  args: { ids: v.array(v.id('waitlist')) },
  returns: v.null(),
  handler: async (ctx, { ids }) => {
    const now = Date.now()
    for (const id of ids as Array<Id<'waitlist'>>) {
      await ctx.db.patch(id, { launchEmailSentAt: now })
    }
    return null
  },
})
