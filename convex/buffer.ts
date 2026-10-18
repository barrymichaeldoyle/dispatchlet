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
import { BufferApiError, bufferRequest, refreshBufferTokens, revokeBufferToken } from './lib/buffer'
import { parseRateLimit, reserve, type Priority } from './lib/budget'
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
    // The budget belongs to the Buffer account, so a reconnect of the same one keeps it.
    ratePartition:
      existing?.bufferAccountId === grant.bufferAccountId ? existing.ratePartition : undefined,
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

/** Stores what Buffer said about the budget after a call, replacing the local estimate. */
export const recordRateLimit = internalMutation({
  args: { userId: v.id('users'), rateLimit: v.string() },
  handler: async (ctx, { userId, rateLimit }) => {
    const now = Date.now()
    const { partition, windows } = parseRateLimit(rateLimit, now)
    const connection = await ctx.db
      .query('bufferConnections')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()
    if (connection) {
      await ctx.db.patch(connection._id, {
        lastRateLimit: rateLimit,
        lastRateLimitAt: now,
        ...(partition ? { ratePartition: partition } : {}),
      })
    }
    if (!partition || windows.length === 0) return
    const budget = await ctx.db
      .query('bufferBudgets')
      .withIndex('by_partition', (q) => q.eq('partition', partition))
      .first()
    if (budget) await ctx.db.patch(budget._id, { windows, observedAt: now })
    else await ctx.db.insert('bufferBudgets', { partition, windows, observedAt: now })
  },
})

const priorityValidator = v.union(v.literal('interactive'), v.literal('background'))

/**
 * Reserves calls against the user's Buffer budget before they are made. Mutations run one at a
 * time, so two runs cannot both take the last calls in a window. Until Buffer has reported a
 * budget for this grant, calls are allowed and the first response fills it in.
 */
export const reserveCalls = internalMutation({
  args: { userId: v.id('users'), calls: v.number(), priority: priorityValidator },
  returns: v.union(
    v.object({ ok: v.literal(true) }),
    v.object({ ok: v.literal(false), retryAt: v.number() }),
  ),
  handler: async (ctx, { userId, calls, priority }) => {
    const connection = await ctx.db
      .query('bufferConnections')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()
    const partition = connection?.ratePartition
    if (!partition) return { ok: true as const }
    const budget = await ctx.db
      .query('bufferBudgets')
      .withIndex('by_partition', (q) => q.eq('partition', partition))
      .first()
    if (!budget) return { ok: true as const }
    const result = reserve(budget.windows, calls, priority)
    if (!result.ok) return result
    await ctx.db.patch(budget._id, { windows: result.windows })
    return { ok: true as const }
  },
})

/** Thrown when Buffer's budget has no room; `retryAt` is when the tightest window resets. */
export class BufferBudgetError extends Error {
  constructor(readonly retryAt: number) {
    super(
      `Dispatchlet has used its Buffer API allowance for now. Try again after ${new Date(retryAt).toISOString()}.`,
    )
  }
}

/**
 * Every Buffer API call goes through here: it reserves the call against the budget, makes it,
 * and stores the rate-limit headers Buffer sends back (also when the call fails).
 */
async function callBuffer<T>(
  ctx: ActionCtx,
  userId: Id<'users'>,
  token: string,
  document: string,
  variables?: Record<string, unknown>,
  priority: Priority = 'interactive',
): Promise<T> {
  const reserved = await ctx.runMutation(internal.buffer.reserveCalls, {
    userId,
    calls: 1,
    priority,
  })
  if (!reserved.ok) throw new BufferBudgetError(reserved.retryAt)
  try {
    const { data, rateLimit } = await bufferRequest<T>(token, document, variables)
    if (rateLimit) await ctx.runMutation(internal.buffer.recordRateLimit, { userId, rateLimit })
    return data
  } catch (error) {
    if (error instanceof BufferApiError && error.rateLimit) {
      await ctx.runMutation(internal.buffer.recordRateLimit, {
        userId,
        rateLimit: error.rateLimit,
      })
    }
    throw error
  }
}

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
    const connection = await ctx.db.get(connectionId)
    if (!connection) return
    // Tell the person once, when access is first lost; a new sign-in clears the flag.
    if (needsReauth && !connection.needsReauth) {
      await ctx.scheduler.runAfter(0, internal.email.sendReauth, { userId: connection.userId })
    }
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
    const { account } = await callBuffer<{ account: { organizations: { id: string }[] } }>(
      ctx,
      userId,
      token,
      'query DispatchletOrganizations { account { organizations { id } } }',
    )
    const channels: ChannelRow[] = []
    for (const organization of account.organizations) {
      const data = await callBuffer<{
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
        ctx,
        userId,
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
    const partition = connection.ratePartition
    const budget = partition
      ? await ctx.db
          .query('bufferBudgets')
          .withIndex('by_partition', (q) => q.eq('partition', partition))
          .first()
      : null
    return {
      scope: connection.scope,
      // Windows past their reset are full again, so only current ones are worth showing.
      budget: budget ? budget.windows.filter((window) => window.resetAt > Date.now()) : null,
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
