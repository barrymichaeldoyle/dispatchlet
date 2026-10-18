import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
  type MutationCtx,
} from './_generated/server'
import { isAllowlisted } from './lib/allowlist'
import {
  BufferApiError,
  bufferGraphql,
  lastRateLimit,
  refreshBufferTokens,
  revokeBufferToken,
} from './lib/buffer'
import { decryptSecret, encryptSecret } from './lib/crypto'

/** The tokens from a sign-in, already encrypted by the provider's profile step. */
export type SignInGrant = {
  bufferAccountId: string
  accessTokenEnc: string
  refreshTokenEnc?: string
  expiresAt: number
  scope: string
}

/** How long a claimed refresh lock is honoured before another caller may take it over. */
const REFRESH_LOCK_MS = 30_000
/** The text channels Dispatchlet can post to. */
const TEXT_SERVICES = new Set(['twitter', 'linkedin', 'threads', 'bluesky', 'mastodon'])

/** Stores the grant from a sign-in. A new sign-in replaces the previous grant entirely. */
export async function saveBufferConnection(
  ctx: MutationCtx,
  userId: Id<'users'>,
  grant: SignInGrant,
): Promise<void> {
  const existing = await ctx.db
    .query('bufferConnections')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first()
  const fields = {
    userId,
    bufferAccountId: grant.bufferAccountId,
    accessTokenEnc: grant.accessTokenEnc,
    refreshTokenEnc: grant.refreshTokenEnc,
    expiresAt: grant.expiresAt,
    scope: grant.scope,
    refreshingAt: undefined,
    needsReauth: false,
    updatedAt: Date.now(),
  }
  if (existing) await ctx.db.replace(existing._id, fields)
  else await ctx.db.insert('bufferConnections', fields)
}

/** Deletes the user's stored grant and channels. Revoking at Buffer is done separately. */
export async function removeBufferConnection(ctx: MutationCtx, userId: Id<'users'>): Promise<void> {
  const connections = await ctx.db
    .query('bufferConnections')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect()
  for (const connection of connections) await ctx.db.delete(connection._id)
  const channels = await ctx.db
    .query('bufferChannels')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect()
  for (const channel of channels) await ctx.db.delete(channel._id)
}

export const removeConnection = internalMutation({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => removeBufferConnection(ctx, userId),
})

/** Revokes a grant at Buffer. The refresh token first, which ends the grant; else the access token. */
export const revokeGrant = internalAction({
  args: { accessTokenEnc: v.string(), refreshTokenEnc: v.optional(v.string()) },
  returns: v.boolean(),
  handler: async (_ctx, { accessTokenEnc, refreshTokenEnc }) => {
    if (refreshTokenEnc) {
      const revoked = await revokeBufferToken(await decryptSecret(refreshTokenEnc), 'refresh_token')
      console.log(`Buffer grant revoked via refresh token: ${revoked}`)
      if (revoked) return true
    }
    const revoked = await revokeBufferToken(await decryptSecret(accessTokenEnc), 'access_token')
    console.log(`Buffer grant revoked via access token: ${revoked}`)
    return revoked
  },
})

export const recordRateLimit = internalMutation({
  args: { userId: v.id('users'), rateLimit: v.string() },
  handler: async (ctx, { userId, rateLimit }) => {
    const connection = await ctx.db
      .query('bufferConnections')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()
    if (connection) {
      await ctx.db.patch(connection._id, { lastRateLimit: rateLimit, lastRateLimitAt: Date.now() })
    }
  },
})

export const connectionFor = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }): Promise<Doc<'bufferConnections'> | null> =>
    await ctx.db
      .query('bufferConnections')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first(),
})

/**
 * The refresh lock. Buffer's refresh tokens are single-use and reusing one revokes the grant, so
 * exactly one caller may refresh at a time. Returns false if someone else holds the lock.
 */
export const claimRefresh = internalMutation({
  args: { connectionId: v.id('bufferConnections') },
  returns: v.boolean(),
  handler: async (ctx, { connectionId }) => {
    const connection = await ctx.db.get(connectionId)
    if (!connection) return false
    const now = Date.now()
    if (connection.refreshingAt && now - connection.refreshingAt < REFRESH_LOCK_MS) return false
    await ctx.db.patch(connectionId, { refreshingAt: now })
    return true
  },
})

export const storeRefreshed = internalMutation({
  args: {
    connectionId: v.id('bufferConnections'),
    accessTokenEnc: v.string(),
    refreshTokenEnc: v.optional(v.string()),
    expiresAt: v.number(),
    scope: v.string(),
  },
  handler: async (ctx, { connectionId, ...tokens }) => {
    const now = Date.now()
    await ctx.db.patch(connectionId, {
      ...tokens,
      refreshingAt: undefined,
      lastRefreshedAt: now,
      updatedAt: now,
    })
  },
})

export const releaseRefresh = internalMutation({
  args: { connectionId: v.id('bufferConnections'), needsReauth: v.boolean() },
  handler: async (ctx, { connectionId, needsReauth }) => {
    await ctx.db.patch(connectionId, {
      refreshingAt: undefined,
      ...(needsReauth ? { needsReauth: true } : {}),
      updatedAt: Date.now(),
    })
  },
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * A valid access token for the user, refreshing it first when it has expired (or when `force`
 * is set). Every Buffer call goes through here, so there is only one place that refreshes.
 */
async function accessTokenFor(
  ctx: ActionCtx,
  userId: Id<'users'>,
  force = false,
): Promise<{ token: string; refreshed: boolean }> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const connection = await ctx.runQuery(internal.buffer.connectionFor, { userId })
    if (!connection) throw new Error('No Buffer connection. Sign in with Buffer again.')
    if (connection.needsReauth)
      throw new Error('Buffer access has ended. Sign in with Buffer again.')
    if (!force && connection.expiresAt > Date.now()) {
      return { token: await decryptSecret(connection.accessTokenEnc), refreshed: false }
    }
    if (!connection.refreshTokenEnc) {
      await ctx.runMutation(internal.buffer.releaseRefresh, {
        connectionId: connection._id,
        needsReauth: true,
      })
      throw new Error('Buffer did not issue a refresh token. Sign in with Buffer again.')
    }
    const claimed = await ctx.runMutation(internal.buffer.claimRefresh, {
      connectionId: connection._id,
    })
    if (!claimed) {
      // Another caller is refreshing; wait for its new token rather than spending ours.
      await sleep(1500)
      force = false
      continue
    }
    try {
      const tokens = await refreshBufferTokens(await decryptSecret(connection.refreshTokenEnc))
      await ctx.runMutation(internal.buffer.storeRefreshed, {
        connectionId: connection._id,
        accessTokenEnc: await encryptSecret(tokens.accessToken),
        refreshTokenEnc: tokens.refreshToken ? await encryptSecret(tokens.refreshToken) : undefined,
        expiresAt: tokens.expiresAt,
        scope: tokens.scope || connection.scope,
      })
      return { token: tokens.accessToken, refreshed: true }
    } catch (error) {
      // A rejected grant needs a new sign-in; anything else (network, 5xx) can be retried later.
      const rejected = error instanceof BufferApiError && error.status >= 400 && error.status < 500
      await ctx.runMutation(internal.buffer.releaseRefresh, {
        connectionId: connection._id,
        needsReauth: rejected,
      })
      throw error
    }
  }
  throw new Error('Timed out waiting for another Buffer token refresh')
}

/** The signed-in, allowlisted user, or an error. Buffer features are owner-only until launch. */
async function allowlistedUser(ctx: ActionCtx): Promise<Id<'users'>> {
  const userId = await getAuthUserId(ctx)
  if (!userId) throw new Error('Not signed in')
  const viewer = await ctx.runQuery(internal.buffer.viewerAccess, { userId })
  if (!viewer.allowed) throw new Error('Not available yet')
  return userId
}

export const viewerAccess = internalQuery({
  args: { userId: v.id('users') },
  returns: v.object({ allowed: v.boolean() }),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId)
    const account = await ctx.db
      .query('authAccounts')
      .withIndex('userIdAndProvider', (q) => q.eq('userId', userId).eq('provider', 'buffer'))
      .first()
    return {
      allowed: isAllowlisted(account?.providerAccountId ?? null, user?.email ?? null),
    }
  },
})

type ChannelRow = {
  organizationId: string
  channelId: string
  service: string
  name: string
  displayName?: string
  avatar?: string
  usable: boolean
}

export const saveChannels = internalMutation({
  args: {
    userId: v.id('users'),
    channels: v.array(
      v.object({
        organizationId: v.string(),
        channelId: v.string(),
        service: v.string(),
        name: v.string(),
        displayName: v.optional(v.string()),
        avatar: v.optional(v.string()),
        usable: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, { userId, channels }) => {
    const now = Date.now()
    const existing = await ctx.db
      .query('bufferChannels')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    const keep = new Set(channels.map((channel) => channel.channelId))
    for (const row of existing) if (!keep.has(row.channelId)) await ctx.db.delete(row._id)
    for (const channel of channels) {
      const row = existing.find((r) => r.channelId === channel.channelId)
      if (row) await ctx.db.patch(row._id, { ...channel, syncedAt: now })
      else await ctx.db.insert('bufferChannels', { userId, ...channel, syncedAt: now })
    }
  },
})

/** Reads the user's organizations and their text channels from Buffer and stores them. */
export const syncChannels = action({
  args: {},
  returns: v.object({ channels: v.number() }),
  handler: async (ctx) => {
    const userId = await allowlistedUser(ctx)
    const { token } = await accessTokenFor(ctx, userId)
    const { account } = await bufferGraphql<{ account: { organizations: { id: string }[] } }>(
      token,
      'query DispatchletOrganizations { account { organizations { id } } }',
    )
    const channels: ChannelRow[] = []
    for (const organization of account.organizations) {
      const data = await bufferGraphql<{
        channels: {
          id: string
          name: string
          displayName?: string | null
          service: string
          avatar?: string | null
          isDisconnected?: boolean | null
          isLocked?: boolean | null
        }[]
      }>(
        token,
        `query DispatchletChannels($orgId: OrganizationId!) {
          channels(input: { organizationId: $orgId }) {
            id name displayName service avatar isDisconnected isLocked
          }
        }`,
        { orgId: organization.id },
      )
      for (const channel of data.channels) {
        if (!TEXT_SERVICES.has(channel.service)) continue
        channels.push({
          organizationId: organization.id,
          channelId: channel.id,
          service: channel.service,
          name: channel.name,
          displayName: channel.displayName ?? undefined,
          avatar: channel.avatar ?? undefined,
          usable: !channel.isDisconnected && !channel.isLocked,
        })
      }
    }
    await ctx.runMutation(internal.buffer.saveChannels, { userId, channels })
    if (lastRateLimit) {
      await ctx.runMutation(internal.buffer.recordRateLimit, { userId, rateLimit: lastRateLimit })
    }
    return { channels: channels.length }
  },
})

/**
 * Disconnect: revokes Dispatchlet's access at Buffer and deletes the stored tokens and channels.
 * The user stays signed in to Dispatchlet; signing in with Buffer again reconnects.
 */
export const disconnect = action({
  args: {},
  returns: v.object({ revoked: v.boolean() }),
  handler: async (ctx): Promise<{ revoked: boolean }> => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not signed in')
    const connection: Doc<'bufferConnections'> | null = await ctx.runQuery(
      internal.buffer.connectionFor,
      { userId },
    )
    let revoked = false
    if (connection) {
      revoked = await ctx.runAction(internal.buffer.revokeGrant, {
        accessTokenEnc: connection.accessTokenEnc,
        refreshTokenEnc: connection.refreshTokenEnc,
      })
    }
    await ctx.runMutation(internal.buffer.removeConnection, { userId })
    return { revoked }
  },
})

/**
 * Forces a refresh to prove the rotation works without waiting an hour. Run from the CLI:
 * `npx convex run buffer:refreshNow '{"userId":"..."}'`.
 */
export const refreshNow = internalAction({
  args: { userId: v.id('users') },
  returns: v.object({ refreshed: v.boolean() }),
  handler: async (ctx, { userId }) => {
    const { refreshed } = await accessTokenFor(ctx, userId, true)
    return { refreshed }
  },
})

/** The signed-in user's Buffer connection, for the app page. Never returns tokens. */
export const myConnection = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const connection = await ctx.db
      .query('bufferConnections')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()
    if (!connection) return null
    const channels = await ctx.db
      .query('bufferChannels')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    return {
      scope: connection.scope,
      canRefresh: Boolean(connection.refreshTokenEnc),
      needsReauth: connection.needsReauth ?? false,
      expiresAt: connection.expiresAt,
      lastRefreshedAt: connection.lastRefreshedAt ?? null,
      lastRateLimit: connection.lastRateLimit ?? null,
      channels: channels.map((channel) => ({
        channelId: channel.channelId,
        service: channel.service,
        name: channel.displayName ?? channel.name,
        usable: channel.usable,
        syncedAt: channel.syncedAt,
      })),
    }
  },
})
