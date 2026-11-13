import { convexTest } from 'convex-test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import { saveBufferConnection } from './buffer'
import { nextRunAt } from './lib/schedule'
import { isTimeZone, PURGE_BATCH } from './users'
import schema from './schema'

const modules = import.meta.glob('./**/*.*s')

describe('time zone', () => {
  it('accepts IANA zones and refuses anything else', () => {
    expect(isTimeZone('Africa/Johannesburg')).toBe(true)
    expect(isTimeZone('Europe/London')).toBe(true)
    expect(isTimeZone('Not/AZone')).toBe(false)
    expect(isTimeZone('')).toBe(false)
  })

  it('is saved for the signed-in user only', async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run((ctx) => ctx.db.insert('users', { email: 'a@example.com' }))
    const user = t.withIdentity({ subject: `${userId}|session` })
    await user.mutation(api.users.setTimezone, { timezone: 'Africa/Johannesburg' })
    expect((await t.run((ctx) => ctx.db.get(userId)))?.timezone).toBe('Africa/Johannesburg')
    await expect(user.mutation(api.users.setTimezone, { timezone: 'Mars/Base' })).rejects.toThrow(
      'not a time zone',
    )
    await expect(t.mutation(api.users.setTimezone, { timezone: 'UTC' })).rejects.toThrow(
      'Not signed in',
    )
  })

  it('moves the automations still on the old zone with it, and rebooks the active ones', async () => {
    const t = convexTest(schema, modules)
    const cadence = { preset: 'daily' as const, time: '08:00', weekday: null }
    const automation = (status: string, timezone: string, deletedAt?: number) => ({
      name: 'F1',
      status,
      setup: {
        research: 'F1',
        services: ['twitter'],
        avoid: '',
        sources: [],
        onlyTheseSources: false,
        maxStories: 2,
        postingMode: 'draft' as const,
        cadence,
      },
      channelIds: ['x1'],
      cadence,
      timezone,
      postingMode: 'draft',
      maxPostsPerRun: 2,
      createdAt: 0,
      updatedAt: 0,
      deletedAt,
    })
    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', {
        email: 'a@example.com',
        timezone: 'Africa/Johannesburg',
      })
      const active = await ctx.db.insert('automations', {
        userId,
        ...automation('active', 'Africa/Johannesburg'),
        nextRunAt: nextRunAt(cadence, 'Africa/Johannesburg'),
      })
      const paused = await ctx.db.insert('automations', {
        userId,
        ...automation('paused', 'Africa/Johannesburg'),
      })
      const elsewhere = await ctx.db.insert('automations', {
        userId,
        ...automation('active', 'America/New_York'),
      })
      const gone = await ctx.db.insert('automations', {
        userId,
        ...automation('paused', 'Africa/Johannesburg', 1),
      })
      return { userId, active, paused, elsewhere, gone }
    })
    const user = t.withIdentity({ subject: `${ids.userId}|session` })
    await user.mutation(api.users.setTimezone, { timezone: 'Europe/London' })
    const after = await t.run(async (ctx) => ({
      active: await ctx.db.get(ids.active),
      paused: await ctx.db.get(ids.paused),
      elsewhere: await ctx.db.get(ids.elsewhere),
      gone: await ctx.db.get(ids.gone),
      booked: await ctx.db.system.query('_scheduled_functions').collect(),
    }))
    expect(after.active?.timezone).toBe('Europe/London')
    expect(after.active?.nextRunSetFor).toBe(nextRunAt(cadence, 'Europe/London'))
    expect(after.active?.nextRunAt).not.toBe(nextRunAt(cadence, 'Africa/Johannesburg'))
    expect(after.active?.scheduledFnId).toBeDefined()
    expect(after.booked).toHaveLength(1)
    // Paused ones take the zone but are not booked; other zones and deleted ones are left alone.
    expect(after.paused?.timezone).toBe('Europe/London')
    expect(after.paused?.scheduledFnId).toBeUndefined()
    expect(after.elsewhere?.timezone).toBe('America/New_York')
    expect(after.gone?.timezone).toBe('Africa/Johannesburg')
  })
})

describe('deleting an account', () => {
  it('deletes the user, sign-in records, sessions, Buffer grant and channels', async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('users', { email: 'a@example.com' })
      const accountId = await ctx.db.insert('authAccounts', {
        userId: id,
        provider: 'buffer',
        providerAccountId: 'buffer-1',
      })
      await ctx.db.insert('authVerificationCodes', {
        accountId,
        provider: 'buffer',
        code: 'c',
        expirationTime: Date.now() + 1000,
      })
      const sessionId = await ctx.db.insert('authSessions', {
        userId: id,
        expirationTime: Date.now() + 1000,
      })
      await ctx.db.insert('authRefreshTokens', { sessionId, expirationTime: Date.now() + 1000 })
      await saveBufferConnection(ctx, id, {
        bufferAccountId: 'buffer-1',
        accessTokenEnc: 'iv.access',
        expiresAt: Date.now() + 60_000,
        scope: 'account:read',
      })
      await ctx.db.insert('bufferChannels', {
        userId: id,
        organizationId: 'org',
        channelId: 'c1',
        service: 'twitter',
        name: 'x',
        usable: true,
        syncedAt: Date.now(),
      })
      await ctx.db.insert('aiCalls', {
        userId: id,
        purpose: 'playbook',
        model: 'm',
        stopReason: null,
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
          webSearches: 0,
          webFetches: 0,
        },
        costUsd: 0.01,
        durationMs: 1,
        refusal: null,
        createdAt: Date.now(),
      })
      await ctx.db.insert('aiSpend', { hourStart: 0, userId: id, usd: 0.01 })
      return id
    })
    await t.mutation(internal.users.deleteUserData, { userId })
    const left = await t.run(async (ctx) => ({
      users: await ctx.db.query('users').collect(),
      accounts: await ctx.db.query('authAccounts').collect(),
      codes: await ctx.db.query('authVerificationCodes').collect(),
      sessions: await ctx.db.query('authSessions').collect(),
      refresh: await ctx.db.query('authRefreshTokens').collect(),
      connections: await ctx.db.query('bufferConnections').collect(),
      channels: await ctx.db.query('bufferChannels').collect(),
      aiCalls: await ctx.db.query('aiCalls').collect(),
      aiSpend: await ctx.db.query('aiSpend').collect(),
    }))
    expect(left.aiCalls).toHaveLength(0)
    expect(left.aiSpend).toEqual([expect.objectContaining({ usd: 0.01 })])
    expect(left.aiSpend[0].userId).toBeUndefined()
    expect(left.users).toHaveLength(0)
    expect(left.accounts).toHaveLength(0)
    expect(left.codes).toHaveLength(0)
    expect(left.sessions).toHaveLength(0)
    expect(left.refresh).toHaveLength(0)
    expect(left.connections).toHaveLength(0)
    expect(left.channels).toHaveLength(0)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('signs out at once, then purges a large account in batches until nothing is left', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const usage = {
      inputTokens: 1,
      outputTokens: 1,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      webSearches: 0,
      webFetches: 0,
    }
    const many = PURGE_BATCH + 50
    const { userId, automationId } = await t.run(async (ctx) => {
      const user = await ctx.db.insert('users', { email: 'a@example.com' })
      await ctx.db.insert('authSessions', { userId: user, expirationTime: Date.now() + 1000 })
      const cadence = { preset: 'daily' as const, time: '08:00', weekday: null }
      const automation = await ctx.db.insert('automations', {
        userId: user,
        name: 'F1',
        status: 'active',
        setup: {
          research: 'F1',
          services: ['twitter'],
          avoid: '',
          sources: [],
          onlyTheseSources: false,
          maxStories: 2,
          postingMode: 'draft',
          cadence,
        },
        channelIds: ['c1'],
        cadence,
        timezone: 'UTC',
        postingMode: 'draft',
        maxPostsPerRun: 2,
        nextRunAt: Date.now() + 60_000,
        createdAt: 0,
        updatedAt: 0,
      })
      await ctx.db.insert('playbookVersions', {
        automationId: automation,
        version: 1,
        playbook: {},
        text: '',
        createdBy: 'ai',
        createdAt: 0,
      })
      const webhookId = await ctx.db.insert('webhooks', {
        userId: user,
        url: 'https://example.com/hook',
        secretEnc: 'iv.secret',
        events: ['post.sent'],
        active: true,
        createdAt: 0,
        failedInARow: 0,
      })
      for (let r = 0; r < 3; r++) {
        const runId = await ctx.db.insert('runs', {
          userId: user,
          automationId: automation,
          kind: 'scheduled',
          status: 'done',
          startedAt: r,
          steps: [],
          usage,
          costUsd: 0,
        })
        for (let i = 0; i < 120; i++) {
          const storyId = await ctx.db.insert('stories', {
            automationId: automation,
            runId,
            title: 'T',
            canonicalUrl: `https://x.y/${r}/${i}`,
            source: 'x',
            publishedAt: '',
            summary: '',
            whyItMatters: '',
            keyFacts: [],
            confidence: 1,
            decision: 'kept',
            reason: '',
            createdAt: 0,
          })
          await ctx.db.insert('posts', {
            userId: user,
            automationId: automation,
            runId,
            storyId,
            channelId: 'c1',
            service: 'twitter',
            text: 'hello',
            status: 'sent',
            createdAt: i,
          })
          await ctx.db.insert('aiCalls', {
            runId,
            userId: user,
            purpose: 'write',
            model: 'm',
            stopReason: null,
            usage,
            costUsd: 0,
            durationMs: 1,
            refusal: null,
            createdAt: i,
          })
        }
      }
      for (let i = 0; i < many; i++) {
        await ctx.db.insert('webhookDeliveries', {
          webhookId,
          userId: user,
          event: 'post.sent',
          payload: '{}',
          attempt: 1,
          status: 'ok',
          createdAt: i,
          updatedAt: i,
        })
        await ctx.db.insert('aiSpend', { hourStart: i, userId: user, usd: 0.01 })
      }
      return { userId: user, automationId: automation }
    })
    const counts = () =>
      t.run(async (ctx) => {
        const tables = [
          'runs',
          'stories',
          'posts',
          'aiCalls',
          'automations',
          'playbookVersions',
          'webhookDeliveries',
        ] as const
        const out: Record<string, number> = {}
        for (const table of tables) out[table] = (await ctx.db.query(table).collect()).length
        out.ownedSpend = (await ctx.db.query('aiSpend').collect()).filter((s) => s.userId).length
        return out
      })

    await t.mutation(internal.users.deleteUserData, { userId })
    // Signed out and stopped at once; the bulk is left for the scheduled purge.
    const now = await t.run(async (ctx) => ({
      user: await ctx.db.get(userId),
      sessions: await ctx.db.query('authSessions').collect(),
      webhooks: await ctx.db.query('webhooks').collect(),
      automation: await ctx.db.get(automationId),
    }))
    expect(now.user).toBeNull()
    expect(now.sessions).toHaveLength(0)
    expect(now.webhooks).toHaveLength(0)
    expect(now.automation?.deletedAt).toBeDefined()
    expect(now.automation?.nextRunAt).toBeUndefined()
    expect((await counts()).posts).toBeGreaterThan(0)

    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await counts()).toEqual({
      runs: 0,
      stories: 0,
      posts: 0,
      aiCalls: 0,
      automations: 0,
      playbookVersions: 0,
      webhookDeliveries: 0,
      ownedSpend: 0,
    })
    expect(await t.run((ctx) => ctx.db.query('aiSpend').collect())).toHaveLength(many)
  })
})

describe('resetting the free allowance', () => {
  it('zeroes runs and dry runs used and reports what was used', async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run((ctx) =>
      ctx.db.insert('users', { email: 'a@example.com', freeRunsUsed: 5, freeDryRunsUsed: 2 }),
    )
    expect(await t.mutation(internal.users.resetAllowance, { email: 'a@example.com' })).toEqual({
      freeRunsUsed: 5,
      freeDryRunsUsed: 2,
    })
    expect(await t.run((ctx) => ctx.db.get(userId))).toMatchObject({
      freeRunsUsed: 0,
      freeDryRunsUsed: 0,
    })
    await expect(
      t.mutation(internal.users.resetAllowance, { email: 'nobody@example.com' }),
    ).rejects.toThrow('No account')
  })
})
