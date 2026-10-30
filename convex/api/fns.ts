/**
 * The API's view of the app: every function takes the token's `userId` and calls the same
 * user-scoped functions the signed-in app uses (SPEC §44.3). Nothing here has logic of its own.
 */
import { v } from 'convex/values'
import type { Doc } from '../_generated/dataModel'
import { internalMutation, internalQuery } from '../_generated/server'
import {
  addExcludeRuleFor,
  automationOf,
  createFor,
  getFor,
  listFor,
  removeFor,
  savePlaybookFor,
  setStatusFor,
  updateConfigFor,
} from '../automations'
import { allowanceFor } from '../lib/limits'
import { getRunFor, listRunsFor, shareFor, triggerFor } from '../runs'
import { cadenceValidator, hintValidator, setupValidator } from '../schema'
import { postView } from '../views'

export const me = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId)
    if (!user) return null
    const connection = await ctx.db
      .query('bufferConnections')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()
    return {
      id: userId,
      email: user.email ?? null,
      name: user.name ?? null,
      timezone: user.timezone ?? 'UTC',
      allowance: allowanceFor(user),
      buffer: {
        connected: Boolean(connection),
        needsReauth: connection?.needsReauth ?? false,
      },
    }
  },
})

function channelView(c: Doc<'bufferChannels'>) {
  return {
    id: c.channelId,
    service: c.service,
    name: c.displayName ?? c.name,
    usable: c.usable,
    /** False for networks Dispatchlet cannot post to yet, such as Instagram. */
    supported: c.problem !== 'unsupported',
    maxLength: c.maxLength ?? null,
    syncedAt: c.syncedAt,
  }
}

export const channels = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) =>
    (
      await ctx.db
        .query('bufferChannels')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect()
    ).map(channelView),
})

export const automations = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => await listFor(ctx, userId),
})

export const automation = internalQuery({
  args: { userId: v.id('users'), id: v.id('automations') },
  handler: async (ctx, { userId, id }) => await getFor(ctx, userId, id),
})

export const createAutomation = internalMutation({
  args: { userId: v.id('users'), setup: setupValidator, channelIds: v.array(v.string()) },
  returns: v.id('automations'),
  handler: async (ctx, { userId, ...args }) => await createFor(ctx, userId, args),
})

export const updateAutomation = internalMutation({
  args: {
    userId: v.id('users'),
    id: v.id('automations'),
    cadence: v.optional(cadenceValidator),
    channelIds: v.optional(v.array(v.string())),
    postingMode: v.optional(v.union(v.literal('draft'), v.literal('queue'), v.literal('spread'))),
    maxPostsPerRun: v.optional(v.number()),
    status: v.optional(v.union(v.literal('active'), v.literal('paused'))),
  },
  returns: v.null(),
  handler: async (ctx, { userId, id, status, ...changes }) => {
    if (Object.values(changes).some((x) => x !== undefined))
      await updateConfigFor(ctx, userId, id, changes)
    if (status) await setStatusFor(ctx, userId, id, status)
    return null
  },
})

export const deleteAutomation = internalMutation({
  args: { userId: v.id('users'), id: v.id('automations') },
  returns: v.null(),
  handler: async (ctx, { userId, id }) => await removeFor(ctx, userId, id),
})

export const playbook = internalQuery({
  args: { userId: v.id('users'), id: v.id('automations') },
  handler: async (ctx, { userId, id }) => {
    await automationOf(ctx, userId, id)
    const latest = await ctx.db
      .query('playbookVersions')
      .withIndex('by_automation_version', (q) => q.eq('automationId', id))
      .order('desc')
      .first()
    if (!latest) return null
    return {
      version: latest.version,
      createdBy: latest.createdBy,
      createdAt: latest.createdAt,
      playbook: latest.playbook,
      text: latest.text,
    }
  },
})

export const savePlaybook = internalMutation({
  args: { userId: v.id('users'), id: v.id('automations'), text: v.string() },
  handler: async (ctx, { userId, id, text }) => await savePlaybookFor(ctx, userId, id, text),
})

export const addRule = internalMutation({
  args: { userId: v.id('users'), id: v.id('automations'), rule: v.string() },
  returns: v.number(),
  handler: async (ctx, { userId, id, rule }) => await addExcludeRuleFor(ctx, userId, id, rule),
})

export const startRun = internalMutation({
  args: {
    userId: v.id('users'),
    automationId: v.id('automations'),
    dry: v.boolean(),
    hint: v.optional(hintValidator),
    startedBy: v.union(v.literal('api'), v.literal('hook'), v.literal('mcp')),
  },
  returns: v.id('runs'),
  handler: async (ctx, { userId, ...args }) => await triggerFor(ctx, userId, args),
})

export const runs = internalQuery({
  args: {
    userId: v.id('users'),
    automationId: v.id('automations'),
    limit: v.optional(v.number()),
    before: v.optional(v.number()),
  },
  handler: async (ctx, { userId, automationId, limit, before }) =>
    await listRunsFor(ctx, userId, automationId, limit, before),
})

export const run = internalQuery({
  args: { userId: v.id('users'), runId: v.id('runs') },
  handler: async (ctx, { userId, runId }) => await getRunFor(ctx, userId, runId),
})

export const shareRun = internalMutation({
  args: { userId: v.id('users'), runId: v.id('runs') },
  returns: v.string(),
  handler: async (ctx, { userId, runId }) => await shareFor(ctx, userId, runId),
})

export const posts = internalQuery({
  args: {
    userId: v.id('users'),
    status: v.optional(v.string()),
    automationId: v.optional(v.id('automations')),
    since: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { userId, status, automationId, since, limit }) => {
    const max = Math.min(Math.max(limit ?? 50, 1), 100)
    const rows = await ctx.db
      .query('posts')
      .withIndex('by_user_createdAt', (q) =>
        since === undefined
          ? q.eq('userId', userId)
          : q.eq('userId', userId).gt('createdAt', since),
      )
      .order('desc')
      .filter((q) => {
        const parts = []
        if (status) parts.push(q.eq(q.field('status'), status))
        if (automationId) parts.push(q.eq(q.field('automationId'), automationId))
        return parts.length ? q.and(...parts) : true
      })
      .take(max)
    const rowsChannels = await ctx.db
      .query('bufferChannels')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    const names = new Map(rowsChannels.map((c) => [c.channelId, c.displayName ?? c.name]))
    return rows.map((p) => postView(p, names.get(p.channelId) ?? p.service))
  },
})

export const post = internalQuery({
  args: { userId: v.id('users'), postId: v.id('posts') },
  handler: async (ctx, { userId, postId }) => {
    const p = await ctx.db.get(postId)
    if (!p || p.userId !== userId) return null
    const channel = await ctx.db
      .query('bufferChannels')
      .withIndex('by_user_channel', (q) => q.eq('userId', userId).eq('channelId', p.channelId))
      .first()
    return postView(p, channel?.displayName ?? channel?.name ?? p.service)
  },
})
