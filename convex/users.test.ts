import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api, internal } from './_generated/api'
import { saveBufferConnection } from './buffer'
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
