import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'

/** The public half of the VAPID pair, which the browser needs to subscribe. */
export const config = query({
  args: {},
  returns: v.object({ publicKey: v.union(v.string(), v.null()) }),
  handler: async () => ({ publicKey: process.env.VAPID_PUBLIC_KEY ?? null }),
})

export const subscribe = mutation({
  args: {
    endpoint: v.string(),
    keys: v.object({ p256dh: v.string(), auth: v.string() }),
    userAgent: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not signed in')
    const existing = await ctx.db
      .query('pushSubscriptions')
      .withIndex('by_endpoint', (q) => q.eq('endpoint', args.endpoint))
      .first()
    if (existing)
      await ctx.db.patch(existing._id, { userId, keys: args.keys, userAgent: args.userAgent })
    else await ctx.db.insert('pushSubscriptions', { userId, ...args, createdAt: Date.now() })
    return null
  },
})

export const unsubscribe = mutation({
  args: { endpoint: v.string() },
  returns: v.null(),
  handler: async (ctx, { endpoint }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not signed in')
    const existing = await ctx.db
      .query('pushSubscriptions')
      .withIndex('by_endpoint', (q) => q.eq('endpoint', endpoint))
      .first()
    if (existing && existing.userId === userId) await ctx.db.delete(existing._id)
    return null
  },
})

/** How many devices this person gets push on, for settings. */
export const mine = query({
  args: {},
  returns: v.array(v.object({ endpoint: v.string(), userAgent: v.union(v.string(), v.null()) })),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return []
    const rows = await ctx.db
      .query('pushSubscriptions')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    return rows.map((r) => ({ endpoint: r.endpoint, userAgent: r.userAgent ?? null }))
  },
})

export const forUser = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) =>
    await ctx.db
      .query('pushSubscriptions')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect(),
})

/** Removes a subscription the push service said is gone (410 or 404). */
export const drop = internalMutation({
  args: { endpoint: v.string() },
  returns: v.null(),
  handler: async (ctx, { endpoint }) => {
    const row = await ctx.db
      .query('pushSubscriptions')
      .withIndex('by_endpoint', (q) => q.eq('endpoint', endpoint))
      .first()
    if (row) await ctx.db.delete(row._id)
    return null
  },
})

/**
 * Schedules a push to every device of a user. Callers decide whether the moment deserves one;
 * the send itself runs in Node (pushSend.ts) because web-push needs it.
 */
export const notify = internalMutation({
  args: {
    userId: v.id('users'),
    title: v.string(),
    body: v.string(),
    url: v.string(),
    tag: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, internal.pushSend.send, args)
    return null
  },
})
