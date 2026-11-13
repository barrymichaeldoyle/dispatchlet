import { convexTest } from 'convex-test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import schema from './schema'
import { approveLinkToken } from './lib/crypto'

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

describe('telling the person after a run', () => {
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

const withStatus = (status: number, message = 'x') => Object.assign(new Error(message), { status })

describe('failures on the AI side', () => {
  it('tells busy and broken replies apart from other errors', async () => {
    const { serviceFailure: aiServiceFailure } = await import('./runs')
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
      const owner = await ctx.db.insert('users', { email: 'a@example.com', freeDryRunsUsed: 2 })
      const failed = await ctx.db.insert('runs', {
        userId: owner,
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
      return { runId: failed, userId: owner }
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

describe('saving a story to Buffer Ideas', () => {
  it('asks Buffer for ideas access only when switched on', async () => {
    const { bufferScopes } = await import('./auth')
    expect(bufferScopes()).not.toContain('ideas:write')
    process.env.BUFFER_IDEAS = 'true'
    try {
      expect(bufferScopes()).toBe('account:read posts:read posts:write ideas:write offline_access')
    } finally {
      delete process.env.BUFFER_IDEAS
    }
  })

  it('turns a story into idea text with its source', async () => {
    const { ideaText } = await import('./runs')
    expect(
      ideaText({
        summary: 'Kenya launched a programme.',
        whyItMatters: 'It funds 2.7m hectares.',
        source: 'kbc.co.ke',
        canonicalUrl: 'https://kbc.co.ke/a',
      }),
    ).toBe(
      'Kenya launched a programme.\n\nIt funds 2.7m hectares.\n\nSource: kbc.co.ke, https://kbc.co.ke/a',
    )
  })

  it('refuses kept and duplicate stories, and connections without ideas access', async () => {
    const t = convexTest(schema, modules)
    const { userId, automationId } = await seed(t)
    const story = (decision: string) =>
      t.run(async (ctx) => {
        const runId = await ctx.db.insert('runs', {
          userId,
          automationId,
          kind: 'now',
          status: 'done',
          startedAt: 0,
          steps: [],
          usage: EMPTY,
          costUsd: 0,
        })
        return await ctx.db.insert('stories', {
          automationId,
          runId,
          title: 'A story',
          canonicalUrl: 'https://example.com/a',
          source: 'example.com',
          publishedAt: '2026-10-30',
          summary: 's',
          whyItMatters: 'w',
          keyFacts: [],
          confidence: 0.9,
          decision,
          reason: 'r',
          createdAt: 0,
        })
      })
    const save = async (storyId: Id<'stories'>) =>
      t.action(internal.runs.saveIdeaForUser, { userId, storyId })
    await expect(save(await story('kept'))).rejects.toThrow('Only stories')
    await expect(save(await story('skipped_dup'))).rejects.toThrow('Only stories')
    await expect(save(await story('skipped_limit'))).rejects.toThrow('Reconnect Buffer')
  })
})

describe('when the status poll asks Buffer about a post', () => {
  const MIN = 60_000
  const HOUR = 60 * MIN

  it('checks a scheduled post a few minutes after it is due, then hourly', async () => {
    const { dueForCheck } = await import('./status')
    const due = Date.parse('2026-11-10T08:00:00Z')
    const checkedYesterday = due - 20 * HOUR
    const post = { status: 'scheduled', dueAt: due, statusCheckedAt: checkedYesterday }
    expect(dueForCheck(post, due - HOUR).check).toBe(false)
    expect(dueForCheck(post, due + 2 * MIN).check).toBe(false)
    expect(dueForCheck(post, due + 6 * MIN)).toEqual({ check: true, urgent: true })
    const checked = { ...post, statusCheckedAt: due + 6 * MIN }
    expect(dueForCheck(checked, due + 30 * MIN).check).toBe(false)
    expect(dueForCheck(checked, due + 66 * MIN).check).toBe(true)
  })

  it('backs off to every 6 hours once a post is a day past due and still not sent', async () => {
    const { dueForCheck } = await import('./status')
    const due = Date.parse('2026-11-10T08:00:00Z')
    const now = due + 30 * HOUR
    const post = { status: 'scheduled', dueAt: due }
    expect(dueForCheck({ ...post, statusCheckedAt: now - 2 * HOUR }, now).check).toBe(false)
    expect(dueForCheck({ ...post, statusCheckedAt: now - 6 * HOUR }, now)).toEqual({
      check: true,
      urgent: false,
    })
  })

  it('checks a draft every 6 hours and a post not yet due once a day', async () => {
    const { dueForCheck } = await import('./status')
    const now = Date.parse('2026-11-10T12:00:00Z')
    expect(dueForCheck({ status: 'draft', statusCheckedAt: now - 2 * HOUR }, now).check).toBe(false)
    expect(dueForCheck({ status: 'draft', statusCheckedAt: now - 7 * HOUR }, now).check).toBe(true)
    expect(dueForCheck({ status: 'draft' }, now).check).toBe(true)
    const later = { status: 'scheduled', dueAt: now + 3 * 24 * HOUR }
    expect(dueForCheck({ ...later, statusCheckedAt: now - HOUR }, now).check).toBe(false)
    expect(dueForCheck({ ...later, statusCheckedAt: now - 25 * HOUR }, now).check).toBe(true)
  })

  it('leaves an organization alone after a check, and caps calls a day', async () => {
    const t = convexTest(schema, modules)
    const { userId, automationId } = await seed(t)
    await t.run(async (ctx) => {
      const runId = await ctx.db.insert('runs', {
        userId,
        automationId,
        kind: 'now',
        status: 'done',
        startedAt: 0,
        steps: [],
        usage: EMPTY,
        costUsd: 0,
      })
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
        createdAt: Date.now(),
      })
      await ctx.db.insert('posts', {
        userId,
        automationId,
        runId,
        storyId,
        channelId: 'c1',
        service: 'twitter',
        text: 'hello',
        status: 'draft',
        bufferPostId: 'b-1',
        createdAt: Date.now(),
      })
      await ctx.db.insert('bufferChannels', {
        userId,
        organizationId: 'o1',
        channelId: 'c1',
        service: 'twitter',
        name: 'GPP',
        usable: true,
        syncedAt: Date.now(),
      })
    })
    expect(await t.query(internal.status.pending, {})).toHaveLength(1)
    await t.mutation(internal.status.apply, { updates: [], checked: ['b-1'] })
    expect(await t.query(internal.status.pending, {})).toEqual([])
    expect(await t.query(internal.status.pending, { now: Date.now() + 7 * HOUR })).toHaveLength(1)

    process.env.STATUS_CALLS_PER_DAY = '2'
    try {
      expect(await t.mutation(internal.status.claimStatusCall, {})).toBe(true)
      expect(await t.mutation(internal.status.claimStatusCall, {})).toBe(true)
      expect(await t.mutation(internal.status.claimStatusCall, {})).toBe(false)
    } finally {
      delete process.env.STATUS_CALLS_PER_DAY
    }
  })
})

/** One row of Buffer's posts query, as the status poll reads it. */
const statusRow = (id: string, status: string) => ({
  node: { id, status, sentAt: null, externalLink: null, error: null },
})

describe('when the first page of statuses is full of other posts', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('asks once more for the tagged posts, and marks nothing deleted', async () => {
    vi.stubEnv('TOKEN_ENC_KEY', btoa('n'.repeat(32)))
    vi.stubEnv('SERVER_EVENTS', 'off')
    const { encryptSecret } = await import('./lib/crypto')
    const { saveBufferConnection } = await import('./buffer')
    const { STATUS_PAGE } = await import('./status')
    const t = convexTest(schema, modules)
    const { postId } = await draftAndStory(t)
    const post = (await t.run((ctx) => ctx.db.get(postId)))!
    await t.run((ctx) =>
      ctx.db.patch(postId, { status: 'scheduled', dueAt: 0, createdAt: Date.now() }),
    )
    const accessTokenEnc = await encryptSecret('test-access')
    await t.run(async (ctx) => {
      await saveBufferConnection(ctx, post.userId, {
        bufferAccountId: 'buffer-1',
        accessTokenEnc,
        expiresAt: Date.now() + 3_600_000,
        scope: 'posts:write',
      })
      const connection = await ctx.db.query('bufferConnections').first()
      await ctx.db.patch(connection!._id, { tags: [{ organizationId: 'o1', tagId: 'tag-1' }] })
      await ctx.db.insert('bufferChannels', {
        userId: post.userId,
        organizationId: 'o1',
        channelId: 'c1',
        service: 'twitter',
        name: 'GPP',
        usable: true,
        syncedAt: Date.now(),
      })
    })
    const fetch = vi.fn().mockImplementation(async (_url: string, init: { body: string }) => {
      const { variables } = JSON.parse(init.body)
      const edges = variables.tags
        ? [statusRow('b-1', 'sent')]
        : Array.from({ length: STATUS_PAGE }, (_, i) => statusRow(`other-${i}`, 'sent'))
      return Response.json({ data: { posts: { edges } } })
    })
    vi.stubGlobal('fetch', fetch)
    await t.action(internal.status.poll, {})
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetch.mock.calls[1]![1].body).variables.tags).toEqual({ in: ['tag-1'] })
    expect((await t.run((ctx) => ctx.db.get(postId)))?.status).toBe('sent')
  })

  it('keeps a post sent for approval in Buffer as a draft here', async () => {
    const t = convexTest(schema, modules)
    const { postId } = await draftAndStory(t)
    await t.mutation(internal.status.apply, {
      updates: [
        {
          bufferPostId: 'b-1',
          status: 'needs_approval',
          sentAt: null,
          externalLink: null,
          error: null,
        },
      ],
    })
    const post = await t.run((ctx) => ctx.db.get(postId))
    expect(post).toMatchObject({ status: 'draft', bufferStatus: 'needs_approval' })
  })
})

describe('a run whose channels are all locked', () => {
  it('is skipped, says why, and does not count as a failure', async () => {
    const { channelIssue } = await import('./runs')
    expect(channelIssue({ problem: 'locked' })).toBe(
      'it is locked in Buffer, usually by the plan’s channel limit',
    )
    expect(channelIssue({ problem: 'disconnected' })).toBe('it is disconnected in Buffer')
    expect(channelIssue({})).toBe('it needs attention in Buffer')
  })
})

describe('fair to the person when Dispatchlet is the one at fault', () => {
  it('treats Buffer and network trouble as ours, but not lost access or a bad key', async () => {
    const { serviceFailure } = await import('./runs')
    const { BufferApiError } = await import('./lib/buffer')
    const { BufferBudgetError } = await import('./buffer')
    expect(serviceFailure(new BufferApiError('down', 503))).toMatch(/Buffer was not answering/)
    expect(serviceFailure(new BufferApiError('slow down', 429))).toMatch(/Buffer/)
    expect(serviceFailure(new BufferApiError('Sign in with Buffer again', 401))).toBeNull()
    expect(serviceFailure(new TypeError('fetch failed'))).toMatch(/did not answer/)
    expect(serviceFailure(new BufferBudgetError(Date.now() + 60_000, 'share'))).toMatch(
      /today’s share/,
    )
    expect(serviceFailure(Object.assign(new Error('bad key'), { status: 401 }))).toBeNull()
  })

  it('a failure on our side does not count toward pausing the automation', async () => {
    const t = convexTest(schema, modules)
    const { userId, automationId } = await seed(t, 2)
    const runId = await run(t, userId, automationId, 'scheduled')
    await t.mutation(internal.runs.finish, {
      runId,
      status: 'failed',
      note: 'The AI service was too busy.',
      counts: false,
    })
    const a = await t.run((ctx) => ctx.db.get(automationId))
    expect(a?.consecutiveFailures).toBe(2)
    expect(a?.status).toBe('active')
  })

  it('closes a run that stopped part way, and gives its free run back', async () => {
    const t = convexTest(schema, modules)
    const { userId, automationId } = await seed(t)
    const runId = await t.run(async (ctx) => {
      await ctx.db.patch(userId, { freeRunsUsed: 1 })
      return await ctx.db.insert('runs', {
        userId,
        automationId,
        kind: 'scheduled',
        status: 'researching',
        startedAt: Date.now() - 20 * 60_000,
        steps: [],
        usage: EMPTY,
        costUsd: 0,
        freeRun: true,
      })
    })
    const fresh = await run(t, userId, automationId, 'now')
    expect(await t.action(internal.runs.sweepAbandoned, {})).toBe(1)
    const stopped = await t.run((ctx) => ctx.db.get(runId))
    expect(stopped?.status).toBe('failed')
    expect(stopped?.steps.at(-1)?.note).toMatch(/does not count toward pausing/)
    expect((await t.run((ctx) => ctx.db.get(fresh)))?.finishedAt).toBeUndefined()
    const user = await t.run((ctx) => ctx.db.get(userId))
    expect(user?.freeRunsUsed).toBe(0)
    const a = await t.run((ctx) => ctx.db.get(automationId))
    expect(a?.consecutiveFailures ?? 0).toBe(0)
  })

  it('keeps the free run spent when the stopped run had already sent posts', async () => {
    const t = convexTest(schema, modules)
    const { userId, automationId } = await seed(t)
    const runId = await t.run(async (ctx) => {
      await ctx.db.patch(userId, { freeRunsUsed: 1 })
      return await ctx.db.insert('runs', {
        userId,
        automationId,
        kind: 'now',
        status: 'publishing',
        startedAt: Date.now() - 20 * 60_000,
        steps: [],
        usage: EMPTY,
        costUsd: 0,
        freeRun: true,
        posted: 2,
      })
    })
    await t.action(internal.runs.sweepAbandoned, {})
    expect((await t.run((ctx) => ctx.db.get(runId)))?.steps.at(-1)?.note).not.toMatch(/free runs/)
    expect((await t.run((ctx) => ctx.db.get(userId)))?.freeRunsUsed).toBe(1)
  })
})

describe('a fair share of the Buffer budget', () => {
  it('caps background calls per account a day, never app clicks', async () => {
    const t = convexTest(schema, modules)
    const { userId } = await seed(t)
    process.env.BUFFER_BACKGROUND_CALLS_PER_USER = '2'
    try {
      const reserve = (priority: 'background' | 'interactive') =>
        t.mutation(internal.buffer.reserveCalls, { userId, calls: 1, priority })
      expect((await reserve('background')).ok).toBe(true)
      expect((await reserve('background')).ok).toBe(true)
      expect(await reserve('background')).toMatchObject({ ok: false, share: true })
      expect((await reserve('interactive')).ok).toBe(true)
    } finally {
      delete process.env.BUFFER_BACKGROUND_CALLS_PER_USER
    }
  })

  it('caps app clicks an hour too, so one person cannot spend the shared allowance', async () => {
    const t = convexTest(schema, modules)
    const { userId } = await seed(t)
    process.env.BUFFER_INTERACTIVE_CALLS_PER_HOUR = '2'
    try {
      const reserve = () =>
        t.mutation(internal.buffer.reserveCalls, { userId, calls: 1, priority: 'interactive' })
      expect((await reserve()).ok).toBe(true)
      expect((await reserve()).ok).toBe(true)
      expect(await reserve()).toMatchObject({ ok: false, ceiling: true })
    } finally {
      delete process.env.BUFFER_INTERACTIVE_CALLS_PER_HOUR
    }
  })
})

describe('the approve link in the digest email', () => {
  it('only shows the draft when opened, so a link scanner cannot approve it', async () => {
    const t = convexTest(schema, modules)
    const { userId, automationId } = await seed(t)
    const postId = await t.run(async (ctx) => {
      const runId = await ctx.db.insert('runs', {
        userId,
        automationId,
        kind: 'now',
        status: 'done',
        startedAt: 0,
        steps: [],
        usage: EMPTY,
        costUsd: 0,
      })
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
        createdAt: 0,
      })
      return await ctx.db.insert('posts', {
        userId,
        automationId,
        runId,
        storyId,
        channelId: 'c1',
        service: 'twitter',
        text: 'Lions <b>back</b> in Kunene',
        status: 'draft',
        bufferPostId: 'b-1',
        approveToken: 'tok-1',
        createdAt: 0,
      })
    })
    vi.stubEnv('TOKEN_ENC_KEY', btoa('n'.repeat(32)))
    const link = await approveLinkToken(postId, 'tok-1')
    // The stored nonce is not a link: only the signed token opens it.
    expect((await t.fetch('/approve?token=tok-1')).status).toBe(404)
    expect((await t.fetch(`/approve?token=${postId}.forged`)).status).toBe(404)
    const res = await t.fetch(`/approve?token=${encodeURIComponent(link)}`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Approve and schedule')
    expect(html).toContain('Lions &lt;b&gt;back&lt;/b&gt; in Kunene')
    expect(html).toContain('method="post"')
    expect(html).toContain('b.disabled=true')
    const post = await t.run((ctx) => ctx.db.get(postId))
    expect(post?.status).toBe('draft')
    expect(post?.approveToken).toBe('tok-1')
    expect((await t.fetch('/approve?token=nope', { method: 'POST' })).status).toBe(404)
  })
})

async function draftAndStory(t: ReturnType<typeof convexTest>) {
  const { userId, automationId } = await seed(t)
  return await t.run(async (ctx) => {
    const runId = await ctx.db.insert('runs', {
      userId,
      automationId,
      kind: 'now',
      status: 'done',
      startedAt: 0,
      steps: [],
      usage: EMPTY,
      costUsd: 0,
    })
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
      decision: 'skipped_limit',
      reason: '',
      createdAt: 0,
    })
    const postId = await ctx.db.insert('posts', {
      userId,
      automationId,
      runId,
      storyId,
      channelId: 'c1',
      service: 'twitter',
      text: 'x',
      status: 'draft',
      bufferPostId: 'b-1',
      createdAt: 0,
    })
    return { postId, storyId }
  })
}

async function noteFixture(scope = 'posts:write notes:write') {
  vi.stubEnv('BUFFER_NOTES', 'true')
  vi.stubEnv('SITE_URL', 'https://dispatchlet.example/')
  vi.stubEnv('TOKEN_ENC_KEY', btoa('n'.repeat(32)))
  vi.stubEnv('SERVER_EVENTS', 'off')
  const { encryptSecret } = await import('./lib/crypto')
  const { saveBufferConnection } = await import('./buffer')
  const accessTokenEnc = await encryptSecret('test-access')
  const t = convexTest(schema, modules)
  const { postId } = await draftAndStory(t)
  const post = (await t.run((ctx) => ctx.db.get(postId)))!
  await t.run((ctx) =>
    saveBufferConnection(ctx, post.userId, {
      bufferAccountId: 'buffer-1',
      accessTokenEnc,
      scope,
      expiresAt: Date.now() + 3_600_000,
    }),
  )
  const fetch = vi.fn().mockImplementation(async () =>
    Response.json({
      data: {
        createCollaborationNote: {
          __typename: 'CreateCollaborationNoteSuccess',
          edge: { node: { id: 'note-1' } },
        },
      },
    }),
  )
  vi.stubGlobal('fetch', fetch)
  return { t, post, fetch }
}

describe('Buffer notes linking back to a run', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('requests notes access only when enabled', async () => {
    const { bufferScopes } = await import('./auth')
    vi.stubEnv('BUFFER_NOTES', 'false')
    expect(bufferScopes()).not.toContain('notes:write')
    vi.stubEnv('BUFFER_NOTES', 'true')
    expect(bufferScopes()).toContain('notes:write')
    expect(bufferScopes()).not.toContain('notes:read')
  })

  it.each(['new', 'held'] as const)('adds a note after persisting a %s post', async (kind) => {
    vi.useFakeTimers()
    const { t, post, fetch } = await noteFixture()
    if (kind === 'new') {
      const { _id, _creationTime, createdAt: _createdAt, ...args } = post
      await t.mutation(internal.runs.savePost, args)
    } else {
      await t.run((ctx) => ctx.db.patch(post._id, { status: 'held', bufferPostId: undefined }))
      await t.mutation(internal.runs.markSent, {
        postId: post._id,
        status: 'scheduled',
        bufferPostId: 'b-1',
      })
    }
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://api.buffer.com')
    const request = JSON.parse(init.body)
    expect(request.query).toContain('createCollaborationNote')
    expect(request.variables.input).toEqual({
      subject: { postId: 'b-1' },
      text: `Created by Dispatchlet. View the run: https://dispatchlet.example/app/a/${post.automationId}/runs/${post.runId}`,
      annotations: [],
    })
  })

  it('skips connections without the new permission and skips when disabled', async () => {
    const { t, post, fetch } = await noteFixture('posts:write')
    await t.action(internal.buffer.addPostNote, { postId: post._id })
    vi.stubEnv('BUFFER_NOTES', 'false')
    await t.action(internal.buffer.addPostNote, { postId: post._id })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['typed error', 'timeout', 'budget'])(
    'leaves the saved post intact without retrying on a %s',
    async (failure) => {
      const { t, post, fetch } = await noteFixture()
      if (failure === 'timeout') fetch.mockRejectedValue(new Error('Request timed out'))
      else if (failure === 'typed error')
        fetch.mockImplementation(async () =>
          Response.json({
            data: {
              createCollaborationNote: { __typename: 'InvalidInputError', message: 'Unavailable' },
            },
          }),
        )
      else {
        vi.stubEnv('BUFFER_BACKGROUND_CALLS_PER_USER', '1')
        await t.mutation(internal.buffer.reserveCalls, {
          userId: post.userId,
          calls: 1,
          priority: 'background',
        })
      }
      await expect(t.action(internal.buffer.addPostNote, { postId: post._id })).resolves.toBeNull()
      expect(fetch).toHaveBeenCalledTimes(failure === 'budget' ? 0 : 1)
      expect(await t.run((ctx) => ctx.db.get(post._id))).toEqual(post)
    },
  )
})

describe('double clicks', () => {
  it('approve a draft once, and free it again if Buffer refused', async () => {
    const t = convexTest(schema, modules)
    const { postId } = await draftAndStory(t)
    expect(await t.mutation(internal.approvals.claimApproval, { postId })).toBe('claimed')
    expect(await t.mutation(internal.approvals.claimApproval, { postId })).toBe('busy')
    await t.mutation(internal.approvals.releaseApproval, { postId })
    expect(await t.mutation(internal.approvals.claimApproval, { postId })).toBe('claimed')
  })

  it('send the post’s text when approving into the queue, since Buffer reads an edit without it as empty', async () => {
    const { t, post, fetch } = await noteFixture()
    fetch.mockImplementation(async () =>
      Response.json({
        data: {
          editPost: {
            __typename: 'PostActionSuccess',
            post: { id: post.bufferPostId, status: 'scheduled', dueAt: null },
          },
        },
      }),
    )
    await t.action(internal.approvals.approveForUser, { userId: post.userId, postId: post._id })
    const body = JSON.parse(fetch.mock.calls.at(-1)![1].body)
    expect(body.variables.input).toMatchObject({
      id: post.bufferPostId,
      saveToDraft: false,
      mode: 'addToQueue',
      text: post.text,
    })
    expect(body.variables.input.dueAt).toBeUndefined()
    expect((await t.run((ctx) => ctx.db.get(post._id)))?.status).toBe('queued')
  })

  it('refuse an edit while the draft is being approved, so Buffer does not take it back to drafts', async () => {
    const t = convexTest(schema, modules)
    const { postId } = await draftAndStory(t)
    const post = await t.run((ctx) => ctx.db.get(postId))
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(await t.mutation(internal.approvals.claimApproval, { postId })).toBe('claimed')
    await expect(
      t.action(internal.approvals.editForUser, {
        userId: post!.userId,
        postId,
        text: 'Changed.',
        from: 'app',
      }),
    ).rejects.toThrow(/being approved/)
    expect(fetch).not.toHaveBeenCalled()
    expect((await t.run((ctx) => ctx.db.get(postId)))?.text).toBe('x')
    vi.unstubAllGlobals()
  })

  it('save a story to Buffer Ideas once', async () => {
    const t = convexTest(schema, modules)
    const { storyId } = await draftAndStory(t)
    expect(await t.mutation(internal.runs.claimIdea, { storyId })).toEqual({ kind: 'claimed' })
    expect(await t.mutation(internal.runs.claimIdea, { storyId })).toEqual({ kind: 'busy' })
    await t.mutation(internal.runs.markIdea, { storyId, ideaId: 'idea-1' })
    expect(await t.mutation(internal.runs.claimIdea, { storyId })).toEqual({
      kind: 'saved',
      ideaId: 'idea-1',
    })
  })
})

async function reviewFixture(t: ReturnType<typeof convexTest>) {
  const { postId, storyId } = await draftAndStory(t)
  const savedPost = await t.run(async (ctx) => {
    const post = (await ctx.db.get(postId)) as Doc<'posts'>
    await ctx.db.patch(storyId, { decision: 'kept' })
    await ctx.db.patch(post.runId, { finishedAt: Date.now(), status: 'done' })
    await ctx.db.patch(postId, { createdAt: Date.now() })
    return post
  })
  const user = t.withIdentity({ subject: `${savedPost.userId}|session` })
  return { postId, storyId, post: savedPost, user }
}

describe('editorial feedback', () => {
  it('skips without changing the playbook or Buffer status, blocks approval, and can be undone', async () => {
    const t = convexTest(schema, modules)
    const { user, postId, storyId } = await reviewFixture(t)
    expect((await user.query(api.automations.dashboard, {}))?.drafts).toHaveLength(1)
    await user.mutation(api.runs.skipStory, { storyId, reason: 'Too promotional' })
    expect(await t.run((ctx) => ctx.db.get(storyId))).toMatchObject({
      decision: 'kept',
      review: { reason: 'Too promotional' },
    })
    expect(await t.run((ctx) => ctx.db.get(postId))).toMatchObject({
      status: 'draft',
      bufferPostId: 'b-1',
      reviewSkipped: true,
    })
    expect(await t.run((ctx) => ctx.db.query('playbookVersions').collect())).toHaveLength(0)
    expect((await user.query(api.automations.dashboard, {}))?.drafts).toHaveLength(0)
    expect(await t.mutation(internal.approvals.claimApproval, { postId })).toBe('skipped')
    await expect(user.action(api.runs.approve, { postId })).rejects.toThrow(
      'This story was skipped',
    )
    vi.stubEnv('TOKEN_ENC_KEY', btoa('n'.repeat(32)))
    await t.run((ctx) => ctx.db.patch(postId, { approveToken: 'skipped-story-token' }))
    expect(
      await t.action(internal.approvals.approveByToken, {
        token: await approveLinkToken(postId, 'skipped-story-token'),
      }),
    ).toMatchObject({ ok: false, message: expect.stringContaining('This story was skipped') })
    await user.mutation(api.runs.undoSkipStory, { storyId })
    expect((await user.query(api.automations.dashboard, {}))?.drafts).toHaveLength(1)
    expect(await t.mutation(internal.approvals.claimApproval, { postId })).toBe('claimed')
  })

  it('keeps reasons private on shared runs and saves them for the owner', async () => {
    const t = convexTest(schema, modules)
    const { user, storyId, post } = await reviewFixture(t)
    await user.mutation(api.runs.skipStory, { storyId, reason: 'An internal editorial preference' })
    const token = await user.mutation(api.runs.share, { runId: post.runId })
    expect((await user.query(api.runs.get, { runId: post.runId }))?.stories[0].review?.reason).toBe(
      'An internal editorial preference',
    )
    expect((await t.query(api.runs.shared, { token }))?.stories[0].review).toBeNull()
  })

  it('refuses another account, signed-out requests, unfinished runs, and empty feedback', async () => {
    const t = convexTest(schema, modules)
    const { user, storyId, post } = await reviewFixture(t)
    const { userId } = await seed(t)
    const other = t.withIdentity({ subject: `${userId}|session` })
    for (const [client, message] of [
      [other, 'Automation not found'],
      [t, 'Not signed in'],
    ] as const) {
      await expect(
        client.mutation(api.runs.skipStory, { storyId, reason: 'Off topic' }),
      ).rejects.toThrow(message)
      await expect(
        client.mutation(api.runs.applyStoryRule, { storyId, rule: 'Skip rumours.' }),
      ).rejects.toThrow(message)
      await expect(client.mutation(api.runs.undoSkipStory, { storyId })).rejects.toThrow(message)
    }
    await expect(user.mutation(api.runs.skipStory, { storyId, reason: ' ' })).rejects.toThrow(
      'Give a reason',
    )
    await t.run((ctx) => ctx.db.patch(post.runId, { finishedAt: undefined }))
    await expect(
      user.mutation(api.runs.skipStory, { storyId, reason: 'Off topic' }),
    ).rejects.toThrow('Wait for this run')
  })

  it('does not race an approval already in flight', async () => {
    const t = convexTest(schema, modules)
    const { user, postId, storyId } = await reviewFixture(t)
    await t.mutation(internal.approvals.claimApproval, { postId })
    await expect(
      user.mutation(api.runs.skipStory, { storyId, reason: 'Off topic' }),
    ).rejects.toThrow('being approved')
    expect((await t.run((ctx) => ctx.db.get(storyId)))?.review).toBeUndefined()
  })

  it('adds the reviewed rule to the latest playbook only once and keeps it after undo', async () => {
    const t = convexTest(schema, modules)
    const { user, storyId, post } = await reviewFixture(t)
    const playbook = {
      name: 'F1',
      about: 'F1 news',
      sources: [],
      searchQueries: [],
      freshnessHours: 48,
      include: [],
      exclude: [],
      voice: { tone: 'Plain', notes: '', avoidSaying: [], emoji: 'none', hashtags: 'none' },
      formats: [],
    }
    await t.mutation(internal.automations.storeGenerated, {
      automationId: post.automationId,
      playbook,
    })
    await expect(
      user.mutation(api.runs.applyStoryRule, { storyId, rule: 'Skip promotions.' }),
    ).rejects.toThrow('Skip this story')
    await user.mutation(api.runs.skipStory, { storyId, reason: 'Too promotional' })
    await user.mutation(api.automations.addExcludeRule, {
      id: post.automationId,
      rule: 'Skip rumours.',
    })
    const version = await user.mutation(api.runs.applyStoryRule, {
      storyId,
      rule: 'Skip promotions.',
    })
    expect(version).toBe(3)
    expect(
      await user.mutation(api.runs.applyStoryRule, { storyId, rule: 'Skip promotions.' }),
    ).toBe(3)
    const saved = await t.run(async (ctx) => {
      const automation = await ctx.db.get(post.automationId)
      return await ctx.db.get(automation!.playbookVersionId!)
    })
    expect(saved?.playbook.exclude).toEqual(['Skip rumours.', 'Skip promotions.'])
    expect(await t.run((ctx) => ctx.db.query('playbookVersions').collect())).toHaveLength(3)
    await user.mutation(api.runs.undoSkipStory, { storyId })
    expect(await t.run((ctx) => ctx.db.get(saved!._id))).toEqual(saved)
  })
})

async function storyFor(
  t: ReturnType<typeof convexTest>,
  automationId: Id<'automations'>,
  runId: Id<'runs'>,
) {
  return await t.run((ctx) =>
    ctx.db.insert('stories', {
      automationId,
      runId,
      title: 't',
      canonicalUrl: `https://e.com/${runId}`,
      source: 'e.com',
      publishedAt: '',
      summary: '',
      whyItMatters: '',
      keyFacts: [],
      confidence: 1,
      decision: 'kept',
      reason: '',
      createdAt: 0,
    }),
  )
}

describe('a scheduled run while another is still going', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is skipped, and goes ahead once the earlier run has finished', async () => {
    vi.stubEnv('SIGNUP_OPEN', 'true')
    const t = convexTest(schema, modules)
    const { userId, automationId } = await seed(t)
    const going = await run(t, userId, automationId, 'now')
    const runs = () =>
      t.run((ctx) =>
        ctx.db
          .query('runs')
          .withIndex('by_automation_startedAt', (q) => q.eq('automationId', automationId))
          .collect(),
      )
    await t.mutation(internal.runs.start, { automationId })
    expect((await runs()).length).toBe(1)
    await t.run((ctx) => ctx.db.patch(going, { finishedAt: Date.now(), status: 'done' }))
    await t.mutation(internal.runs.start, { automationId })
    expect((await runs()).length).toBe(2)
  })
})

describe('posts a run left behind', () => {
  it('fails a post stuck in publishing and retries a run whose held posts never went', async () => {
    const t = convexTest(schema, modules)
    const { userId, automationId } = await seed(t)
    const stuckRun = await run(t, userId, automationId, 'now')
    const heldRun = await run(t, userId, automationId, 'now')
    const stuckStory = await storyFor(t, automationId, stuckRun)
    const heldStory = await storyFor(t, automationId, heldRun)
    const [stuck, held] = await t.run(async (ctx) => {
      const base = { userId, automationId, channelId: 'c1', service: 'twitter', text: 'x' }
      return [
        await ctx.db.insert('posts', {
          ...base,
          runId: stuckRun,
          storyId: stuckStory,
          status: 'publishing',
          createdAt: Date.now() - 20 * 60_000,
        }),
        await ctx.db.insert('posts', {
          ...base,
          runId: heldRun,
          storyId: heldStory,
          status: 'held',
          createdAt: Date.now() - 3 * 3_600_000,
        }),
      ]
    })
    await t.action(internal.runs.sweepAbandoned, {})
    expect(await t.run((ctx) => ctx.db.get(stuck))).toMatchObject({
      status: 'failed',
      reason: expect.stringMatching(/Check Buffer/),
    })
    expect((await t.run((ctx) => ctx.db.get(held)))?.status).toBe('held')
    const booked = () =>
      t.run(async (ctx) =>
        (await ctx.db.system.query('_scheduled_functions').collect()).filter(
          (f) => f.name === 'runs:sendHeld',
        ),
      )
    expect(await booked()).toHaveLength(1)
    expect((await t.run((ctx) => ctx.db.get(heldRun)))?.heldRetryAt).toBeDefined()
    // The next sweep sees the booking and leaves the run alone, so sends never pile up.
    await t.action(internal.runs.sweepAbandoned, {})
    expect(await booked()).toHaveLength(1)
  })

  it('leaves a held run alone while its send is booked for the share to reset', async () => {
    const t = convexTest(schema, modules)
    const { userId, automationId } = await seed(t)
    const runId = await run(t, userId, automationId, 'now')
    const storyId = await storyFor(t, automationId, runId)
    await t.run(async (ctx) => {
      await ctx.db.patch(runId, { heldRetryAt: Date.now() + 20 * 3_600_000 })
      await ctx.db.insert('posts', {
        userId,
        automationId,
        runId,
        storyId,
        channelId: 'c1',
        service: 'twitter',
        text: 'x',
        status: 'held',
        createdAt: Date.now() - 5 * 3_600_000,
      })
    })
    await t.action(internal.runs.sweepAbandoned, {})
    const scheduled = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())
    expect(scheduled.some((f) => f.name === 'runs:sendHeld')).toBe(false)
  })

  it('lets only one send claim a held post', async () => {
    const t = convexTest(schema, modules)
    const { userId, automationId } = await seed(t)
    const runId = await run(t, userId, automationId, 'now')
    const storyId = await storyFor(t, automationId, runId)
    const postId = await t.run((ctx) =>
      ctx.db.insert('posts', {
        userId,
        automationId,
        runId,
        storyId,
        channelId: 'c1',
        service: 'twitter',
        text: 'x',
        status: 'held',
        createdAt: Date.now(),
      }),
    )
    expect(await t.mutation(internal.runs.claimHeld, { postId })).toBe(true)
    expect(await t.mutation(internal.runs.claimHeld, { postId })).toBe(false)
    expect((await t.run((ctx) => ctx.db.get(postId)))?.status).toBe('publishing')
  })

  it('held posts are skipped when the automation was paused in the meantime', async () => {
    const t = convexTest(schema, modules)
    const { userId, automationId } = await seed(t)
    const runId = await run(t, userId, automationId, 'now')
    const storyId = await storyFor(t, automationId, runId)
    const postId = await t.run(async (ctx) => {
      await ctx.db.patch(automationId, { status: 'paused' })
      return await ctx.db.insert('posts', {
        userId,
        automationId,
        runId,
        storyId,
        channelId: 'c1',
        service: 'twitter',
        text: 'x',
        status: 'held',
        createdAt: Date.now(),
      })
    })
    await t.action(internal.runs.sendHeld, { runId })
    expect(await t.run((ctx) => ctx.db.get(postId))).toMatchObject({
      status: 'skipped',
      reason: expect.stringMatching(/paused/),
    })
  })

  it('held posts for a story skipped on the run page stay out of Buffer', async () => {
    const t = convexTest(schema, modules)
    const { userId, automationId } = await seed(t)
    const runId = await run(t, userId, automationId, 'now')
    const storyId = await storyFor(t, automationId, runId)
    const postId = await t.run((ctx) =>
      ctx.db.insert('posts', {
        userId,
        automationId,
        runId,
        storyId,
        channelId: 'c1',
        service: 'twitter',
        text: 'x',
        status: 'held',
        reviewSkipped: true,
        createdAt: Date.now(),
      }),
    )
    await t.action(internal.runs.sendHeld, { runId })
    expect(await t.run((ctx) => ctx.db.get(postId))).toMatchObject({
      status: 'skipped',
      reason: expect.stringMatching(/skipped this story/),
    })
  })
})

describe('an old approve link', () => {
  it('no longer approves after thirty days, and says so', async () => {
    const t = convexTest(schema, modules)
    const { userId, automationId } = await seed(t)
    const runId = await run(t, userId, automationId, 'now')
    const storyId = await storyFor(t, automationId, runId)
    const postId = await t.run((ctx) =>
      ctx.db.insert('posts', {
        userId,
        automationId,
        runId,
        storyId,
        channelId: 'c1',
        service: 'twitter',
        text: 'x',
        status: 'draft',
        bufferPostId: 'b-old',
        approveToken: 'tok-old',
        createdAt: Date.now() - 31 * 86_400_000,
      }),
    )
    vi.stubEnv('TOKEN_ENC_KEY', btoa('n'.repeat(32)))
    const link = await approveLinkToken(postId, 'tok-old')
    const res = await t.fetch(`/approve?token=${encodeURIComponent(link)}`, { method: 'POST' })
    expect(res.status).toBe(410)
    expect(await res.text()).toContain('expired')
  })
})

/** Inserts a post for the seeded automation's run, with only what each case sets. */
async function postsFixture() {
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
  const post = (fields: Partial<Doc<'posts'>> & { status: string; createdAt: number }) =>
    t.run((ctx) =>
      ctx.db.insert('posts', {
        userId,
        automationId,
        runId,
        storyId,
        channelId: 'c1',
        service: 'twitter',
        text: 'hello',
        ...fields,
      }),
    )
  return { t, userId, automationId, runId, storyId, post }
}

describe('reading posts by index', () => {
  it('checks every open post in Buffer from the last 8 days, and nothing else', async () => {
    const { t, userId, post } = await postsFixture()
    const now = Date.now()
    const DAY = 86_400_000
    await t.run((ctx) =>
      ctx.db.insert('bufferChannels', {
        userId,
        organizationId: 'o1',
        channelId: 'c1',
        service: 'twitter',
        name: 'GPP',
        usable: true,
        syncedAt: now,
      }),
    )
    // Out of creation order across statuses, to show the order is kept as a createdAt scan's.
    await post({ status: 'scheduled', bufferPostId: 'b-scheduled', createdAt: now - 3 * DAY })
    await post({ status: 'draft', bufferPostId: 'b-draft', createdAt: now - 7 * DAY })
    await post({ status: 'queued', bufferPostId: 'b-queued', createdAt: now - DAY })
    for (const status of ['sent', 'failed', 'deleted'])
      await post({ status, bufferPostId: `b-${status}`, createdAt: now - DAY })
    await post({ status: 'held', createdAt: now - DAY })
    await post({ status: 'draft', createdAt: now - DAY })
    await post({ status: 'draft', bufferPostId: 'b-old', createdAt: now - 9 * DAY })
    const pending = await t.query(internal.status.pending, { now })
    expect(pending).toHaveLength(1)
    expect(pending[0]!.orgs[0]!.expected).toEqual(['b-draft', 'b-scheduled', 'b-queued'])
  })

  it('asks for metrics on sent posts only, from a day to 14 days after they went out', async () => {
    const { t, post } = await postsFixture()
    const now = Date.now()
    const DAY = 86_400_000
    const want = await post({
      status: 'sent',
      bufferPostId: 'b-want',
      sentAt: now - 2 * DAY,
      createdAt: now - 3 * DAY,
    })
    await post({ status: 'sent', bufferPostId: 'b-new', sentAt: now - 1000, createdAt: now - DAY })
    await post({
      status: 'sent',
      bufferPostId: 'b-fresh',
      sentAt: now - 2 * DAY,
      metricsUpdatedAt: now - 1000,
      createdAt: now - 3 * DAY,
    })
    await post({
      status: 'sent',
      bufferPostId: 'b-stale',
      sentAt: now - 20 * DAY,
      createdAt: now - 20 * DAY,
    })
    await post({ status: 'sent', sentAt: now - 2 * DAY, createdAt: now - 3 * DAY })
    await post({
      status: 'failed',
      bufferPostId: 'b-failed',
      sentAt: now - 2 * DAY,
      createdAt: now - 3 * DAY,
    })
    expect(await t.query(internal.status.wantingMetrics, {})).toEqual([
      expect.objectContaining({ postId: want, bufferPostId: 'b-want' }),
    ])
  })

  it("gives the writer only this automation's measured posts", async () => {
    const { t, userId, automationId, post } = await postsFixture()
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
    const runId = await t.run((ctx) =>
      ctx.db.insert('runs', {
        userId,
        automationId,
        playbookVersionId: versionId,
        kind: 'now',
        status: 'researching',
        startedAt: Date.now(),
        steps: [],
        usage: EMPTY,
        costUsd: 0,
      }),
    )
    const otherId = await t.run(async (ctx) => {
      const a = (await ctx.db.get(automationId))!
      const { _id, _creationTime, ...rest } = a
      return await ctx.db.insert('automations', { ...rest, name: 'Other' })
    })
    const metrics = [{ type: 'likes', value: 5, unit: 'count' }]
    for (const i of [1, 2, 3])
      await post({ status: 'sent', text: `mine ${i}`, metrics, createdAt: Date.now() - 1000 })
    await post({
      status: 'sent',
      text: 'old',
      metrics: [{ type: 'likes', value: 99, unit: 'count' }],
      createdAt: Date.now() - 91 * 86_400_000,
    })
    for (const i of [1, 2, 3])
      await post({
        status: 'sent',
        automationId: otherId,
        text: `theirs ${i}`,
        metrics: [{ type: 'likes', value: 50, unit: 'count' }],
        createdAt: Date.now() - 1000,
      })
    const loaded = await t.query(internal.runs.load, { runId })
    expect(loaded?.proven.map((p) => p.text).sort()).toEqual(['mine 1', 'mine 2', 'mine 3'])
  })
})

describe('a story none of whose posts reached Buffer', () => {
  it('is not counted as covered, so a later run may try it again', async () => {
    const t = convexTest(schema, modules)
    const { userId, automationId } = await seed(t)
    const runId = await run(t, userId, automationId, 'now')
    const story = (url: string) =>
      t.run((ctx) =>
        ctx.db.insert('stories', {
          automationId,
          runId,
          title: url,
          canonicalUrl: url,
          source: 'e.com',
          publishedAt: '',
          summary: '',
          whyItMatters: '',
          keyFacts: [],
          confidence: 1,
          decision: 'kept',
          reason: '',
          createdAt: 0,
        }),
      )
    const [rejected, queued, maybe, none] = [
      await story('https://e.com/rejected'),
      await story('https://e.com/queued'),
      await story('https://e.com/maybe'),
      await story('https://e.com/none'),
    ]
    await t.run(async (ctx) => {
      const base = { userId, automationId, runId, channelId: 'c1', service: 'twitter', text: 'x' }
      await ctx.db.insert('posts', { ...base, storyId: rejected, status: 'rejected', createdAt: 0 })
      await ctx.db.insert('posts', {
        ...base,
        storyId: queued,
        status: 'queued',
        bufferPostId: 'b1',
        createdAt: 0,
      })
      await ctx.db.insert('posts', {
        ...base,
        storyId: maybe,
        status: 'failed',
        reason:
          'Buffer did not answer while this post was being sent. Check Buffer before sending it again.',
        createdAt: 0,
      })
    })
    await t.mutation(internal.runs.finish, { runId, status: 'done', note: 'Done.' })
    const flags = await t.run(async (ctx) =>
      Promise.all(
        [rejected, queued, maybe, none].map(
          async (id) => (await ctx.db.get(id))?.notPosted ?? false,
        ),
      ),
    )
    expect(flags).toEqual([true, false, false, true])
  })
})
