import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import { postStatuses } from './buffer'

const TWO_DAYS = 2 * 86_400_000

/** Posts that reached Buffer in the last two days and are not yet sent or failed, by user. */
export const pending = internalQuery({
  args: {},
  handler: async (ctx) => {
    const since = Date.now() - TWO_DAYS
    const posts = await ctx.db
      .query('posts')
      .withIndex('by_createdAt', (q) => q.gt('createdAt', since))
      .collect()
    const open = posts.filter((p) => p.bufferPostId && !['sent', 'failed'].includes(p.status))
    const byUser = new Map<Id<'users'>, typeof open>()
    for (const p of open) byUser.set(p.userId, [...(byUser.get(p.userId) ?? []), p])
    const out = []
    for (const [userId, rows] of byUser) {
      const channels = await ctx.db
        .query('bufferChannels')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect()
      const orgs = new Map<string, string[]>()
      for (const c of channels)
        if (rows.some((r) => r.channelId === c.channelId))
          orgs.set(c.organizationId, [...(orgs.get(c.organizationId) ?? []), c.channelId])
      out.push({
        userId,
        since,
        orgs: [...orgs].map(([organizationId, channelIds]) => ({ organizationId, channelIds })),
      })
    }
    return out
  },
})

export const apply = internalMutation({
  args: {
    updates: v.array(
      v.object({
        bufferPostId: v.string(),
        status: v.string(),
        sentAt: v.union(v.string(), v.null()),
        externalLink: v.union(v.string(), v.null()),
        error: v.union(v.string(), v.null()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { updates }) => {
    for (const u of updates) {
      const post = await ctx.db
        .query('posts')
        .withIndex('by_bufferPostId', (q) => q.eq('bufferPostId', u.bufferPostId))
        .first()
      if (!post) continue
      const status =
        u.status === 'sent'
          ? 'sent'
          : u.status === 'error'
            ? 'failed'
            : u.status === 'draft'
              ? 'draft'
              : post.status === 'draft'
                ? 'queued'
                : post.status
      await ctx.db.patch(post._id, {
        status,
        bufferStatus: u.status,
        sentAt: u.sentAt ? Date.parse(u.sentAt) : undefined,
        externalLink: u.externalLink ?? post.externalLink,
        reason: u.error ?? post.reason,
      })
    }
    return null
  },
})

/** Hourly: one Buffer query per organization with open posts (SPEC §24.7). */
export const poll = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const groups = await ctx.runQuery(internal.status.pending, {})
    for (const group of groups) {
      for (const org of group.orgs) {
        try {
          const rows = await postStatuses(
            ctx,
            group.userId,
            org.organizationId,
            org.channelIds,
            group.since,
          )
          await ctx.runMutation(internal.status.apply, {
            updates: rows.map(({ id, ...r }) => ({ bufferPostId: id, ...r })),
          })
        } catch (error) {
          console.log(
            `Status poll skipped: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
    }
    return null
  },
})
