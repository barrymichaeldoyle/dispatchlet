import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from './_generated/server'
import { automationOf, viewerId } from './automations'

export const FEEDBACK_LIMITS = {
  messageCharacters: 2_000,
  perDay: 10,
  cooldownMs: 5_000,
} as const

const category = v.union(v.literal('bug'), v.literal('idea'), v.literal('general'))
const status = v.union(
  v.literal('new'),
  v.literal('reviewing'),
  v.literal('planned'),
  v.literal('done'),
  v.literal('declined'),
)

const receipt = v.object({
  id: v.id('feedback'),
  createdAt: v.number(),
  duplicate: v.boolean(),
})

const receiptOf = (row: Doc<'feedback'>, duplicate: boolean) => ({
  id: row._id,
  createdAt: row.createdAt,
  duplicate,
})

/**
 * Stores feedback the person chose to send. The request ID makes an uncertain retry return the
 * original receipt; context is checked for ownership and stored as references only.
 */
export const submit = mutation({
  args: {
    requestId: v.string(),
    category,
    message: v.string(),
    source: v.optional(v.union(v.literal('app'), v.literal('assistant'))),
    automationId: v.optional(v.id('automations')),
    runId: v.optional(v.id('runs')),
    chatTurnId: v.optional(v.id('automationChatTurns')),
  },
  returns: receipt,
  handler: async (ctx, args) => {
    const userId = await viewerId(ctx)
    const message = args.message.trim()
    if (!message || message.length > FEEDBACK_LIMITS.messageCharacters)
      throw new Error('Write a message of 1–2,000 characters.')
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(args.requestId))
      throw new Error('Use a request ID of 1–80 letters, numbers, underscores or hyphens.')
    const existing = await ctx.db
      .query('feedback')
      .withIndex('by_user_request', (q) => q.eq('userId', userId).eq('requestId', args.requestId))
      .unique()
    if (existing) {
      if (existing.message !== message)
        throw new Error('This request ID was already used for a different message.')
      return receiptOf(existing, true)
    }

    let automationName: string | undefined
    if (args.automationId) {
      automationName = (await automationOf(ctx, userId, args.automationId)).name
    }
    if (args.runId) {
      const run = await ctx.db.get(args.runId)
      if (
        !run ||
        run.userId !== userId ||
        (args.automationId && run.automationId !== args.automationId)
      )
        throw new Error('That run is not yours to attach.')
    }
    if (args.chatTurnId) {
      const turn = await ctx.db.get(args.chatTurnId)
      const conversation = turn ? await ctx.db.get(turn.conversationId) : null
      if (
        !turn ||
        turn.userId !== userId ||
        !conversation ||
        conversation.automationId !== args.automationId
      )
        throw new Error('That assistant reply is not yours to attach.')
    }

    const now = Date.now()
    const recent = await ctx.db
      .query('feedback')
      .withIndex('by_user', (q) => q.eq('userId', userId).gte('createdAt', now - 86_400_000))
      .order('desc')
      .take(FEEDBACK_LIMITS.perDay + 1)
    // The same words sent again (a second click, a reopened form) are one submission.
    const same = recent.find((row) => row.message === message && row.category === args.category)
    if (same) return receiptOf(same, true)
    if (recent[0] && now - recent[0].createdAt < FEEDBACK_LIMITS.cooldownMs)
      throw new Error('Please wait a few seconds before sending more feedback.')
    if (recent.length >= FEEDBACK_LIMITS.perDay)
      throw new Error(
        'You have sent a lot of feedback today, thank you. Please try again tomorrow.',
      )

    const id = await ctx.db.insert('feedback', {
      userId,
      requestId: args.requestId,
      category: args.category,
      message,
      source: args.source ?? 'app',
      automationId: args.automationId,
      automationName,
      runId: args.runId,
      chatTurnId: args.chatTurnId,
      status: 'new',
      createdAt: now,
      updatedAt: now,
    })
    return receiptOf((await ctx.db.get(id))!, false)
  },
})

/** The signed-in person's own recent submissions, for receipts. Never anyone else's. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await viewerId(ctx)
    const rows = await ctx.db
      .query('feedback')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .order('desc')
      .take(20)
    return rows.map((row) => ({
      id: row._id,
      category: row.category,
      message: row.message,
      automationName: row.automationName ?? null,
      status: row.status,
      createdAt: row.createdAt,
    }))
  },
})

/**
 * Owner triage. Internal functions are reachable only with deployment credentials, e.g.
 * `npx convex run feedback:triage '{"status":"new"}'` or the Convex dashboard.
 */
export const triage = internalQuery({
  args: { status: v.optional(status), limit: v.optional(v.number()) },
  handler: async (ctx, { status: wanted, limit }) => {
    const take = Math.min(Math.max(1, Math.floor(limit ?? 50)), 200)
    const rows = wanted
      ? await ctx.db
          .query('feedback')
          .withIndex('by_status', (q) => q.eq('status', wanted))
          .order('desc')
          .take(take)
      : await ctx.db.query('feedback').order('desc').take(take)
    return await Promise.all(
      rows.map(async (row) => ({
        ...row,
        email: (await ctx.db.get(row.userId))?.email ?? null,
      })),
    )
  },
})

export const setStatus = internalMutation({
  args: { id: v.id('feedback'), status, note: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { id, status: next, note }) => {
    const row = await ctx.db.get(id)
    if (!row) throw new Error('Feedback not found')
    await ctx.db.patch(id, {
      status: next,
      ...(note !== undefined ? { note: note.slice(0, 2_000) } : {}),
      updatedAt: Date.now(),
    })
    return null
  },
})

/** Account deletion removes feedback with everything else the person sent. */
export async function deleteFeedbackFor(ctx: MutationCtx, userId: Id<'users'>) {
  const rows = await ctx.db
    .query('feedback')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect()
  for (const row of rows) await ctx.db.delete(row._id)
}
