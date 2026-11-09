import { convexTest } from 'convex-test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { internal } from './_generated/api'
import { ERROR_ALERT_GAP, ERROR_ALERTS_PER_DAY, HEARTBEATS, RUN_OVERDUE_MS } from './alerts'
import schema from './schema'

const modules = import.meta.glob('./**/*.*s')

afterEach(() => vi.useRealTimers())

describe('error alerts', () => {
  it('sends at most one email every 10 minutes', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    expect(await t.mutation(internal.alerts.claimErrorAlert, {})).toBe(true)
    expect(await t.mutation(internal.alerts.claimErrorAlert, {})).toBe(false)
    vi.advanceTimersByTime(ERROR_ALERT_GAP + 1)
    expect(await t.mutation(internal.alerts.claimErrorAlert, {})).toBe(true)
  })

  it('stops after 20 in a day, and starts again the next day', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    for (let i = 0; i < ERROR_ALERTS_PER_DAY; i++) {
      expect(await t.mutation(internal.alerts.claimErrorAlert, {})).toBe(true)
      vi.advanceTimersByTime(ERROR_ALERT_GAP + 1)
    }
    expect(await t.mutation(internal.alerts.claimErrorAlert, {})).toBe(false)
    vi.advanceTimersByTime(24 * 60 * 60_000)
    expect(await t.mutation(internal.alerts.claimErrorAlert, {})).toBe(true)
  })

  it('the endpoint accepts any body and never echoes it into the email', async () => {
    const t = convexTest(schema, modules)
    const response = await t.fetch('/alerts/errors', {
      method: 'POST',
      body: JSON.stringify({ name: '<script>phish</script>' }),
    })
    expect(response.status).toBe(202)
    const { errorAlertMessage } = await import('./email')
    const message = errorAlertMessage('owner@example.com')
    expect(message.text).not.toContain('phish')
    expect(message.subject).toBe('New error on Dispatchlet')
  })
})

async function beatAll(t: ReturnType<typeof convexTest>) {
  for (const { kind } of HEARTBEATS) await t.mutation(internal.alerts.beat, { kind })
}

describe('the health check', () => {
  it('is well once every job has completed in time and no run is overdue', async () => {
    const t = convexTest(schema, modules)
    await beatAll(t)
    expect(await t.query(internal.alerts.health, {})).toEqual({
      ok: true,
      stale: [],
      overdueRuns: 0,
    })
    expect((await t.fetch('/health')).status).toBe(200)
  })

  it('gives a fresh deployment time before a job that has never completed counts', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    expect((await t.query(internal.alerts.health, {})).ok).toBe(true)
    await t.mutation(internal.alerts.beat, { kind: 'poll-statuses' })
    vi.advanceTimersByTime(60 * 60_000)
    await t.mutation(internal.alerts.beat, { kind: 'poll-statuses' })
    await t.mutation(internal.alerts.beat, { kind: 'sweep-abandoned' })
    // An hour in: the daily metrics job has had no chance yet.
    expect((await t.query(internal.alerts.health, {})).ok).toBe(true)
    vi.advanceTimersByTime(36 * 60 * 60_000)
    await t.mutation(internal.alerts.beat, { kind: 'poll-statuses' })
    await t.mutation(internal.alerts.beat, { kind: 'sweep-abandoned' })
    expect((await t.query(internal.alerts.health, {})).stale).toEqual([
      { kind: 'poll-metrics', sinceMs: null },
    ])
  })

  it('names a job that has never completed, and one that has gone quiet', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    await t.mutation(internal.alerts.beat, { kind: 'poll-statuses' })
    await t.mutation(internal.alerts.beat, { kind: 'poll-metrics' })
    vi.advanceTimersByTime(3 * 60 * 60_000)
    const report = await t.query(internal.alerts.health, {})
    expect(report.ok).toBe(false)
    expect(report.stale).toEqual([
      { kind: 'poll-statuses', sinceMs: 3 * 60 * 60_000 },
      { kind: 'sweep-abandoned', sinceMs: null },
    ])
    const res = await t.fetch('/health')
    expect(res.status).toBe(503)
    expect(await res.text()).toContain('sweep-abandoned')
  })

  it('counts active automations whose booked run never started', async () => {
    const t = convexTest(schema, modules)
    await beatAll(t)
    const now = Date.now()
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', { email: 'owner@example.com' })
      const base = {
        userId,
        name: 'F1',
        setup: {
          research: 'F1',
          services: ['twitter'],
          avoid: '',
          sources: [],
          onlyTheseSources: false,
          cadence: { preset: 'daily' as const, time: '08:00', weekday: null },
          maxStories: 3,
          postingMode: 'draft' as const,
        },
        channelIds: ['c1'],
        cadence: { preset: 'daily' as const, time: '08:00', weekday: null },
        timezone: 'UTC',
        postingMode: 'draft',
        maxPostsPerRun: 3,
        createdAt: now,
        updatedAt: now,
      }
      await ctx.db.insert('automations', {
        ...base,
        status: 'active',
        nextRunAt: now - RUN_OVERDUE_MS - 60_000,
      })
      await ctx.db.insert('automations', { ...base, status: 'active', nextRunAt: now - 60_000 })
      await ctx.db.insert('automations', {
        ...base,
        status: 'paused',
        nextRunAt: now - RUN_OVERDUE_MS - 60_000,
      })
      await ctx.db.insert('automations', {
        ...base,
        status: 'active',
        nextRunAt: now - RUN_OVERDUE_MS - 60_000,
        deletedAt: now,
      })
    })
    expect(await t.query(internal.alerts.health, {})).toMatchObject({ ok: false, overdueRuns: 1 })
  })

  it('emails the owner when unwell, once an hour at most, and not when well', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    await t.mutation(internal.alerts.beat, { kind: 'poll-metrics' })
    vi.advanceTimersByTime(3 * 60 * 60_000)
    expect(await t.mutation(internal.alerts.checkHealth, {})).toBe(false)
    expect(await t.mutation(internal.alerts.checkHealth, {})).toBe(false)
    const notes = () =>
      t.run((ctx) =>
        ctx.db
          .query('alertsSent')
          .withIndex('by_kind_sentAt', (q) => q.eq('kind', 'owner:health'))
          .collect(),
      )
    expect(await notes()).toHaveLength(1)
    const scheduled = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())
    expect(scheduled.map((s) => s.name)).toEqual(['email:sendOwnerNote'])
    expect(JSON.stringify(scheduled[0]!.args)).toContain('poll-statuses has not completed yet')
    vi.advanceTimersByTime(61 * 60_000)
    await beatAll(t)
    expect(await t.mutation(internal.alerts.checkHealth, {})).toBe(true)
    expect(await notes()).toHaveLength(1)
  })
})
