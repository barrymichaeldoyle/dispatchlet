import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from './_generated/server'
import { approveBufferPost, BufferPostError } from './buffer'
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
  args: { postId: v.id('posts'), bufferStatus: v.string(), from: v.string() },
  returns: v.null(),
  handler: async (ctx, { postId, bufferStatus, from }) => {
    const post = await ctx.db.get(postId)
    if (!post) return null
    await ctx.db.patch(postId, {
      status: bufferStatus === 'draft' ? 'draft' : 'queued',
      bufferStatus,
      approveToken: undefined,
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
    const status = await approveBufferPost(ctx, post.userId, post.bufferPostId)
    await ctx.runMutation(internal.approvals.markApproved, {
      postId: post._id,
      bufferStatus: status,
      from,
    })
    return 'Added to your Buffer queue.'
  } catch (error) {
    if (error instanceof BufferPostError)
      throw new Error(`Buffer did not move the post. ${error.message}`)
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
