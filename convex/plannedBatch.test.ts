import { convexTest, type TestConvex } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { planNote } from './runs'
import { renderPlaybook, type Playbook } from './lib/playbook'
import { planSlots, WEEKDAYS } from './lib/plan'
import schema from './schema'

const modules = import.meta.glob('./**/*.*s')
const ZONE = 'Africa/Johannesburg'
const weekly = { preset: 'weekly' as const, time: '07:00', weekday: 'mon' }
const everyDay = { time: '09:00', weekdays: [...WEEKDAYS] }
// Monday 16 November 2026, 07:00 in Johannesburg.
const MONDAY_RUN = Date.parse('2026-11-16T05:00:00Z')
const playbook: Playbook = {
  name: 'F1 weekly',
  about: 'Formula 1.',
  sources: [],
  searchQueries: [],
  freshnessHours: 192,
  include: [],
  exclude: [],
  formats: [],
  voice: { tone: 'Plain.', notes: '', avoidSaying: [], emoji: 'none', hashtags: 'none' },
}
const EMPTY = {
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  webSearches: 0,
  webFetches: 0,
}
const TOPICS = [
  'Verstappen wins in Brazil',
  'Ferrari confirms new technical director',
  'Williams tests revised floor at Silverstone',
  'Alpine names reserve driver for 2027',
  'Stewards fine McLaren over unsafe release',
  'Aston Martin opens new wind tunnel',
  'Sauber reveals Audi livery date',
  'Haas extends partnership with Toyota',
  'Mercedes promotes junior to simulator role',
]

function candidates(n: number) {
  return TOPICS.slice(0, n).map((title, i) => ({
    title,
    canonicalUrl: `https://news${i}.example.com/story-${i}`,
    source: `news${i}.example.com`,
    publishedAt: '2026-11-15',
    summary: `${title}.`,
    whyItMatters: 'Fans care.',
    confidence: 0.9 - i * 0.01,
    keyFacts: [title],
  }))
}

function anthropicReply(json: unknown) {
  return Response.json({
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content: [{ type: 'text', text: JSON.stringify(json) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 100 },
  })
}

/** Routes the run's outbound calls: research and writing to "Anthropic", posts to "Buffer". */
function stubServices(found: number) {
  const writePrompts: string[] = []
  const created: { channelId: string; dueAt: string | undefined; mode: string }[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const body = JSON.parse(
      String(init?.body ?? (input instanceof Request ? await input.text() : '{}')),
    )
    if (url.includes('anthropic')) {
      const text = JSON.stringify(body)
      if (text.includes('research step'))
        return anthropicReply({ candidates: candidates(found), searchesRun: [], notes: '' })
      const prompt = body.messages
        .map((m: { content: unknown }) => JSON.stringify(m.content))
        .join('\n')
      writePrompts.push(prompt)
      const urls = [...prompt.matchAll(/canonicalUrl: (\S+?)\\n/g)].map((m) => m[1]!)
      const channels = [...prompt.matchAll(/channelId (\S+?):/g)].map((m) => m[1]!)
      return anthropicReply({
        posts: urls.flatMap((storyUrl) =>
          channels.map((channelId) => ({
            storyUrl,
            channelId,
            text: 'A short factual post.',
            thread: null,
            linkAttachment: null,
          })),
        ),
      })
    }
    if (String(body.query).includes('DispatchletLimits'))
      return Response.json({ data: { dailyPostingLimits: [] } })
    if (String(body.query).includes('DispatchletCreatePost')) {
      const i = body.variables.input
      created.push({ channelId: i.channelId, dueAt: i.dueAt, mode: i.mode })
      return Response.json({
        data: {
          createPost: {
            __typename: 'PostActionSuccess',
            post: {
              id: `b-${created.length}`,
              status: 'scheduled',
              dueAt: i.dueAt ?? null,
              externalLink: null,
            },
          },
        },
      })
    }
    return Response.json({ data: {} })
  })
  vi.stubGlobal('fetch', fetch)
  return { writePrompts, created }
}

async function seed(t: TestConvex<typeof schema>, kind = 'now') {
  const { encryptSecret } = await import('./lib/crypto')
  const { saveBufferConnection } = await import('./buffer')
  const accessTokenEnc = await encryptSecret('test-access')
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', {
      email: 'a@example.com',
      emailPrefs: 'never',
      timezone: ZONE,
    })
    await saveBufferConnection(ctx, userId, {
      bufferAccountId: 'buffer-1',
      accessTokenEnc,
      expiresAt: Date.now() + 30 * 86_400_000,
      scope: 'posts:write',
    })
    const connection = await ctx.db.query('bufferConnections').first()
    await ctx.db.patch(connection!._id, { tags: [{ organizationId: 'o1', tagId: 'tag-1' }] })
    for (const channelId of ['c1', 'c2'])
      await ctx.db.insert('bufferChannels', {
        userId,
        organizationId: 'o1',
        channelId,
        service: 'twitter',
        name: channelId,
        usable: true,
        syncedAt: Date.now(),
      })
    const automationId = await ctx.db.insert('automations', {
      userId,
      name: 'F1 weekly',
      status: 'active',
      setup: {
        research: 'F1',
        services: ['twitter'],
        avoid: '',
        sources: [],
        onlyTheseSources: false,
        cadence: weekly,
        maxStories: 3,
        postingMode: 'queue',
      },
      channelIds: ['c1', 'c2'],
      cadence: weekly,
      timezone: ZONE,
      postingMode: 'planned',
      publicationPlan: everyDay,
      maxPostsPerRun: 7,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    const playbookVersionId = await ctx.db.insert('playbookVersions', {
      automationId,
      version: 1,
      text: renderPlaybook(playbook),
      playbook,
      createdBy: 'user',
      createdAt: Date.now(),
    })
    await ctx.db.patch(automationId, { playbookVersionId })
    const runId = await ctx.db.insert('runs', {
      userId,
      automationId,
      playbookVersionId,
      kind,
      status: 'researching',
      startedAt: Date.now(),
      steps: [],
      usage: EMPTY,
      costUsd: 0,
    })
    return { userId, automationId, runId }
  })
}

const postsOf = (t: TestConvex<typeof schema>, runId: Id<'runs'>) =>
  t.run((ctx) =>
    ctx.db
      .query('posts')
      .withIndex('by_run', (q) => q.eq('runId', runId))
      .collect(),
  )
const local = (at: number) =>
  new Date(at).toLocaleString('en-GB', {
    timeZone: ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(MONDAY_RUN)
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
  vi.stubEnv('GLOBAL_DAILY_USD_CAP', '100')
  vi.stubEnv('TOKEN_ENC_KEY', btoa('n'.repeat(32)))
  vi.stubEnv('SERVER_EVENTS', 'off')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('a planned weekly batch', () => {
  it('schedules seven distinct stories, one a day, on every selected channel', async () => {
    const t = convexTest(schema, modules)
    const { runId } = await seed(t)
    const { writePrompts, created } = stubServices(9)
    await t.action(internal.runs.execute, { runId })

    const posts = await postsOf(t, runId)
    const scheduled = posts.filter((p) => p.status === 'scheduled')
    expect(scheduled).toHaveLength(14)
    expect(created.every((c) => c.mode === 'customScheduled')).toBe(true)
    const slots = planSlots(everyDay, ZONE, MONDAY_RUN)
    // Each day has exactly one story, posted on both channels at the same time.
    for (const slot of slots) {
      const onSlot = scheduled.filter((p) => p.dueAt === slot)
      expect(onSlot.map((p) => p.channelId).sort()).toEqual(['c1', 'c2'])
      expect(new Set(onSlot.map((p) => p.storyId)).size).toBe(1)
      expect(onSlot.every((p) => p.plannedFor === slot)).toBe(true)
    }
    expect(new Set(scheduled.map((p) => p.storyId)).size).toBe(7)
    expect(scheduled.map((p) => local(p.dueAt!))).toContain('Mon 09:00')
    expect(scheduled.map((p) => local(p.dueAt!))).toContain('Sun 09:00')
    // Seven stories are written three at a time, each told its own posting date.
    expect(writePrompts).toHaveLength(3)
    expect(writePrompts[0]).toContain('posts on: Monday, 16 November 2026 at 09:00')
    expect(writePrompts[0]).toContain('scheduled ahead')

    const run = await t.run((ctx) => ctx.db.get(runId))
    expect(run?.status).toBe('done')
    expect(run?.kept).toBe(7)
    expect(
      run?.steps.some((s) => s.step === 'plan' && s.note.includes('7 open posting days')),
    ).toBe(true)
    expect(run?.steps.at(-1)?.note).toMatch(/^Done\. 14 posts in Buffer, for Mon 16 Nov, 09:00;/)
  })

  it('skips days already taken by an earlier batch and says when research falls short', async () => {
    const t = convexTest(schema, modules)
    const { runId, userId, automationId } = await seed(t)
    const slots = planSlots(everyDay, ZONE, MONDAY_RUN)
    await t.run(async (ctx) => {
      const earlier = await ctx.db.insert('runs', {
        userId,
        automationId,
        kind: 'scheduled',
        status: 'done',
        startedAt: MONDAY_RUN - 86_400_000,
        steps: [],
        usage: EMPTY,
        costUsd: 0,
      })
      const storyId = await ctx.db.insert('stories', {
        automationId,
        runId: earlier,
        title: 'Earlier',
        canonicalUrl: 'https://old.example.com/a',
        source: 'old',
        publishedAt: '2026-11-10',
        summary: '',
        whyItMatters: '',
        keyFacts: [],
        confidence: 1,
        decision: 'kept',
        reason: '',
        createdAt: 0,
      })
      await ctx.db.insert('posts', {
        userId,
        automationId,
        runId: earlier,
        storyId,
        channelId: 'c1',
        service: 'twitter',
        text: 'x',
        status: 'scheduled',
        dueAt: slots[1],
        plannedFor: slots[1],
        createdAt: 0,
      })
    })
    stubServices(4)
    await t.action(internal.runs.execute, { runId })
    const scheduled = (await postsOf(t, runId)).filter((p) => p.status === 'scheduled')
    expect(scheduled).toHaveLength(8)
    expect(scheduled.some((p) => p.plannedFor === slots[1])).toBe(false)
    // Best stories go first: Monday, then Wednesday (Tuesday is taken), Thursday, Friday.
    expect([...new Set(scheduled.map((p) => p.plannedFor))].sort()).toEqual([
      slots[0],
      slots[2],
      slots[3],
      slots[4],
    ])
    const note = (await t.run((ctx) => ctx.db.get(runId)))?.steps.at(-1)?.note
    expect(note).toContain(
      'Research found 4 stories good enough for 6 planned, so 2 days have no post.',
    )
  })

  it('shows planned dates on a dry run without sending anything to Buffer', async () => {
    const t = convexTest(schema, modules)
    const { runId } = await seed(t, 'dry')
    const { created } = stubServices(3)
    await t.action(internal.runs.execute, { runId })
    expect(created).toHaveLength(0)
    const posts = await postsOf(t, runId)
    expect(posts.every((p) => p.status === 'dry' && p.plannedFor && !p.bufferPostId)).toBe(true)
    expect(posts).toHaveLength(6)
    const note = (await t.run((ctx) => ctx.db.get(runId)))?.steps.at(-1)?.note
    expect(note).toMatch(/^Dry run finished\. It would schedule 3 stories: Mon 16 Nov, 09:00;/)
    expect(note).toContain('Nothing went to Buffer.')
  })

  it('does not research when every posting day is already taken', async () => {
    const t = convexTest(schema, modules)
    const { runId, automationId } = await seed(t)
    await t.run((ctx) =>
      ctx.db.patch(automationId, {
        publicationPlan: { time: '09:00', weekdays: ['mon'] },
        maxPostsPerRun: 1,
      }),
    )
    // 08:45 local: Monday's 09:00 slot is too soon, and next Monday is outside the week.
    vi.setSystemTime(MONDAY_RUN + 105 * 60_000)
    await t.run((ctx) => ctx.db.patch(runId, { startedAt: Date.now() }))
    stubServices(3)
    await t.action(internal.runs.execute, { runId })
    const run = await t.run((ctx) => ctx.db.get(runId))
    expect(run?.status).toBe('skipped')
    expect(run?.steps.at(-1)?.note).toMatch(/Every posting day/)
  })

  it('does not post a held story late once its planned time has passed', async () => {
    const t = convexTest(schema, modules)
    const { runId, userId, automationId } = await seed(t)
    const slots = planSlots(everyDay, ZONE, MONDAY_RUN)
    const [late, onTime] = await t.run(async (ctx) => {
      const storyId = await ctx.db.insert('stories', {
        automationId,
        runId,
        title: 'Held',
        canonicalUrl: 'https://held.example.com/a',
        source: 'held',
        publishedAt: '2026-11-15',
        summary: '',
        whyItMatters: '',
        keyFacts: [],
        confidence: 1,
        decision: 'kept',
        reason: '',
        createdAt: 0,
      })
      const base = {
        userId,
        automationId,
        runId,
        storyId,
        channelId: 'c1',
        service: 'twitter',
        text: 'x',
        status: 'held',
        createdAt: 0,
      }
      return [
        await ctx.db.insert('posts', { ...base, plannedFor: slots[0] }),
        await ctx.db.insert('posts', { ...base, plannedFor: slots[2] }),
      ]
    })
    // Buffer was busy until Monday 10:00 local.
    vi.setSystemTime(MONDAY_RUN + 3 * 3_600_000)
    const { created } = stubServices(0)
    await t.action(internal.runs.sendHeld, { runId })
    expect(await t.run((ctx) => ctx.db.get(late))).toMatchObject({
      status: 'skipped',
      reason: expect.stringMatching(/passed while Buffer was busy/),
    })
    expect(await t.run((ctx) => ctx.db.get(onTime))).toMatchObject({
      status: 'scheduled',
      dueAt: slots[2],
    })
    expect(created).toEqual([expect.objectContaining({ dueAt: new Date(slots[2]!).toISOString() })])
  })
})

describe('planNote', () => {
  it('names an unplaced story without counting it as a short batch', () => {
    expect(
      planNote({
        dry: false,
        published: 2,
        placed: [Date.parse('2026-11-17T07:00:00Z')],
        kept: 2,
        storyLimit: 2,
        openDays: 2,
        timezone: ZONE,
      }),
    ).toBe(
      'Done. 2 posts in Buffer, for Tue 17 Nov, 09:00. 1 story had no posting day left by the time it was written.',
    )
  })
})
