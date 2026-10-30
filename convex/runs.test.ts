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

describe('telling the person after a run', () => {
  async function finishWith(prefs: string, emailEnabled: boolean, posted: number, mode = 'draft') {
    const t = convexTest(schema, modules)
    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', {
        email: 'a@example.com',
        emailPrefs: prefs,
        emailEnabled,
      })
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
        postingMode: mode,
        maxPostsPerRun: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      const runId = await ctx.db.insert('runs', {
        userId,
        automationId,
        kind: 'scheduled',
        status: 'publishing',
        startedAt: Date.now(),
        steps: [],
        usage: EMPTY,
        costUsd: 0,
        posted,
      })
      return { userId, automationId, runId }
    })
    await t.mutation(internal.runs.finish, {
      runId: ids.runId,
      status: 'done',
      note: `Done. ${posted} posts in Buffer.`,
    })
    const scheduled = await t.run(
      async (ctx) => await ctx.db.system.query('_scheduled_functions').collect(),
    )
    return scheduled.map((s) => s.name)
  }

  it('sends the digest by email and by push after a run with drafts', async () => {
    const names = await finishWith('every', true, 2)
    expect(names).toContain('email:sendDigest')
    expect(names).toContain('push:notify')
  })

  it('skips email when the person turned it off, and still pushes', async () => {
    const names = await finishWith('every', false, 2)
    expect(names).not.toContain('email:sendDigest')
    expect(names).toContain('push:notify')
  })

  it('says nothing for a queue run when the person only wants to hear about drafts', async () => {
    const names = await finishWith('drafts', true, 2, 'queue')
    expect(names).not.toContain('email:sendDigest')
    expect(names).not.toContain('push:notify')
  })

  it('says nothing when nothing was posted', async () => {
    const names = await finishWith('every', true, 0)
    expect(names).not.toContain('email:sendDigest')
    expect(names).not.toContain('push:notify')
  })
})

describe('posts deleted in Buffer', () => {
  it('are marked deleted when Buffer no longer returns them, and leave the drafts list', async () => {
    const t = convexTest(schema, modules)
    const { userId, automationId } = await seed(t)
    const runId = await run(t, userId, automationId, 'now')
    const storyId = await t.run((ctx) =>
      ctx.db.insert('stories', {
        automationId,
        runId,
        title: 'T',
        canonicalUrl: 'https://x.y/z',
        source: 'x',
        publishedAt: '',
        summary: '',
        whyItMatters: '',
        keyFacts: [],
        confidence: 1,
        decision: 'kept',
        reason: '',
        createdAt: Date.now(),
      }),
    )
    const postId = await t.run((ctx) =>
      ctx.db.insert('posts', {
        userId,
        automationId,
        runId,
        storyId,
        channelId: 'c1',
        service: 'twitter',
        text: 'hello',
        status: 'draft',
        bufferPostId: 'b-gone',
        approveToken: 'tok',
        createdAt: Date.now(),
      }),
    )
    await t.run((ctx) =>
      ctx.db.insert('bufferChannels', {
        userId,
        organizationId: 'o1',
        channelId: 'c1',
        service: 'twitter',
        name: 'GPP',
        usable: true,
        syncedAt: Date.now(),
      }),
    )
    const pending = await t.query(internal.status.pending, {})
    expect(pending[0]!.orgs[0]!.expected).toEqual(['b-gone'])
    await t.mutation(internal.status.apply, { updates: [], missing: ['b-gone'] })
    const post = await t.run((ctx) => ctx.db.get(postId))
    expect(post?.status).toBe('deleted')
    expect(post?.approveToken).toBeUndefined()
    expect(await t.query(internal.status.pending, {})).toEqual([])
  })
})

describe('the first dry run', () => {
  it('starts by itself once, for an automation that has never run, while dry runs are left', async () => {
    const t = convexTest(schema, modules)
    const { userId, automationId } = await seed(t)
    const versionId = await t.run((ctx) =>
      ctx.db.insert('playbookVersions', {
        automationId,
        version: 1,
        playbook: {},
        text: '',
        createdBy: 'ai',
        createdAt: Date.now(),
      }),
    )
    await t.run((ctx) => ctx.db.patch(automationId, { playbookVersionId: versionId }))
    await t.mutation(internal.runs.firstDryRun, { automationId })
    let runs = await t.run((ctx) => ctx.db.query('runs').collect())
    expect(runs).toHaveLength(1)
    expect(runs[0]!.kind).toBe('dry')
    expect(runs[0]!.startedBy).toBe('first')
    expect(runs[0]!.steps[0]!.note).toContain('on its own')
    // Never twice, and never without a dry run left.
    await t.mutation(internal.runs.firstDryRun, { automationId })
    runs = await t.run((ctx) => ctx.db.query('runs').collect())
    expect(runs).toHaveLength(1)
    const other = await t.run((ctx) =>
      ctx.db.insert('automations', {
        userId,
        name: 'B',
        status: 'ready',
        setup: {
          research: 'B',
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
        playbookVersionId: versionId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    )
    await t.run((ctx) => ctx.db.patch(userId, { freeDryRunsUsed: 3 }))
    await t.mutation(internal.runs.firstDryRun, { automationId: other })
    expect(await t.run((ctx) => ctx.db.query('runs').collect())).toHaveLength(1)
  })
})

describe('failures on the AI side', () => {
  it('tells busy and broken replies apart from other errors', async () => {
    const { aiServiceFailure } = await import('./runs')
    const withStatus = (status: number, message = 'x') =>
      Object.assign(new Error(message), { status })
    expect(aiServiceFailure(withStatus(529))).toMatch(/too busy/)
    expect(aiServiceFailure(withStatus(429))).toMatch(/too busy/)
    expect(aiServiceFailure(withStatus(500))).toMatch(/had a problem/)
    expect(aiServiceFailure(new Error('Failed to parse structured output: x'))).toMatch(/problem/)
    expect(aiServiceFailure(withStatus(401))).toBeNull()
    expect(aiServiceFailure(new Error('Buffer said no'))).toBeNull()
  })

  it('gives a free dry run back once', async () => {
    const t = convexTest(schema, modules)
    const { runId, userId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', { email: 'a@example.com', freeDryRunsUsed: 2 })
      const runId = await ctx.db.insert('runs', {
        userId,
        kind: 'dry',
        status: 'failed',
        startedAt: 0,
        steps: [],
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
          webSearches: 0,
          webFetches: 0,
        },
        costUsd: 0,
        freeRun: true,
      })
      return { runId, userId }
    })
    await t.mutation(internal.runs.refundFreeRun, { runId })
    await t.mutation(internal.runs.refundFreeRun, { runId })
    const user = await t.run((ctx) => ctx.db.get(userId))
    expect(user?.freeDryRunsUsed).toBe(1)
  })
})

describe('spreading scheduled runs', () => {
  it('keeps the set time when nobody else runs then, and spreads a busy minute', async () => {
    const { scheduleNext } = await import('./automations')
    const t = convexTest(schema, modules)
    const ids: Id<'automations'>[] = []
    for (let i = 0; i < 6; i++) ids.push((await seed(t)).automationId)
    const book = (id: Id<'automations'>) =>
      t.run(async (ctx) => {
        await scheduleNext(ctx, (await ctx.db.get(id))!)
        return (await ctx.db.get(id))!.nextRunAt!
      })
    const first = await book(ids[0]!)
    expect(new Date(first).toISOString()).toMatch(/T08:00:00\.000Z$/)
    // Booking it again doesn't count itself.
    expect(await book(ids[0]!)).toBe(first)
    const rest = []
    for (const id of ids.slice(1)) rest.push(((await book(id)) - first) / 1000)
    expect(rest).toEqual([15, 30, 45, 60, 75])
  })
})

describe('the note on a run that started late', () => {
  it('explains a moved start and stays quiet for scheduler jitter', async () => {
    const { lateNote } = await import('./runs')
    const now = Date.parse('2026-11-10T08:02:00Z')
    expect(lateNote(undefined, 'UTC', now)).toBe('')
    expect(lateNote(3_000, 'UTC', now)).toBe('')
    expect(lateNote(30_000, 'UTC', now)).toBe(
      ' A few seconds after 08:01, because a lot of runs were set for then.',
    )
    expect(lateNote(120_000, 'Africa/Johannesburg', now)).toBe(
      ' 2 minutes after 10:00, because a lot of runs were set for then.',
    )
  })

  it('keeps showing the set time when a busy minute moves the start', async () => {
    const { scheduleNext } = await import('./automations')
    const t = convexTest(schema, modules)
    const ids: Id<'automations'>[] = []
    for (let i = 0; i < 5; i++) ids.push((await seed(t)).automationId)
    for (const id of ids) await t.run(async (ctx) => scheduleNext(ctx, (await ctx.db.get(id))!))
    const last = await t.run((ctx) => ctx.db.get(ids[4]!))
    expect(last!.nextRunAt! - last!.nextRunSetFor!).toBe(60_000)
    expect(new Date(last!.nextRunSetFor!).toISOString()).toMatch(/T08:00:00\.000Z$/)
  })
})
