import { convexTest, type TestConvex } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.*s')
const cadence = { preset: 'daily' as const, time: '08:00', weekday: null }

async function person(t: TestConvex<typeof schema>, email: string) {
  const userId = await t.run((ctx) =>
    ctx.db.insert('users', { email, timezone: 'UTC', freeRunsUsed: 0, freeDryRunsUsed: 0 }),
  )
  const automationId = await t.run((ctx) =>
    ctx.db.insert('automations', {
      userId,
      name: `${email} news`,
      status: 'ready',
      setup: {
        research: 'F1',
        services: ['twitter'],
        avoid: '',
        sources: [],
        onlyTheseSources: false,
        cadence,
        maxStories: 1,
        postingMode: 'draft',
      },
      channelIds: [],
      cadence,
      timezone: 'UTC',
      postingMode: 'draft',
      maxPostsPerRun: 1,
      createdAt: 0,
      updatedAt: 0,
    }),
  )
  return { userId, automationId, as: t.withIdentity({ subject: `${userId}|session` }) }
}

const idea = (requestId: string, message = 'Weekly batches, please.') => ({
  requestId,
  category: 'idea' as const,
  message,
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-11T12:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('feedback', () => {
  it('stores feedback without any context and returns a receipt', async () => {
    const t = convexTest(schema, modules)
    const { as } = await person(t, 'a@example.com')
    const receipt = await as.mutation(api.feedback.submit, idea('r1'))
    expect(receipt.duplicate).toBe(false)
    const mine = await as.query(api.feedback.mine, {})
    expect(mine).toEqual([
      expect.objectContaining({
        id: receipt.id,
        category: 'idea',
        status: 'new',
        automationName: null,
      }),
    ])
  })

  it('requires sign-in and a sensible message', async () => {
    const t = convexTest(schema, modules)
    await expect(t.mutation(api.feedback.submit, idea('r1'))).rejects.toThrow(/signed in/)
    const { as } = await person(t, 'a@example.com')
    await expect(as.mutation(api.feedback.submit, idea('r1', '   '))).rejects.toThrow(/1–2,000/)
    await expect(as.mutation(api.feedback.submit, idea('r1', 'x'.repeat(2_001)))).rejects.toThrow(
      /1–2,000/,
    )
  })

  it('treats a retried request ID or repeated words as one submission', async () => {
    const t = convexTest(schema, modules)
    const { as } = await person(t, 'a@example.com')
    const first = await as.mutation(api.feedback.submit, idea('r1'))
    vi.advanceTimersByTime(10_000)
    expect(await as.mutation(api.feedback.submit, idea('r1'))).toEqual({
      ...first,
      duplicate: true,
    })
    expect(await as.mutation(api.feedback.submit, idea('r2'))).toEqual({
      ...first,
      duplicate: true,
    })
    await expect(as.mutation(api.feedback.submit, idea('r1', 'Other words'))).rejects.toThrow(
      /different message/,
    )
    expect(await as.query(api.feedback.mine, {})).toHaveLength(1)
  })

  it('limits bursts and daily volume', async () => {
    const t = convexTest(schema, modules)
    const { as } = await person(t, 'a@example.com')
    await as.mutation(api.feedback.submit, idea('r0', 'Message 0'))
    await expect(as.mutation(api.feedback.submit, idea('r1', 'Message 1'))).rejects.toThrow(
      /few seconds/,
    )
    for (let i = 1; i < 10; i++) {
      vi.advanceTimersByTime(6_000)
      await as.mutation(api.feedback.submit, idea(`r${i}`, `Message ${i}`))
    }
    vi.advanceTimersByTime(6_000)
    await expect(as.mutation(api.feedback.submit, idea('r10', 'Message 10'))).rejects.toThrow(
      /tomorrow/,
    )
    vi.advanceTimersByTime(86_400_000)
    await as.mutation(api.feedback.submit, idea('r11', 'Message 11'))
  })

  it('attaches only the person’s own automation, run and assistant reply', async () => {
    const t = convexTest(schema, modules)
    const a = await person(t, 'a@example.com')
    const b = await person(t, 'b@example.com')
    await expect(
      a.as.mutation(api.feedback.submit, { ...idea('r1'), automationId: b.automationId }),
    ).rejects.toThrow()
    const otherRun = await t.run((ctx) =>
      ctx.db.insert('runs', {
        userId: b.userId,
        automationId: b.automationId,
        kind: 'dry',
        status: 'done',
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
      }),
    )
    await expect(
      a.as.mutation(api.feedback.submit, { ...idea('r2'), runId: otherRun }),
    ).rejects.toThrow(/not yours/)

    const conversationId = await a.as.mutation(api.automationChat.open, {
      automationId: a.automationId,
    })
    const turnId = await t.run((ctx) =>
      ctx.db.insert('automationChatTurns', {
        conversationId,
        requestId: 'q',
        userId: a.userId,
        userText: 'Weekly batches',
        baseRevision: 0,
        prompt: '',
        status: 'complete',
        kind: 'unsupported',
        createdAt: 0,
      }),
    )
    await expect(
      b.as.mutation(api.feedback.submit, {
        ...idea('r3'),
        automationId: b.automationId,
        chatTurnId: turnId,
      }),
    ).rejects.toThrow(/not yours/)
    // A reply belongs with the automation it was about.
    await expect(
      a.as.mutation(api.feedback.submit, { ...idea('r4'), chatTurnId: turnId }),
    ).rejects.toThrow(/not yours/)

    const receipt = await a.as.mutation(api.feedback.submit, {
      ...idea('r5'),
      source: 'assistant',
      automationId: a.automationId,
      chatTurnId: turnId,
    })
    const [row] = await t.query(internal.feedback.triage, {})
    expect(row).toMatchObject({
      _id: receipt.id,
      source: 'assistant',
      automationName: 'a@example.com news',
      chatTurnId: turnId,
      email: 'a@example.com',
    })
    expect(await b.as.query(api.feedback.mine, {})).toEqual([])
  })

  it('lets the owner triage, and account deletion removes submissions', async () => {
    const t = convexTest(schema, modules)
    const { as, userId } = await person(t, 'a@example.com')
    const { id } = await as.mutation(api.feedback.submit, idea('r1'))
    await t.mutation(internal.feedback.setStatus, { id, status: 'planned', note: 'WB-01' })
    expect(await t.query(internal.feedback.triage, { status: 'new' })).toEqual([])
    expect(await t.query(internal.feedback.triage, { status: 'planned' })).toEqual([
      expect.objectContaining({ _id: id, note: 'WB-01' }),
    ])
    expect((await as.query(api.feedback.mine, {}))[0]!.status).toBe('planned')
    await t.mutation(internal.users.deleteUserData, { userId })
    expect(await t.query(internal.feedback.triage, {})).toEqual([])
  })
})
