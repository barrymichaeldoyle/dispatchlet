import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import { postMetrics, postStatuses } from './buffer'
import { emitPostEvent } from './runs'

/** The home page lists a week of drafts, so a week of open posts is checked, with a day spare. */
const OPEN_WINDOW = 8 * 86_400_000
/** Buffer's page size for the status query; a full page means there may be more. */
export const STATUS_PAGE = 50

/** Posts that reached Buffer in the last week and are not yet sent, failed or deleted, by user. */
export const pending = internalQuery({
  args: {},
  handler: async (ctx) => {
    const since = Date.now() - OPEN_WINDOW
    const posts = await ctx.db
      .query('posts')
      .withIndex('by_createdAt', (q) => q.gt('createdAt', since))
      .collect()
    const open = posts.filter(
      (p) => p.bufferPostId && !['sent', 'failed', 'deleted'].includes(p.status),
    )
    const byUser = new Map<Id<'users'>, typeof open>()
    for (const p of open) byUser.set(p.userId, [...(byUser.get(p.userId) ?? []), p])
    const out = []
    for (const [userId, rows] of byUser) {
      const channels = await ctx.db
        .query('bufferChannels')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect()
      const orgs = new Map<string, { channelIds: string[]; expected: string[] }>()
      for (const c of channels) {
        const mine = rows.filter((r) => r.channelId === c.channelId)
        if (!mine.length) continue
        const org = orgs.get(c.organizationId) ?? { channelIds: [], expected: [] }
        org.channelIds.push(c.channelId)
        org.expected.push(...mine.map((r) => r.bufferPostId!))
        orgs.set(c.organizationId, org)
      }
      out.push({
        userId,
        since,
        orgs: [...orgs].map(([organizationId, o]) => ({ organizationId, ...o })),
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
    /** Posts Buffer was asked about and did not return: deleted there, so marked deleted here. */
    missing: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, { updates, missing }) => {
    for (const id of missing ?? []) {
      const post = await ctx.db
        .query('posts')
        .withIndex('by_bufferPostId', (q) => q.eq('bufferPostId', id))
        .first()
      if (post && !['sent', 'failed', 'deleted'].includes(post.status))
        await ctx.db.patch(post._id, {
          status: 'deleted',
          bufferStatus: 'deleted',
          approveToken: undefined,
          reason: 'Deleted in Buffer.',
        })
    }
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
      if (status === 'sent' && post.status !== 'sent')
        await emitPostEvent(ctx, post._id, 'post.sent')
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
          // A full page may have left some out, so only a short page says what is gone.
          const seen = new Set(rows.map((r) => r.id))
          const missing =
            rows.length < STATUS_PAGE ? org.expected.filter((id) => !seen.has(id)) : []
          await ctx.runMutation(internal.status.apply, {
            updates: rows.map(({ id, ...r }) => ({ bufferPostId: id, ...r })),
            missing,
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

const DAY = 86_400_000
/** How many metric reads a day, in total, so they never crowd out posting. */
const METRIC_READS_PER_DAY = 40

/** Sent posts at least a day old whose metrics are missing or more than a day stale, oldest first. */
export const wantingMetrics = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const posts = await ctx.db
      .query('posts')
      .withIndex('by_createdAt', (q) => q.gt('createdAt', now - 30 * DAY))
      .collect()
    return posts
      .filter(
        (p) =>
          p.status === 'sent' &&
          p.bufferPostId &&
          (p.sentAt ?? p.createdAt) < now - DAY &&
          (!p.metricsUpdatedAt || p.metricsUpdatedAt < now - DAY) &&
          (p.sentAt ?? p.createdAt) > now - 14 * DAY,
      )
      .sort((a, b) => (a.metricsUpdatedAt ?? 0) - (b.metricsUpdatedAt ?? 0))
      .slice(0, METRIC_READS_PER_DAY)
      .map((p) => ({ postId: p._id, userId: p.userId, bufferPostId: p.bufferPostId! }))
  },
})

export const storeMetrics = internalMutation({
  args: {
    postId: v.id('posts'),
    metrics: v.array(v.object({ type: v.string(), value: v.number(), unit: v.string() })),
  },
  returns: v.null(),
  handler: async (ctx, { postId, metrics }) => {
    await ctx.db.patch(postId, { metrics, metricsUpdatedAt: Date.now() })
    return null
  },
})

/** Daily: one Buffer read per sent post that is due a metrics update (SPEC §24.8). */
export const pollMetrics = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const wanted = await ctx.runQuery(internal.status.wantingMetrics, {})
    for (const w of wanted) {
      try {
        const result = await postMetrics(ctx, w.userId, w.bufferPostId)
        if (result)
          await ctx.runMutation(internal.status.storeMetrics, {
            postId: w.postId,
            metrics: result.metrics,
          })
      } catch (error) {
        console.log(`Metrics skipped: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return null
  },
})
