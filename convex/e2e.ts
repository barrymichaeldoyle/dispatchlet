import { ConvexCredentials } from '@convex-dev/auth/providers/ConvexCredentials'
import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { DataModel, Id } from './_generated/dataModel'
import { internalMutation, type MutationCtx } from './_generated/server'
import { renderPlaybook, type Playbook } from './lib/playbook'

/**
 * A sign-in for the browser tests, so screens behind Buffer sign-in can be tested end to end.
 *
 * It only works on a deployment that has `E2E_AUTH_SECRET` set (32 characters or more), and never
 * on production, whatever its variables say. The caller must send that secret. It signs in one
 * fixed test user, who has no Buffer connection, and resets that user's data to a known fixture
 * on every sign-in. Set it on the dev deployment with `npx convex env set E2E_AUTH_SECRET …`.
 */

export const E2E_EMAIL = 'e2e@dispatchlet.test'
const PRODUCTION = 'amiable-mosquito-364'

export function e2eEnabled(): boolean {
  const secret = process.env.E2E_AUTH_SECRET ?? ''
  const url = process.env.CONVEX_CLOUD_URL ?? ''
  return secret.length >= 32 && !url.includes(PRODUCTION)
}

/** Whether this is the test user on a deployment where the test sign-in is on. */
export function isE2eUser(email: string | null | undefined): boolean {
  return e2eEnabled() && email === E2E_EMAIL
}

/** Compares in time that does not depend on where the strings differ. */
function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given)
  const b = new TextEncoder().encode(expected)
  let diff = a.length ^ b.length
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i]!
  return diff === 0
}

export const E2eSignIn = ConvexCredentials<DataModel>({
  id: 'e2e',
  authorize: async (credentials, ctx) => {
    if (!e2eEnabled()) return null
    const secret = typeof credentials.secret === 'string' ? credentials.secret : ''
    if (!sameSecret(secret, process.env.E2E_AUTH_SECRET!)) return null
    const userId: Id<'users'> = await ctx.runMutation(internal.e2e.reset, {})
    return { userId }
  },
})

/** A complete playbook, so the automation page renders as it would for a real one. */
const PLAYBOOK: Playbook = {
  name: 'F1 On This Day',
  about: 'Formula 1 history on the date it happened: title deciders, firsts and famous races.',
  sources: [
    {
      label: 'Formula 1',
      url: 'https://www.formula1.com',
      note: 'Official race history.',
      priority: 'high',
    },
    { label: 'Motorsport.com', url: null, note: 'Archive features.', priority: 'normal' },
  ],
  searchQueries: ['Formula 1 on this day', 'F1 history today'],
  freshnessHours: 48,
  include: ['Championship deciders', 'First wins'],
  exclude: ['Rumours'],
  voice: {
    tone: 'Warm and factual.',
    notes: '',
    avoidSaying: ['legendary'],
    emoji: 'none',
    hashtags: 'few',
  },
  formats: [
    {
      service: 'twitter',
      style: 'One short post.',
      maxLength: null,
      thread: false,
      linkBack: null,
    },
  ],
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** The test user, and their data put back to the fixture the browser tests expect. */
export const reset = internalMutation({
  args: {},
  returns: v.id('users'),
  handler: async (ctx) => {
    if (!e2eEnabled()) throw new Error('The test sign-in is off on this deployment.')
    const existing = await ctx.db
      .query('users')
      .withIndex('email', (q) => q.eq('email', E2E_EMAIL))
      .first()
    const userId =
      existing?._id ??
      (await ctx.db.insert('users', { email: E2E_EMAIL, name: 'Test Person', emailPrefs: 'never' }))
    await clear(ctx, userId)
    await ctx.db.patch(userId, {
      name: 'Test Person',
      timezone: 'UTC',
      emailPrefs: 'never',
      freeRunsUsed: 2,
      freeDryRunsUsed: 0,
      anthropicKeyEnc: undefined,
      anthropicKeyInvalidAt: undefined,
    })
    await seed(ctx, userId)
    return userId
  },
})

/** Removes everything the fixture or a test can have made for the test user. */
async function clear(ctx: MutationCtx, userId: Id<'users'>) {
  const automations = await ctx.db
    .query('automations')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect()
  for (const a of automations) {
    if (a.scheduledFnId) await ctx.scheduler.cancel(a.scheduledFnId).catch(() => {})
    const runs = await ctx.db
      .query('runs')
      .withIndex('by_automation_startedAt', (q) => q.eq('automationId', a._id))
      .collect()
    for (const run of runs) {
      for (const post of await ctx.db
        .query('posts')
        .withIndex('by_run', (q) => q.eq('runId', run._id))
        .collect())
        await ctx.db.delete(post._id)
      for (const story of await ctx.db
        .query('stories')
        .withIndex('by_run', (q) => q.eq('runId', run._id))
        .collect())
        await ctx.db.delete(story._id)
      await ctx.db.delete(run._id)
    }
    for (const version of await ctx.db
      .query('playbookVersions')
      .withIndex('by_automation_version', (q) => q.eq('automationId', a._id))
      .collect())
      await ctx.db.delete(version._id)
    await ctx.db.delete(a._id)
  }
}

/**
 * One automation that ran today and posted, failed two days ago, and runs again tomorrow at
 * 09:00 UTC, with one post sent and one scheduled. It is paused in the database's eyes only once
 * a test pauses it; nothing here is booked with the scheduler, so no real run starts.
 */
async function seed(ctx: MutationCtx, userId: Id<'users'>) {
  const now = Date.now()
  const today9 = new Date(now).setUTCHours(9, 0, 0, 0)
  const lastRunAt = today9 <= now ? today9 : today9 - DAY
  const nextRunAt = lastRunAt + DAY
  const cadence = { preset: 'daily' as const, time: '09:00', weekday: null }
  const automationId = await ctx.db.insert('automations', {
    userId,
    name: 'F1 On This Day',
    status: 'active',
    setup: {
      research: 'Formula 1 history',
      services: ['twitter'],
      avoid: '',
      sources: [],
      onlyTheseSources: false,
      cadence,
      maxStories: 1,
      postingMode: 'draft',
    },
    channelIds: ['e2e-channel'],
    cadence,
    timezone: 'UTC',
    postingMode: 'draft',
    maxPostsPerRun: 1,
    consecutiveFailures: 0,
    nextRunAt,
    createdAt: now - 10 * DAY,
    updatedAt: now - 10 * DAY,
  })
  const versionId = await ctx.db.insert('playbookVersions', {
    automationId,
    version: 1,
    playbook: PLAYBOOK,
    text: renderPlaybook(PLAYBOOK),
    createdBy: 'e2e',
    createdAt: now - 10 * DAY,
  })
  await ctx.db.patch(automationId, { playbookVersionId: versionId })

  const run = async (startedAt: number, status: string, note: string) =>
    await ctx.db.insert('runs', {
      userId,
      automationId,
      playbookVersionId: versionId,
      kind: 'scheduled',
      status,
      startedAt,
      finishedAt: startedAt + 60_000,
      steps: [{ step: status, at: startedAt + 60_000, note }],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        webSearches: 0,
        webFetches: 0,
      },
      costUsd: 0,
      found: 1,
      kept: 1,
      posted: status === 'done' ? 1 : 0,
    })
  await run(lastRunAt - 2 * DAY, 'failed', 'Research returned nothing usable.')
  const todayRun = await run(lastRunAt, 'done', 'Done. 1 post in Buffer.')

  const post = async (text: string, fields: Record<string, number | string>) => {
    const storyId = await ctx.db.insert('stories', {
      automationId,
      runId: todayRun,
      title: text,
      canonicalUrl: 'https://example.com/story',
      source: 'example.com',
      publishedAt: '',
      summary: '',
      whyItMatters: '',
      keyFacts: [],
      confidence: 1,
      decision: 'kept',
      reason: '',
      createdAt: lastRunAt,
    })
    await ctx.db.insert('posts', {
      userId,
      automationId,
      runId: todayRun,
      storyId,
      channelId: 'e2e-channel',
      service: 'twitter',
      text,
      createdAt: lastRunAt + 30_000,
      status: 'sent',
      ...fields,
    })
  }
  await post('On this day in 1990, Senna won the title at Suzuka.', {
    status: 'sent',
    bufferPostId: 'e2e-sent',
    sentAt: lastRunAt + 120_000,
    // Keeps the daily metrics poll from asking Buffer about a post it has never seen.
    metricsUpdatedAt: now,
  })
  await post('On this day in 1976, Hunt won the title at Fuji.', {
    status: 'scheduled',
    bufferPostId: 'e2e-scheduled',
    dueAt: nextRunAt,
  })
}
