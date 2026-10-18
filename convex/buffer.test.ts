import { convexTest } from 'convex-test'
import { describe, expect, it, vi } from 'vitest'
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
