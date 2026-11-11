import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './_generated/api'
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

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 10, 11, 18, 0)

type T = ReturnType<typeof convexTest>

async function seedUser(t: T, user: { freeRunsUsed?: number } = {}) {
  return await t.run((ctx) =>
    ctx.db.insert('users', { email: 'a@example.com', emailPrefs: 'never', ...user }),
  )
}

async function seedAutomation(
  t: T,
  userId: Id<'users'>,
  {
    name = 'F1',
    status = 'active',
    nextRunAt,
    withPlaybook = true,
  }: { name?: string; status?: string; nextRunAt?: number; withPlaybook?: boolean } = {},
) {
  return await t.run(async (ctx) => {
    const automationId = await ctx.db.insert('automations', {
      userId,
      name,
      status,
      setup: {
        research: 'F1',
        services: ['twitter'],
        avoid: '',
        sources: [],
        onlyTheseSources: false,
        cadence: { preset: 'daily', time: '09:00', weekday: null },
        maxStories: 3,
        postingMode: 'draft',
      },
      channelIds: ['c1'],
      cadence: { preset: 'daily', time: '09:00', weekday: null },
      timezone: 'UTC',
      postingMode: 'draft',
      maxPostsPerRun: 3,
      consecutiveFailures: 0,
      nextRunAt,
      createdAt: NOW - 10 * 24 * HOUR,
      updatedAt: NOW - 10 * 24 * HOUR,
    })
    if (withPlaybook) {
      const versionId = await ctx.db.insert('playbookVersions', {
        automationId,
        version: 1,
        playbook: {},
        text: '',
        createdBy: 'test',
        createdAt: NOW - 10 * 24 * HOUR,
      })
      await ctx.db.patch(automationId, { playbookVersionId: versionId })
    }
    return automationId
  })
}

async function seedRun(
  t: T,
  userId: Id<'users'>,
  automationId: Id<'automations'>,
  {
    kind = 'scheduled',
    status = 'done',
    startedAt,
    finished = true,
  }: { kind?: string; status?: string; startedAt: number; finished?: boolean },
) {
  return await t.run((ctx) =>
    ctx.db.insert('runs', {
      userId,
      automationId,
      kind,
      status,
      startedAt,
      finishedAt: finished ? startedAt + 60_000 : undefined,
      steps: [{ step: 'done', at: startedAt, note: 'Done. 1 post in Buffer.' }],
      usage: EMPTY,
      costUsd: 0,
    }),
  )
}

async function seedPost(
  t: T,
  userId: Id<'users'>,
  automationId: Id<'automations'>,
  runId: Id<'runs'>,
  post: { status: string; createdAt: number; dueAt?: number; sentAt?: number; text?: string },
) {
  return await t.run(async (ctx) => {
    const storyId = await ctx.db.insert('stories', {
      automationId,
      runId,
      title: 't',
      canonicalUrl: 'https://e.com/a',
      source: 'e.com',
      publishedAt: '',
      summary: '',
      whyItMatters: '',
      keyFacts: [],
      confidence: 1,
      decision: 'kept',
      reason: '',
      createdAt: post.createdAt,
    })
    return await ctx.db.insert('posts', {
      userId,
      automationId,
      runId,
      storyId,
      channelId: 'c1',
      service: 'twitter',
      text: post.text ?? 'x',
      status: post.status,
      bufferPostId: `b-${post.createdAt}`,
      createdAt: post.createdAt,
      dueAt: post.dueAt,
      sentAt: post.sentAt,
    })
  })
}

const as = (t: T, userId: Id<'users'>) => t.withIdentity({ subject: `${userId}|session` })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('the home page’s Up next and recent posts', () => {
  it('puts the soonest future post in Up next and keeps it out of recent posts', async () => {
    const t = convexTest(schema, modules)
    const userId = await seedUser(t)
    const automationId = await seedAutomation(t, userId)
    const runId = await seedRun(t, userId, automationId, { startedAt: NOW - 2 * HOUR })
    const later = await seedPost(t, userId, automationId, runId, {
      status: 'scheduled',
      createdAt: NOW - 2 * HOUR,
      dueAt: NOW + 20 * HOUR,
    })
    const soonest = await seedPost(t, userId, automationId, runId, {
      status: 'queued',
      createdAt: NOW - 3 * HOUR,
      dueAt: NOW + 2 * HOUR,
    })
    const sent = await seedPost(t, userId, automationId, runId, {
      status: 'sent',
      createdAt: NOW - HOUR,
      sentAt: NOW - HOUR,
    })
    await seedPost(t, userId, automationId, runId, { status: 'draft', createdAt: NOW - HOUR })

    const data = await as(t, userId).query(api.automations.dashboard, {})
    expect(data?.upcoming).toMatchObject({
      _id: soonest,
      automationName: 'F1',
      status: 'queued',
      at: NOW + 2 * HOUR,
    })
    // Newest first, without the Up next post or the draft.
    expect(data?.recent.map((p) => p._id)).toEqual([sent, later])
    expect(data?.recent[0]).toMatchObject({ status: 'sent', at: NOW - HOUR })
  })

  it('has no Up next when nothing in Buffer has a time still to come', async () => {
    const t = convexTest(schema, modules)
    const userId = await seedUser(t)
    const automationId = await seedAutomation(t, userId)
    const runId = await seedRun(t, userId, automationId, { startedAt: NOW - 30 * HOUR })
    await seedPost(t, userId, automationId, runId, {
      status: 'scheduled',
      createdAt: NOW - 30 * HOUR,
      dueAt: NOW - HOUR,
    })
    await seedPost(t, userId, automationId, runId, { status: 'queued', createdAt: NOW - HOUR })

    const data = await as(t, userId).query(api.automations.dashboard, {})
    expect(data?.upcoming).toBeNull()
    expect(data?.recent).toHaveLength(2)
  })

  it('shows at most five recent posts and none from a deleted automation', async () => {
    const t = convexTest(schema, modules)
    const userId = await seedUser(t)
    const automationId = await seedAutomation(t, userId)
    const gone = await seedAutomation(t, userId, { name: 'Gone' })
    await t.run((ctx) => ctx.db.patch(gone, { deletedAt: NOW - HOUR }))
    const runId = await seedRun(t, userId, automationId, { startedAt: NOW - 10 * HOUR })
    const goneRun = await seedRun(t, userId, gone, { startedAt: NOW - 10 * HOUR })
    for (let i = 1; i <= 7; i++)
      await seedPost(t, userId, automationId, runId, { status: 'sent', createdAt: NOW - i * HOUR })
    await seedPost(t, userId, gone, goneRun, { status: 'sent', createdAt: NOW - 30_000 })

    const data = await as(t, userId).query(api.automations.dashboard, {})
    expect(data?.recent).toHaveLength(5)
    expect(data?.recent.every((p) => p.automationName === 'F1')).toBe(true)
    expect(data?.recent[0]?.createdAt).toBe(NOW - HOUR)
  })
})

describe('the home page’s automation rows', () => {
  it('lists the week’s real runs with their status for the strip, leaving dry runs out', async () => {
    const t = convexTest(schema, modules)
    const userId = await seedUser(t)
    const automationId = await seedAutomation(t, userId)
    const ok = await seedRun(t, userId, automationId, { startedAt: NOW - 30 * HOUR })
    const failed = await seedRun(t, userId, automationId, {
      status: 'failed',
      startedAt: NOW - 54 * HOUR,
    })
    await seedRun(t, userId, automationId, { kind: 'dry', startedAt: NOW - 6 * HOUR })
    await seedRun(t, userId, automationId, { startedAt: NOW - 8 * 24 * HOUR })

    const data = await as(t, userId).query(api.automations.dashboard, {})
    const weekRuns = data?.automations[0]?.weekRuns ?? []
    expect(weekRuns).toHaveLength(2)
    expect(weekRuns).toEqual(
      expect.arrayContaining([
        { _id: ok, at: NOW - 30 * HOUR, status: 'done' },
        { _id: failed, at: NOW - 54 * HOUR, status: 'failed' },
      ]),
    )
  })

  it('says a run is going only while the latest is unfinished and under fifteen minutes old', async () => {
    const t = convexTest(schema, modules)
    const userId = await seedUser(t)
    const automationId = await seedAutomation(t, userId)
    await seedRun(t, userId, automationId, { startedAt: NOW - 5 * 60_000, finished: false })
    const user = as(t, userId)
    expect((await user.query(api.automations.dashboard, {}))?.automations[0]?.running).toBe(true)

    vi.setSystemTime(NOW + 20 * 60_000)
    expect((await user.query(api.automations.dashboard, {}))?.automations[0]?.running).toBe(false)
  })

  it('offers Run now only with a playbook and not while one is being written', async () => {
    const t = convexTest(schema, modules)
    const userId = await seedUser(t)
    await seedAutomation(t, userId, { name: 'Ready' })
    await seedAutomation(t, userId, { name: 'No playbook', withPlaybook: false })
    await seedAutomation(t, userId, { name: 'Writing', status: 'generating' })

    const data = await as(t, userId).query(api.automations.dashboard, {})
    const canRun = Object.fromEntries(data!.automations.map((a) => [a.name, a.canRun]))
    expect(canRun).toEqual({ Ready: true, 'No playbook': false, Writing: false })
  })

  it('names the automation that runs next', async () => {
    const t = convexTest(schema, modules)
    const userId = await seedUser(t)
    await seedAutomation(t, userId, { name: 'Later', nextRunAt: NOW + 20 * HOUR })
    await seedAutomation(t, userId, { name: 'Sooner', nextRunAt: NOW + 2 * HOUR })
    await seedAutomation(t, userId, { name: 'Paused', status: 'paused', nextRunAt: NOW + HOUR })

    const data = await as(t, userId).query(api.automations.dashboard, {})
    expect(data?.nextRunAt).toBe(NOW + 2 * HOUR)
    expect(data?.nextRunName).toBe('Sooner')
  })

  it('has no next run when nothing is on', async () => {
    const t = convexTest(schema, modules)
    const userId = await seedUser(t)
    await seedAutomation(t, userId, { status: 'paused', nextRunAt: NOW + HOUR })

    const data = await as(t, userId).query(api.automations.dashboard, {})
    expect(data?.nextRunAt).toBeNull()
    expect(data?.nextRunName).toBeNull()
  })
})

describe('the free runs figure on home', () => {
  it('gives the allowance alongside what is left, for "8 of 10"', async () => {
    const t = convexTest(schema, modules)
    const userId = await seedUser(t, { freeRunsUsed: 2 })
    expect(await as(t, userId).query(api.users.viewer, {})).toMatchObject({
      runsLeft: 8,
      runsAllowed: 10,
    })
  })

  it('follows the configured allowance', async () => {
    vi.stubEnv('FREE_RUNS_PER_USER', '25')
    const t = convexTest(schema, modules)
    const userId = await seedUser(t, { freeRunsUsed: 5 })
    expect(await as(t, userId).query(api.users.viewer, {})).toMatchObject({
      runsLeft: 20,
      runsAllowed: 25,
    })
  })
})
