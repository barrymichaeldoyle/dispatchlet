import { convexTest } from 'convex-test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { internal } from './_generated/api'
import { saveBufferConnection } from './buffer'
import schema from './schema'

const modules = import.meta.glob('./**/*.*s')

async function setup() {
  const t = convexTest(schema, modules)
  const { userId, connectionId } = await t.run(async (ctx) => {
    const id = await ctx.db.insert('users', { email: 'owner@example.com' })
    await saveBufferConnection(ctx, id, {
      bufferAccountId: 'buffer-1',
      accessTokenEnc: 'iv.access',
      refreshTokenEnc: 'iv.refresh',
      expiresAt: Date.now() + 60_000,
      scope: 'account:read posts:write offline_access',
    })
    const connection = await ctx.db
      .query('bufferConnections')
      .withIndex('by_user', (q) => q.eq('userId', id))
      .first()
    return { userId: id, connectionId: connection!._id }
  })
  return { t, userId, connectionId }
}

describe('the Buffer refresh lock', () => {
  it('lets only one caller refresh at a time', async () => {
    const { t, connectionId } = await setup()
    expect(await t.mutation(internal.buffer.claimRefresh, { connectionId })).toBe(true)
    expect(await t.mutation(internal.buffer.claimRefresh, { connectionId })).toBe(false)
  })

  it('frees the lock once the new tokens are stored', async () => {
    const { t, connectionId } = await setup()
    await t.mutation(internal.buffer.claimRefresh, { connectionId })
    await t.mutation(internal.buffer.storeRefreshed, {
      connectionId,
      accessTokenEnc: 'iv.access2',
      refreshTokenEnc: 'iv.refresh2',
      expiresAt: Date.now() + 3_600_000,
      scope: 'account:read',
    })
    expect(await t.mutation(internal.buffer.claimRefresh, { connectionId })).toBe(true)
  })

  it('takes over a lock left behind by a caller that died', async () => {
    vi.useFakeTimers()
    try {
      const { t, connectionId } = await setup()
      await t.mutation(internal.buffer.claimRefresh, { connectionId })
      vi.advanceTimersByTime(31_000)
      expect(await t.mutation(internal.buffer.claimRefresh, { connectionId })).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks the connection for a new sign-in when Buffer rejects the grant', async () => {
    const { t, userId, connectionId } = await setup()
    await t.mutation(internal.buffer.claimRefresh, { connectionId })
    await t.mutation(internal.buffer.releaseRefresh, { connectionId, needsReauth: true })
    const connection = await t.query(internal.buffer.connectionFor, { userId })
    expect(connection?.needsReauth).toBe(true)
    expect(connection?.refreshingAt).toBeUndefined()
  })

  it('a new sign-in replaces the grant and clears the reauth flag', async () => {
    const { t, userId, connectionId } = await setup()
    await t.mutation(internal.buffer.releaseRefresh, { connectionId, needsReauth: true })
    await t.run(async (ctx) => {
      await saveBufferConnection(ctx, userId, {
        bufferAccountId: 'buffer-1',
        accessTokenEnc: 'iv.fresh',
        expiresAt: Date.now() + 3_600_000,
        scope: 'account:read',
      })
    })
    const connection = await t.query(internal.buffer.connectionFor, { userId })
    expect(connection?.needsReauth).toBe(false)
    expect(connection?.accessTokenEnc).toBe('iv.fresh')
    expect(connection?.refreshTokenEnc).toBeUndefined()
  })
})

describe('disconnecting', () => {
  it('deletes the stored grant and channels', async () => {
    const { t, userId } = await setup()
    await t.mutation(internal.buffer.saveChannels, {
      userId,
      channels: [
        { organizationId: 'org', channelId: 'c1', service: 'twitter', name: 'x', usable: true },
      ],
    })
    await t.mutation(internal.buffer.removeConnection, { userId })
    expect(await t.query(internal.buffer.connectionFor, { userId })).toBeNull()
    const channels = await t.run((ctx) =>
      ctx.db
        .query('bufferChannels')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect(),
    )
    expect(channels).toHaveLength(0)
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const RATE_LIMIT =
  'ratelimit: "100-in-15min"; r=2; t=900; ratelimit: "250-in-1day"; r=200; t=8000; ratelimit-policy: "100-in-15min"; q=100; w=900; pk=:shared:'

describe('the Buffer call budget', () => {
  it('allows calls until Buffer has reported a budget', async () => {
    const { t, userId } = await setup()
    expect(
      await t.mutation(internal.buffer.reserveCalls, { userId, calls: 5, priority: 'background' }),
    ).toEqual({ ok: true })
  })

  it('spends the reported budget and refuses once a window is used up', async () => {
    const { t, userId } = await setup()
    await t.mutation(internal.buffer.recordRateLimit, { userId, rateLimit: RATE_LIMIT })
    const reserve = () =>
      t.mutation(internal.buffer.reserveCalls, { userId, calls: 1, priority: 'interactive' })
    expect(await reserve()).toEqual({ ok: true })
    expect(await reserve()).toEqual({ ok: true })
    const refused = await reserve()
    expect(refused.ok).toBe(false)
  })

  it('shares one budget between accounts with the same partition key', async () => {
    const { t, userId } = await setup()
    const otherId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('users', { email: 'second@example.com' })
      await saveBufferConnection(ctx, id, {
        bufferAccountId: 'buffer-2',
        accessTokenEnc: 'iv.other',
        expiresAt: Date.now() + 60_000,
        scope: 'account:read',
      })
      return id
    })
    await t.mutation(internal.buffer.recordRateLimit, { userId, rateLimit: RATE_LIMIT })
    await t.mutation(internal.buffer.recordRateLimit, { userId: otherId, rateLimit: RATE_LIMIT })
    for (const id of [userId, otherId]) {
      expect(
        await t.mutation(internal.buffer.reserveCalls, {
          userId: id,
          calls: 1,
          priority: 'interactive',
        }),
      ).toEqual({ ok: true })
    }
    const third = await t.mutation(internal.buffer.reserveCalls, {
      userId,
      calls: 1,
      priority: 'interactive',
    })
    expect(third.ok).toBe(false)
  })
})

describe('reconnecting', () => {
  it('keeps the budget partition for the same Buffer account only', async () => {
    const { t, userId } = await setup()
    await t.mutation(internal.buffer.recordRateLimit, { userId, rateLimit: RATE_LIMIT })
    const reconnect = (bufferAccountId: string) =>
      t.run(async (ctx) => {
        await saveBufferConnection(ctx, userId, {
          bufferAccountId,
          accessTokenEnc: 'iv.new',
          expiresAt: Date.now() + 60_000,
          scope: 'account:read',
        })
      })
    await reconnect('buffer-1')
    expect((await t.query(internal.buffer.connectionFor, { userId }))?.ratePartition).toBe('shared')
    await reconnect('buffer-other')
    expect(
      (await t.query(internal.buffer.connectionFor, { userId }))?.ratePartition,
    ).toBeUndefined()
  })
})

describe('losing Buffer access', () => {
  it('emails the person once, when access is first lost', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    vi.useFakeTimers()
    try {
      const { t, userId, connectionId } = await setup()
      await t.run((ctx) => ctx.db.patch(userId, { email: 'lost@example.com' }))
      await t.mutation(internal.buffer.releaseRefresh, { connectionId, needsReauth: true })
      await t.mutation(internal.buffer.releaseRefresh, { connectionId, needsReauth: true })
      await t.finishAllScheduledFunctions(vi.runAllTimers)
      // Earlier tests in this file also lose access; count only this user's emails.
      const emails = fetch.mock.calls
        .map(([, init]) => JSON.parse(init.body))
        .filter((body) => body.to === 'lost@example.com')
      expect(emails).toHaveLength(1)
      const [sent] = emails
      expect(sent.subject).toBe('Dispatchlet lost access to Buffer')
      expect(sent.text).toContain('https://dispatchlet.com/app')
    } finally {
      vi.useRealTimers()
    }
  })
})
