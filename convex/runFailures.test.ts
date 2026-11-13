import { convexTest, type TestConvex } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withStreaming } from './lib/ai/testStream'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { bufferDidNotAnswer, onePerStoryAndChannel } from './runs'
import { BufferPostError } from './buffer'
import { BufferApiError } from './lib/buffer'
import { renderPlaybook, type Playbook } from './lib/playbook'
import schema from './schema'

const modules = import.meta.glob('./**/*.*s')
const playbook: Playbook = {
  name: 'F1',
  about: 'Formula 1.',
  sources: [],
  searchQueries: [],
  freshnessHours: 48,
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
const candidates = ['Verstappen wins in Brazil', 'Ferrari names a new technical director'].map(
  (title, i) => ({
    title,
    canonicalUrl: `https://news${i}.example.com/story-${i}`,
    source: `news${i}.example.com`,
    publishedAt: '2026-11-13',
    summary: `${title}.`,
    whyItMatters: 'Fans care.',
    confidence: 0.9,
    keyFacts: [title],
    eventDate: null,
    forDate: null,
  }),
)

function anthropicReply(text: string) {
  return Response.json({
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 100 },
  })
}

/**
 * Research finds two stories; the writer gives one post per story and channel (twice over when
 * `repeat` is set). `send` answers each createPost in turn, by its 1-based number.
 */
function stubServices(opts: {
  send?: (n: number) => Response | Promise<Response>
  repeat?: boolean
  research?: string
}) {
  const created: string[] = []
  vi.stubGlobal(
    'fetch',
    withStreaming(
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input)
        const body = JSON.parse(String(init?.body ?? '{}'))
        if (url.includes('anthropic')) {
          if (JSON.stringify(body).includes('research step'))
            return anthropicReply(
              opts.research ?? JSON.stringify({ candidates, searchesRun: [], notes: '' }),
            )
          const posts = candidates.flatMap((c) =>
            ['c1', 'c2'].map((channelId) => ({
              storyUrl: c.canonicalUrl,
              channelId,
              text: 'A short factual post.',
              thread: null,
              linkAttachment: null,
            })),
          )
          return anthropicReply(
            JSON.stringify({ posts: opts.repeat ? [...posts, ...posts] : posts }),
          )
        }
        if (String(body.query).includes('DispatchletLimits'))
          return Response.json({ data: { dailyPostingLimits: [] } })
        if (String(body.query).includes('DispatchletCreatePost')) {
          created.push(body.variables.input.channelId)
          if (opts.send) return await opts.send(created.length)
          return Response.json({
            data: {
              createPost: {
                __typename: 'PostActionSuccess',
                post: {
                  id: `b-${created.length}`,
                  status: 'buffer',
                  dueAt: null,
                  externalLink: null,
                },
              },
            },
          })
        }
        return Response.json({ data: {} })
      }),
    ),
  )
  return { created }
}

const ok = (n: number) =>
  Response.json({
    data: {
      createPost: {
        __typename: 'PostActionSuccess',
        post: { id: `b-${n}`, status: 'buffer', dueAt: null, externalLink: null },
      },
    },
  })

async function seed(t: TestConvex<typeof schema>) {
  const { encryptSecret } = await import('./lib/crypto')
  const { saveBufferConnection } = await import('./buffer')
  const accessTokenEnc = await encryptSecret('test-access')
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', {
      email: 'a@example.com',
      emailPrefs: 'never',
      freeRunsUsed: 1,
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
    const cadence = { preset: 'daily' as const, time: '08:00', weekday: null }
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
        cadence,
        maxStories: 3,
        postingMode: 'queue',
      },
      channelIds: ['c1', 'c2'],
      cadence,
      timezone: 'UTC',
      postingMode: 'queue',
      maxPostsPerRun: 3,
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
      kind: 'now',
      freeRun: true,
      status: 'researching',
      startedAt: Date.now(),
      steps: [],
      usage: EMPTY,
      costUsd: 0,
    })
    return { userId, runId }
  })
}

const postsOf = (t: TestConvex<typeof schema>, runId: Id<'runs'>) =>
  t.run((ctx) =>
    ctx.db
      .query('posts')
      .withIndex('by_run', (q) => q.eq('runId', runId))
      .collect(),
  )

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.parse('2026-11-13T09:00:00Z'))
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

describe('when Buffer stops answering part way through a run', () => {
  it.each([
    [
      'times out',
      () =>
        Promise.reject(
          new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
        ),
    ],
    ['fails with a 5xx', () => Promise.resolve(new Response('bad gateway', { status: 502 }))],
  ])(
    'fails that post in plain words, holds the rest, and keeps the free run spent when Buffer %s',
    async (_, broken) => {
      const t = convexTest(schema, modules)
      const { userId, runId } = await seed(t)
      const { created } = stubServices({ send: (n) => (n === 2 ? broken() : ok(n)) })
      await t.action(internal.runs.execute, { runId })

      // One sent, one unknown, and the other two saved to send later rather than lost.
      expect(created).toHaveLength(2)
      const posts = await postsOf(t, runId)
      expect(posts.map((p) => p.status)).toEqual(['queued', 'failed', 'held', 'held'])
      expect(posts[1]!.reason).toBe(
        'Buffer did not answer while this post was being sent. Check Buffer before sending it again.',
      )
      const run = await t.run((ctx) => ctx.db.get(runId))
      expect(run).toMatchObject({ status: 'done', freeRun: true })
      expect(run?.heldRetryAt).toBeGreaterThan(Date.now())
      expect(run?.steps.at(-1)?.note).toMatch(
        /^1 post in Buffer\. The rest are waiting because Buffer stopped answering/,
      )
      expect((await t.run((ctx) => ctx.db.get(userId)))?.freeRunsUsed).toBe(1)
    },
  )

  it('still stops on a refusal that is about the person, not Buffer', () => {
    expect(bufferDidNotAnswer(new BufferApiError('Unauthorized', 401))).toBe(false)
    expect(bufferDidNotAnswer(new BufferPostError('Too long', 'invalid'))).toBe(false)
    expect(bufferDidNotAnswer(new Error('Something else'))).toBe(false)
    expect(bufferDidNotAnswer(new TypeError('fetch failed'))).toBe(true)
    expect(bufferDidNotAnswer(new BufferApiError('Bad gateway', 503))).toBe(true)
  })
})

describe('the writer repeating a post', () => {
  it('sends one post per story and channel, and says it left the rest out', async () => {
    const t = convexTest(schema, modules)
    const { runId } = await seed(t)
    const { created } = stubServices({ repeat: true })
    await t.action(internal.runs.execute, { runId })
    expect(created.sort()).toEqual(['c1', 'c1', 'c2', 'c2'])
    const run = await t.run((ctx) => ctx.db.get(runId))
    expect(
      run?.steps.some(
        (s) => s.note === '4 posts repeated a story on the same channel and were left out.',
      ),
    ).toBe(true)
  })

  it('keeps the first of each pair, matching links however they are written', () => {
    const posts = [
      { storyUrl: 'https://a.com/x', channelId: 'c1', text: 'first' },
      { storyUrl: 'https://a.com/x/', channelId: 'c1', text: 'again' },
      { storyUrl: 'https://a.com/x', channelId: 'c2', text: 'other channel' },
    ]
    expect(onePerStoryAndChannel(posts)).toEqual({
      posts: [posts[0], posts[2]],
      dropped: 1,
    })
  })
})

describe('a research reply that cannot be read', () => {
  it('counts what both tries cost, and fails the run as the AI’s fault', async () => {
    const t = convexTest(schema, modules)
    const { userId, runId } = await seed(t)
    stubServices({ research: '{"candidates": [' })
    await t.action(internal.runs.execute, { runId })
    const calls = await t.run((ctx) => ctx.db.query('aiCalls').collect())
    expect(calls).toHaveLength(1)
    expect(calls[0]?.usage.inputTokens).toBe(200)
    const run = await t.run((ctx) => ctx.db.get(runId))
    expect(run?.status).toBe('failed')
    expect(run?.steps.at(-1)?.note).toMatch(/The AI service had a problem/)
    expect((await t.run((ctx) => ctx.db.get(userId)))?.freeRunsUsed).toBe(0)
  })
})
