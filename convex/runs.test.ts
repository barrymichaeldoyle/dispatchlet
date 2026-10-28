import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'

const modules = import.meta.glob('./**/*.*s')

const EMPTY = {
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  webSearches: 0,
  webFetches: 0,
}

async function seed(t: ReturnType<typeof convexTest>, failures = 0) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { email: 'a@example.com', emailPrefs: 'never' })
    const automationId = await ctx.db.insert('automations', {
      userId,
      name: 'F1',
      status: 'active',
      setup: {
        research: 'F1',
        services: ['twitter'],
        avoid: '',
        sources: [],
        onlyTheseSources: false,
        cadence: { preset: 'daily', time: '08:00', weekday: null },
        maxStories: 3,
        postingMode: 'draft',
      },
      channelIds: ['c1'],
      cadence: { preset: 'daily', time: '08:00', weekday: null },
      timezone: 'UTC',
      postingMode: 'draft',
      maxPostsPerRun: 3,
      consecutiveFailures: failures,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    return { userId, automationId }
  })
}

async function run(
  t: ReturnType<typeof convexTest>,
  userId: Id<'users'>,
  automationId: Id<'automations'>,
  kind: string,
) {
  return await t.run((ctx) =>
    ctx.db.insert('runs', {
      userId,
      automationId,
      kind,
      status: 'researching',
      startedAt: Date.now(),
      steps: [],
      usage: EMPTY,
      costUsd: 0,
    }),
  )
}

describe('finishing a run', () => {
  it('pauses an automation after three failed runs in a row, and a success resets the count', async () => {
    const t = convexTest(schema, modules)
    const { userId, automationId } = await seed(t, 2)
    const runId = await run(t, userId, automationId, 'scheduled')
    await t.mutation(internal.runs.finish, {
      runId,
      status: 'failed',
      note: 'x',
      error: 'Research returned nothing usable.',
    })
    const paused = await t.run((ctx) => ctx.db.get(automationId))
    expect(paused?.status).toBe('failed')
    expect(paused?.consecutiveFailures).toBe(3)

    const { userId: u2, automationId: a2 } = await seed(t, 2)
    const ok = await run(t, u2, a2, 'scheduled')
    await t.mutation(internal.runs.finish, { runId: ok, status: 'done', note: 'Done.' })
    const reset = await t.run((ctx) => ctx.db.get(a2))
    expect(reset?.status).toBe('active')
    expect(reset?.consecutiveFailures).toBe(0)
  })

  it('does not count a failed dry run', async () => {
    const t = convexTest(schema, modules)
    const { userId, automationId } = await seed(t, 2)
    const runId = await run(t, userId, automationId, 'dry')
    await t.mutation(internal.runs.finish, { runId, status: 'failed', note: 'x', error: 'boom' })
    const a = await t.run((ctx) => ctx.db.get(automationId))
    expect(a?.status).toBe('active')
    expect(a?.consecutiveFailures).toBe(2)
  })

  it('pauses at once when Buffer access is gone, without waiting for three failures', async () => {
    const t = convexTest(schema, modules)
    const { userId, automationId } = await seed(t, 0)
    const runId = await run(t, userId, automationId, 'scheduled')
    await t.mutation(internal.runs.finish, {
      runId,
      status: 'failed',
      note: 'x',
      error: 'Buffer access has ended. Sign in with Buffer again.',
    })
    const a = await t.run((ctx) => ctx.db.get(automationId))
    expect(a?.status).toBe('paused')
    expect(a?.nextRunAt).toBeUndefined()
  })

  it('writes the closing line to the log and marks the run finished', async () => {
    const t = convexTest(schema, modules)
    const { userId, automationId } = await seed(t)
    const runId = await run(t, userId, automationId, 'now')
    await t.mutation(internal.runs.finish, {
      runId,
      status: 'done',
      note: 'Done. 1 post in Buffer.',
    })
    const r = await t.run((ctx) => ctx.db.get(runId))
    expect(r?.finishedAt).toBeTypeOf('number')
    expect(r?.steps.at(-1)).toMatchObject({ step: 'done', note: 'Done. 1 post in Buffer.' })
  })
})

describe('approving a draft', () => {
  it('moves the post to the queue, drops the token and logs where it was approved from', async () => {
    const t = convexTest(schema, modules)
    const { userId, automationId } = await seed(t)
    const runId = await run(t, userId, automationId, 'now')
    const postId = await t.run(async (ctx) => {
      const storyId = await ctx.db.insert('stories', {
        automationId,
        runId,
        title: 'T',
        canonicalUrl: 'https://a.com/1',
        source: 's',
        publishedAt: '2026-10-28',
        summary: '',
        whyItMatters: '',
        keyFacts: [],
        confidence: 0.9,
        decision: 'kept',
        reason: 'Kept.',
        createdAt: Date.now(),
      })
      await ctx.db.insert('bufferChannels', {
        userId,
        organizationId: 'o',
        channelId: 'c1',
        service: 'twitter',
        name: 'GrandPrixPicks',
        usable: true,
        syncedAt: Date.now(),
      })
      return await ctx.db.insert('posts', {
        userId,
        automationId,
        runId,
        storyId,
        channelId: 'c1',
        service: 'twitter',
        text: 'hi',
        status: 'draft',
        bufferPostId: 'b1',
        bufferStatus: 'draft',
        approveToken: 'tok',
        createdAt: Date.now(),
      })
    })
    await t.mutation(internal.approvals.markApproved, {
      postId,
      bufferStatus: 'scheduled',
      from: 'email',
    })
    const post = await t.run((ctx) => ctx.db.get(postId))
    expect(post?.status).toBe('queued')
    expect(post?.approveToken).toBeUndefined()
    const r = await t.run((ctx) => ctx.db.get(runId))
    expect(r?.steps.at(-1)?.note).toBe(
      'GrandPrixPicks: approved from the email and added to the queue.',
    )
  })
})
