import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api, internal } from './_generated/api'
import { saveBufferConnection } from './buffer'
import { nextRunAt } from './lib/schedule'
import { isTimeZone } from './users'
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
  it('deletes the user, sign-in records, sessions, Buffer grant and channels, but not the waiting list', async () => {
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
      return id
    })
    const { token } = await t.mutation(internal.waitlist.add, {
      email: 'a@example.com',
      source: 'buffer-sign-in',
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
      waitlist: await ctx.db.query('waitlist').collect(),
    }))
    expect(left.users).toHaveLength(0)
    expect(left.accounts).toHaveLength(0)
    expect(left.codes).toHaveLength(0)
    expect(left.sessions).toHaveLength(0)
    expect(left.refresh).toHaveLength(0)
    expect(left.connections).toHaveLength(0)
    expect(left.channels).toHaveLength(0)
    expect(left.waitlist.map((row) => row.token)).toEqual([token])
  })
})
