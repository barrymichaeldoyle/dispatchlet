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
    eventDate: null as string | null,
    forDate: null as string | null,
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
type Queue = { id: string; timezone: string; days: { day: string; times: string[] }[] }
function stubServices(found: number | ReturnType<typeof candidates>, queues: Queue[] = []) {
  const writePrompts: string[] = []
  const researchSystems: string[] = []
  const researchPrompts: string[] = []
  const created: { channelId: string; dueAt: string | undefined; mode: string }[] = []
  const approved: { mode: string; dueAt: string | undefined; text?: string }[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const body = JSON.parse(
      String(init?.body ?? (input instanceof Request ? await input.text() : '{}')),
    )
    if (url.includes('anthropic')) {
      const text = JSON.stringify(body)
      if (text.includes('research step')) {
        researchSystems.push(JSON.stringify(body.system))
        researchPrompts.push(JSON.stringify(body.messages))
        return anthropicReply({
          candidates: typeof found === 'number' ? candidates(found) : found,
          searchesRun: [],
          notes: '',
        })
      }
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
    if (String(body.query).includes('DispatchletQueues'))
      return Response.json({
        data: {
          channels: queues.map((q) => ({
            id: q.id,
            timezone: q.timezone,
            isQueuePaused: false,
            postingSchedule: q.days.map((d) => ({ ...d, paused: false })),
          })),
        },
      })
    if (String(body.query).includes('DispatchletApprove')) {
      const edit = body.variables.input
      approved.push({ mode: edit.mode, dueAt: edit.dueAt, text: edit.text })
      return Response.json({
        data: {
          editPost: {
            __typename: 'PostActionSuccess',
            post: { id: 'b-1', status: 'scheduled', dueAt: edit.dueAt ?? null },
          },
        },
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
  return { writePrompts, created, researchSystems, researchPrompts, approved }
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

describe('history and on-this-day research', () => {
  it('keeps an old documented story and drops one without a verified date', async () => {
    const t = convexTest(schema, modules)
    const { runId, automationId } = await seed(t)
    await t.run((ctx) => ctx.db.patch(automationId, { researchMode: 'archive', maxPostsPerRun: 2 }))
    const [a, b, c] = candidates(3)
    const { researchSystems, writePrompts } = stubServices([
      { ...a!, publishedAt: '1976-10-25', eventDate: '1976-10-24' },
      { ...b!, publishedAt: '1988-11-14' },
      { ...c!, publishedAt: '2001-03-04', eventDate: '2001-03-04' },
    ])
    await t.action(internal.runs.execute, { runId })
    expect(researchSystems[0]).toContain('When the source was published does not matter')
    const stories = await t.run((ctx) =>
      ctx.db
        .query('stories')
        .withIndex('by_run', (q) => q.eq('runId', runId))
        .collect(),
    )
    expect(stories.find((s) => s.title === a!.title)).toMatchObject({
      decision: 'kept',
      eventDate: '1976-10-24',
    })
    expect(stories.find((s) => s.title === b!.title)).toMatchObject({
      decision: 'skipped_quality',
      reason: expect.stringMatching(/No verified date/),
    })
    expect(stories.find((s) => s.title === c!.title)?.decision).toBe('kept')
    expect(writePrompts[0]).toContain('event date: 1976-10-24')
    expect(writePrompts[0]).toContain('never present them as new')
  })

  it('posts each anniversary on its own date and leaves undocumented days empty', async () => {
    const t = convexTest(schema, modules)
    const { runId, automationId } = await seed(t)
    await t.run((ctx) => ctx.db.patch(automationId, { researchMode: 'anniversary' }))
    const slots = planSlots(everyDay, ZONE, MONDAY_RUN)
    const [a, b, c, d, e] = candidates(5)
    const { writePrompts } = stubServices([
      // Best first: a Thursday anniversary, then Monday, a wrong date, a second Thursday,
      // and one with no exact day.
      { ...a!, eventDate: '1976-11-19', forDate: '2026-11-19' },
      { ...b!, eventDate: '1996-11-16', forDate: '2026-11-16' },
      { ...c!, eventDate: '1990-11-20', forDate: '2026-11-21' },
      { ...d!, eventDate: '1983-11-19', forDate: '2026-11-19' },
      { ...e!, eventDate: '1991-11', forDate: '2026-11-17' },
    ])
    await t.action(internal.runs.execute, { runId })
    const stories = await t.run((ctx) =>
      ctx.db
        .query('stories')
        .withIndex('by_run', (q) => q.eq('runId', runId))
        .collect(),
    )
    const decision = (title: string) => stories.find((s) => s.title === title)
    expect(decision(a!.title)?.decision).toBe('kept')
    expect(decision(b!.title)?.decision).toBe('kept')
    expect(decision(c!.title)?.reason).toMatch(/same day of the year/)
    expect(decision(d!.title)).toMatchObject({
      decision: 'skipped_limit',
      reason: 'Another story is already planned for 2026-11-19.',
    })
    expect(decision(e!.title)?.reason).toMatch(/exact day/)
    const scheduled = (await postsOf(t, runId)).filter((p) => p.status === 'scheduled')
    // Thursday's event goes out on Thursday even though it ranked first.
    const at = (title: string) =>
      new Set(scheduled.filter((p) => p.storyId === decision(title)!._id).map((p) => p.dueAt))
    expect(at(a!.title)).toEqual(new Set([slots[3]]))
    expect(at(b!.title)).toEqual(new Set([slots[0]]))
    expect(scheduled).toHaveLength(4)
    expect(writePrompts.join('\n')).toContain(
      'anniversary: posted on 2026-11-19, 50 years after the event.',
    )
    const note = (await t.run((ctx) => ctx.db.get(runId)))?.steps.at(-1)?.note
    expect(note).toContain(
      'Research found 2 stories good enough for 7 planned, so 5 days have no post.',
    )
  })

  it('keeps the recent-news prompt and ignores stray event dates for recent research', async () => {
    const t = convexTest(schema, modules)
    const { runId } = await seed(t)
    const [a] = candidates(1)
    const { researchSystems, writePrompts } = stubServices([{ ...a!, eventDate: '1950-01-01' }])
    await t.action(internal.runs.execute, { runId })
    expect(researchSystems[0]).toContain('inside the freshness window')
    expect(writePrompts[0]).not.toContain('event date')
    const [story] = await t.run((ctx) =>
      ctx.db
        .query('stories')
        .withIndex('by_run', (q) => q.eq('runId', runId))
        .collect(),
    )
    expect(story?.eventDate).toBeUndefined()
  })
})

describe('on this day without a publication plan', () => {
  // Monday 16 November 2026, 20:00 in Johannesburg: tomorrow's queue times are the next ones.
  const MONDAY_EVENING = Date.parse('2026-11-16T18:00:00Z')
  const daily = { preset: 'daily' as const, time: '20:00', weekday: null }
  const tuesdayQueue: Queue = {
    id: 'c1',
    timezone: ZONE,
    days: WEEKDAYS.map((day) => ({ day, times: day === 'tue' ? ['11:39', '08:57'] : ['10:00'] })),
  }
  const asQueueAutomation = (
    t: TestConvex<typeof schema>,
    automationId: Id<'automations'>,
    postingMode: 'queue' | 'draft',
    cadence: typeof daily | typeof weekly = daily,
  ) =>
    t.run((ctx) =>
      ctx.db.patch(automationId, {
        researchMode: 'anniversary',
        postingMode,
        publicationPlan: undefined,
        cadence,
        maxPostsPerRun: 3,
      }),
    )

  it('researches the next posting date and schedules each post at that day’s queue time', async () => {
    vi.setSystemTime(MONDAY_EVENING)
    const t = convexTest(schema, modules)
    const { runId, automationId } = await seed(t)
    await asQueueAutomation(t, automationId, 'queue')
    const [a, b] = candidates(2)
    const { created, researchPrompts } = stubServices(
      [
        { ...a!, eventDate: '1985-11-17', forDate: '2026-11-17' },
        // Today's anniversary: its queue times have passed, so it is not this run's to post.
        { ...b!, eventDate: '1985-11-16', forDate: '2026-11-16' },
      ],
      [tuesdayQueue],
    )
    await t.action(internal.runs.execute, { runId })
    expect(researchPrompts[0]).toContain('2026-11-17')
    expect(researchPrompts[0]).not.toContain('2026-11-16:')
    const run = await t.run((ctx) => ctx.db.get(runId))
    expect(run?.steps.find((s) => s.step === 'plan')?.note).toContain(
      'looking for anniversaries on Tue 17 Nov',
    )
    // c1 uses its first Tuesday queue time; c2's queue is unknown, so the first fallback time.
    expect(created.map((c) => [c.channelId, c.mode, c.dueAt])).toEqual([
      ['c1', 'customScheduled', '2026-11-17T06:57:00.000Z'],
      ['c2', 'customScheduled', '2026-11-17T07:00:00.000Z'],
    ])
    const posts = await postsOf(t, runId)
    expect(posts.every((p) => p.status === 'scheduled' && p.plannedFor)).toBe(true)
  })

  it('spreads a weekly run’s anniversaries over their own dates, two on one day at separate times', async () => {
    const t = convexTest(schema, modules)
    const { runId, automationId } = await seed(t)
    await asQueueAutomation(t, automationId, 'queue', weekly)
    const [a, b, c] = candidates(3)
    const { created } = stubServices(
      [
        { ...a!, eventDate: '1976-11-21', forDate: '2026-11-21' },
        { ...b!, eventDate: '1991-11-18', forDate: '2026-11-18' },
        { ...c!, eventDate: '2001-11-18', forDate: '2026-11-18' },
      ],
      [tuesdayQueue],
    )
    await t.action(internal.runs.execute, { runId })
    const c1 = created.filter((p) => p.channelId === 'c1').map((p) => p.dueAt)
    // c1 posts once on Wednesday (10:00), so the second Wednesday story is not doubled up there.
    // c2 has no known queue, so its fallback times give each Wednesday story its own time.
    expect(c1).toEqual(['2026-11-21T08:00:00.000Z', '2026-11-18T08:00:00.000Z'])
    const c2 = created.filter((p) => p.channelId === 'c2').map((p) => p.dueAt)
    expect(c2).toEqual([
      '2026-11-21T07:00:00.000Z',
      '2026-11-18T07:00:00.000Z',
      '2026-11-18T10:00:00.000Z',
    ])
    const skipped = (await postsOf(t, runId)).filter((p) => p.status === 'skipped')
    expect(skipped).toHaveLength(1)
    expect(skipped[0]!.reason).toBe(
      'Its date, Wed 18 Nov, has no posting time left on c1, so it was not posted late.',
    )
  })

  it('keeps a draft’s date: approving schedules it for then, approving too late is refused', async () => {
    vi.setSystemTime(MONDAY_EVENING)
    const t = convexTest(schema, modules)
    const { runId, automationId, userId } = await seed(t)
    await asQueueAutomation(t, automationId, 'draft')
    const [a] = candidates(1)
    const { created, approved } = stubServices(
      [{ ...a!, eventDate: '1985-11-17', forDate: '2026-11-17' }],
      [tuesdayQueue],
    )
    await t.action(internal.runs.execute, { runId })
    expect(created.every((p) => p.mode === 'addToQueue')).toBe(true)
    const [first, second] = await postsOf(t, runId)
    expect(first).toMatchObject({ status: 'draft', plannedFor: Date.parse('2026-11-17T06:57:00Z') })
    await t.action(internal.approvals.approveForUser, { userId, postId: first!._id })
    expect(approved).toEqual([
      {
        mode: 'customScheduled',
        dueAt: '2026-11-17T06:57:00.000Z',
        text: 'A short factual post.\n\nhttps://news0.example.com/story-0',
      },
    ])
    expect((await t.run((ctx) => ctx.db.get(first!._id)))?.status).toBe('scheduled')
    vi.setSystemTime(Date.parse('2026-11-17T08:00:00Z'))
    await expect(
      t.action(internal.approvals.approveForUser, { userId, postId: second!._id }),
    ).rejects.toThrow(/date that has passed/)
    expect((await t.run((ctx) => ctx.db.get(second!._id)))?.status).toBe('draft')
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
