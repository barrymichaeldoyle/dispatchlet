import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from './_generated/server'
import { approveBufferPost, BufferPostError, editBufferPostText } from './buffer'
import { measuredLength, SERVICE_LIMITS } from './lib/ai/write'
import type { Service } from './lib/ai/setup'
import { emitPostEvent } from './runs'

/** What the digest email needs: the person, the run's closing line, and each post. */
export const digestFor = internalQuery({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId)
    if (!run?.userId || !run.automationId) return null
    const userId = run.userId
    const user = await ctx.db.get(userId)
    const automation = await ctx.db.get(run.automationId)
    const posts = await ctx.db
      .query('posts')
      .withIndex('by_run', (q) => q.eq('runId', runId))
      .collect()
    const channels = await ctx.db
      .query('bufferChannels')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    const names = new Map(channels.map((c) => [c.channelId, c.name]))
    return {
      email: user?.email ?? null,
      run: {
        automationName: automation?.name ?? 'your automation',
        automationId: run.automationId,
        note: run.steps.at(-1)?.note ?? 'The run finished.',
      },
      posts: posts
        .filter((p) => p.bufferPostId)
        .map((p) => ({
          channelName: names.get(p.channelId) ?? p.service,
          text: p.text,
          status:
            p.status === 'draft'
              ? 'saved as a draft'
              : p.status === 'scheduled'
                ? 'scheduled'
                : 'in the queue',
          approveToken: p.approveToken ?? null,
          externalLink: p.externalLink ?? null,
        })),
    }
  },
})

export const automationName = internalQuery({
  args: { automationId: v.id('automations') },
  returns: v.string(),
  handler: async (ctx, { automationId }) =>
    (await ctx.db.get(automationId))?.name ?? 'Your automation',
})

export const postByToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) =>
    await ctx.db
      .query('posts')
      .withIndex('by_approveToken', (q) => q.eq('approveToken', token))
      .first(),
})

export const postById = internalQuery({
  args: { postId: v.id('posts') },
  handler: async (ctx, { postId }) => await ctx.db.get(postId),
})

export const markApproved = internalMutation({
  args: {
    postId: v.id('posts'),
    bufferStatus: v.string(),
    dueAt: v.optional(v.number()),
    from: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { postId, bufferStatus, dueAt, from }) => {
    const post = await ctx.db.get(postId)
    if (!post) return null
    await ctx.db.patch(postId, {
      status: bufferStatus === 'draft' ? 'draft' : 'queued',
      bufferStatus,
      approveToken: undefined,
      ...(dueAt ? { dueAt } : {}),
    })
    const run = await ctx.db.get(post.runId)
    const channel = await ctx.db
      .query('bufferChannels')
      .withIndex('by_user_channel', (q) =>
        q.eq('userId', post.userId).eq('channelId', post.channelId),
      )
      .first()
    if (run)
      await ctx.db.patch(run._id, {
        steps: [
          ...run.steps,
          {
            step: 'approve',
            at: Date.now(),
            note: `${channel?.name ?? post.service}: approved from ${APPROVED_FROM[from] ?? from} and added to the queue.`,
          },
        ],
      })
    await emitPostEvent(ctx, postId, 'post.approved', { from })
    return null
  },
})

const APPROVED_FROM: Record<string, string> = {
  email: 'the email',
  app: 'the run page',
  api: 'the API',
  mcp: 'an assistant',
}

export type ApprovedFrom = 'email' | 'app' | 'api' | 'mcp'

async function approve(
  ctx: ActionCtx,
  post: { _id: Id<'posts'>; userId: Id<'users'>; bufferPostId?: string; status: string },
  from: ApprovedFrom,
): Promise<string> {
  if (!post.bufferPostId) throw new Error('This post never reached Buffer.')
  if (post.status === 'deleted')
    return 'This post was deleted in Buffer, so there is nothing to approve.'
  if (post.status !== 'draft') return 'This post is already in the queue.'
  try {
    const { status, dueAt } = await approveBufferPost(ctx, post.userId, post.bufferPostId)
    await ctx.runMutation(internal.approvals.markApproved, {
      postId: post._id,
      bufferStatus: status,
      dueAt,
      from,
    })
    return 'Added to your Buffer queue.'
  } catch (error) {
    if (error instanceof BufferPostError)
      throw new Error(`Buffer did not move the post. ${error.message}`, { cause: error })
    throw error
  }
}

/** From the email link. The token is single use and only ever points at a draft. */
export const approveByToken = internalAction({
  args: { token: v.string() },
  returns: v.object({ ok: v.boolean(), status: v.number(), message: v.string() }),
  handler: async (ctx, { token }): Promise<{ ok: boolean; status: number; message: string }> => {
    const post: Doc<'posts'> | null = await ctx.runQuery(internal.approvals.postByToken, { token })
    if (!post)
      return {
        ok: false,
        status: 404,
        message: 'This link is not valid, or the post was already approved.',
      }
    try {
      return { ok: true, status: 200, message: await approve(ctx, post, 'email') }
    } catch (error) {
      return {
        ok: false,
        status: 502,
        message: error instanceof Error ? error.message : 'Something went wrong.',
      }
    }
  },
})

/** From the run page, for the signed-in owner of the post. */
export const approveForUser = internalAction({
  args: {
    userId: v.id('users'),
    postId: v.id('posts'),
    from: v.optional(v.union(v.literal('app'), v.literal('api'), v.literal('mcp'))),
  },
  returns: v.string(),
  handler: async (ctx, { userId, postId, from }): Promise<string> => {
    const post: Doc<'posts'> | null = await ctx.runQuery(internal.approvals.postById, { postId })
    if (!post || post.userId !== userId) throw new Error('Post not found')
    return await approve(ctx, post, from ?? 'app')
  },
})

/** What editing a draft needs: the post and the limit of its channel. */
export const draftForEdit = internalQuery({
  args: { userId: v.id('users'), postId: v.id('posts') },
  handler: async (ctx, { userId, postId }) => {
    const post = await ctx.db.get(postId)
    if (!post || post.userId !== userId) return null
    const channel = await ctx.db
      .query('bufferChannels')
      .withIndex('by_user_channel', (q) => q.eq('userId', userId).eq('channelId', post.channelId))
      .first()
    const limits = SERVICE_LIMITS[post.service as Service]
    return {
      post,
      channelName: channel?.displayName ?? channel?.name ?? post.service,
      limit: channel?.maxLength ?? limits?.maxLength ?? 280,
    }
  },
})

export const saveEditedText = internalMutation({
  args: { postId: v.id('posts'), text: v.string(), channelName: v.string(), from: v.string() },
  returns: v.null(),
  handler: async (ctx, { postId, text, channelName, from }) => {
    const post = await ctx.db.get(postId)
    if (!post) return null
    await ctx.db.patch(postId, { text })
    const run = await ctx.db.get(post.runId)
    if (run)
      await ctx.db.patch(run._id, {
        steps: [
          ...run.steps,
          {
            step: 'edit',
            at: Date.now(),
            note: `${channelName}: draft edited ${from === 'app' ? 'in Dispatchlet' : `from ${APPROVED_FROM[from] ?? from}`}.`,
          },
        ],
      })
    return null
  },
})

/**
 * Changes a draft's text before it is approved, in Buffer and here. The text must fit the channel
 * as the service counts it (a link is 23 characters on X).
 */
export const editForUser = internalAction({
  args: {
    userId: v.id('users'),
    postId: v.id('posts'),
    text: v.string(),
    from: v.union(v.literal('app'), v.literal('api'), v.literal('mcp')),
  },
  returns: v.string(),
  handler: async (ctx, { userId, postId, text, from }): Promise<string> => {
    const found = await ctx.runQuery(internal.approvals.draftForEdit, { userId, postId })
    if (!found) throw new Error('Post not found')
    const { post, channelName, limit } = found
    if (post.status !== 'draft' || !post.bufferPostId)
      throw new Error('Only a draft waiting in Buffer can be edited here.')
    const clean = text.replace(/\r\n/g, '\n').trim()
    if (!clean) throw new Error('A post needs some text.')
    const length = measuredLength(clean, post.service as Service)
    if (length > limit)
      throw new Error(`Too long for ${channelName}: ${length} characters, the limit is ${limit}.`)
    if (clean === post.text) return 'Nothing changed.'
    try {
      await editBufferPostText(ctx, userId, post.bufferPostId, clean)
    } catch (error) {
      if (error instanceof BufferPostError)
        throw new Error(`Buffer did not save the change. ${error.message}`, { cause: error })
      throw error
    }
    await ctx.runMutation(internal.approvals.saveEditedText, {
      postId,
      text: clean,
      channelName,
      from,
    })
    return 'Saved in Buffer as a draft.'
  },
})
