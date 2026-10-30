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
import { emit } from './webhooks'

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
    const minutes = Math.max(1, Math.ceil((retryAt - Date.now()) / 60_000))
    super(
      `Buffer is busy with Dispatchlet’s requests right now. Try again in ${minutes === 1 ? 'a minute' : minutes < 60 ? `${minutes} minutes` : `${Math.ceil(minutes / 60)} hours`}.`,
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
      await ctx.scheduler.runAfter(0, internal.push.notify, {
        userId: connection.userId,
        title: 'Dispatchlet lost access to Buffer',
        body: 'Reconnect Buffer so your automations can post again.',
        url: '/app/settings',
        tag: 'reauth',
      })
      await emit(ctx, connection.userId, 'buffer.reauth_needed', {})
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
  problem?: string
  maxLength?: number
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
        problem: v.optional(v.string()),
        maxLength: v.optional(v.number()),
      }),
    ),
    otherServices: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { userId, channels, otherServices }) => {
    const now = Date.now()
    const connection = await ctx.db
      .query('bufferConnections')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()
    if (connection && otherServices) await ctx.db.patch(connection._id, { otherServices })
    const existing = await ctx.db
      .query('bufferChannels')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    const keep = new Set(channels.map((channel) => channel.channelId))
    for (const row of existing) if (!keep.has(row.channelId)) await ctx.db.delete(row._id)
    for (const channel of channels) {
      const row = existing.find((r) => r.channelId === channel.channelId)
      // Optional fields are named so a value Buffer stopped sending is cleared, not kept.
      const fields = {
        ...channel,
        displayName: channel.displayName,
        avatar: channel.avatar,
        problem: channel.problem,
        maxLength: channel.maxLength,
        syncedAt: now,
      }
      if (row) await ctx.db.patch(row._id, fields)
      else await ctx.db.insert('bufferChannels', { userId, ...channel, syncedAt: now })
    }
  },
})

/** A channel's own limit when Buffer reports one: Premium X is 25,000; Mastodon servers vary. */
function channelLimit(
  service: string,
  metadata?: { subscriptionType?: string | null; maxCharacters?: number | null } | null,
): number | undefined {
  if (service === 'twitter' && metadata?.subscriptionType === 'Premium') return 25_000
  if (service === 'mastodon' && metadata?.maxCharacters) return metadata.maxCharacters
  return undefined
}

/** Reads the user's organizations and their text channels from Buffer and stores them. */
export const syncChannels = action({
  args: {},
  returns: v.object({ channels: v.number() }),
  handler: async (ctx) => await syncChannelsFor(ctx, await allowlistedUser(ctx)),
})

/** Reads the person's organizations and text channels from Buffer and stores them. */
export async function syncChannelsFor(
  ctx: ActionCtx,
  userId: Id<'users'>,
): Promise<{ channels: number }> {
  {
    const { token } = await accessTokenFor(ctx, userId)
    const { account } = await callBuffer<{ account: { organizations: { id: string }[] } }>(
      ctx,
      userId,
      token,
      'query DispatchletOrganizations { account { organizations { id } } }',
    )
    const channels: ChannelRow[] = []
    const otherServices = new Set<string>()
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
          metadata?: { subscriptionType?: string | null; maxCharacters?: number | null } | null
        }[]
      }>(
        ctx,
        userId,
        token,
        `query DispatchletChannels($orgId: OrganizationId!) {
          channels(input: { organizationId: $orgId }) {
            id name displayName service avatar isDisconnected isLocked
            metadata {
              ... on TwitterMetadata { subscriptionType }
              ... on MastodonMetadata { maxCharacters }
            }
          }
        }`,
        { orgId: organization.id },
      )
      for (const channel of data.channels) {
        if (!TEXT_SERVICES.has(channel.service)) {
          otherServices.add(channel.service)
          continue
        }
        channels.push({
          organizationId: organization.id,
          channelId: channel.id,
          service: channel.service,
          name: channel.name,
          displayName: channel.displayName ?? undefined,
          avatar: channel.avatar ?? undefined,
          usable: !channel.isDisconnected && !channel.isLocked,
          problem: channel.isDisconnected
            ? 'disconnected'
            : channel.isLocked
              ? 'locked'
              : undefined,
          maxLength: channelLimit(channel.service, channel.metadata),
        })
      }
    }
    await ctx.runMutation(internal.buffer.saveChannels, {
      userId,
      channels,
      otherServices: [...otherServices].sort(),
    })
    return { channels: channels.length }
  }
}

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
      otherServices: connection.otherServices ?? [],
      channels: channels.map((channel) => ({
        channelId: channel.channelId,
        service: channel.service,
        name: channel.displayName ?? channel.name,
        usable: channel.usable,
        problem: channel.problem ?? null,
        syncedAt: channel.syncedAt,
      })),
    }
  },
})

/**
 * A Buffer call for another module, with the token looked up and 401 handled: Buffer rejecting the
 * token means the grant is gone, so the connection is marked and the person emailed once.
 */
export async function bufferCallFor<T>(
  ctx: ActionCtx,
  userId: Id<'users'>,
  document: string,
  variables?: Record<string, unknown>,
  priority: Priority = 'background',
): Promise<T> {
  const { token } = await accessTokenFor(ctx, userId)
  try {
    return await callBuffer<T>(ctx, userId, token, document, variables, priority)
  } catch (error) {
    if (error instanceof BufferApiError && error.status === 401) {
      const connection = await ctx.runQuery(internal.buffer.connectionFor, { userId })
      if (connection)
        await ctx.runMutation(internal.buffer.releaseRefresh, {
          connectionId: connection._id,
          needsReauth: true,
        })
    }
    throw error
  }
}

type MutationPayload = { __typename: string; message?: string }

/** The "Dispatchlet" tag in an organization, created the first time it is needed. */
/**
 * The tag every post gets, so it can be found in Buffer. Dev sets BUFFER_TAG_NAME to
 * "Dispatchlet dev": dev and production share Barry's Buffer account, and test posts should be
 * easy to tell apart and clear.
 */
export function tagName(): string {
  return process.env.BUFFER_TAG_NAME?.trim() || 'Dispatchlet'
}

/** BUFFER_DRAFTS_ONLY=true (set on dev) saves every post as a draft whatever the posting mode. */
export function draftsOnly(): boolean {
  return process.env.BUFFER_DRAFTS_ONLY?.trim().toLowerCase() === 'true'
}

export async function ensureTag(
  ctx: ActionCtx,
  userId: Id<'users'>,
  organizationId: string,
): Promise<string | null> {
  const connection = await ctx.runQuery(internal.buffer.connectionFor, { userId })
  const name = tagName()
  const known = connection?.tags?.find(
    (t) => t.organizationId === organizationId && (t.name ?? 'Dispatchlet') === name,
  )
  if (known) return known.tagId
  let tagId: string | null = null
  try {
    const { createTag } = await bufferCallFor<{
      createTag: MutationPayload & { tag?: { id: string } }
    }>(
      ctx,
      userId,
      `mutation DispatchletTag($orgId: OrganizationId!, $name: String!) {
        createTag(input: { organizationId: $orgId, tag: { name: $name, color: "#0F6E56" } }) {
          __typename
          ... on TagActionSuccess { tag { id name } }
          ... on DuplicateError { message }
          ... on MutationError { message }
        }
      }`,
      { orgId: organizationId, name },
    )
    tagId = createTag.tag?.id ?? null
    if (!tagId && createTag.__typename === 'DuplicateError') {
      const { tagsV2 } = await bufferCallFor<{
        tagsV2: { edges: { node: { id: string; name: string } }[] }
      }>(
        ctx,
        userId,
        `query DispatchletTags($orgId: OrganizationId!) {
          tagsV2(input: { organizationId: $orgId }) { edges { node { id name } } }
        }`,
        { orgId: organizationId },
      )
      tagId = tagsV2.edges.find((e) => e.node.name === name)?.node.id ?? null
    }
  } catch (error) {
    // Tags are a nicety; a post without one is still a post.
    console.log(`Tag not available: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
  if (tagId && connection)
    await ctx.runMutation(internal.buffer.storeTag, {
      connectionId: connection._id,
      organizationId,
      tagId,
      name,
    })
  return tagId
}

export const storeTag = internalMutation({
  args: {
    connectionId: v.id('bufferConnections'),
    organizationId: v.string(),
    tagId: v.string(),
    name: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { connectionId, organizationId, tagId, name }) => {
    const connection = await ctx.db.get(connectionId)
    if (!connection) return null
    const tags = (connection.tags ?? []).filter((t) => t.organizationId !== organizationId)
    await ctx.db.patch(connectionId, { tags: [...tags, { organizationId, tagId, name }] })
    return null
  },
})

/** Which channels have hit Buffer's daily posting limit, before a run publishes. */
export async function channelsAtLimit(
  ctx: ActionCtx,
  userId: Id<'users'>,
  channelIds: string[],
): Promise<Set<string>> {
  try {
    const { dailyPostingLimits } = await bufferCallFor<{
      dailyPostingLimits: { channelId: string; isAtLimit: boolean }[]
    }>(
      ctx,
      userId,
      `query DispatchletLimits($ids: [ChannelId!]!) {
        dailyPostingLimits(input: { channelIds: $ids }) { channelId isAtLimit }
      }`,
      { ids: channelIds },
    )
    return new Set(dailyPostingLimits.filter((l) => l.isAtLimit).map((l) => l.channelId))
  } catch {
    return new Set()
  }
}

export type CreatePostInput = {
  channelId: string
  service: string
  text: string
  thread?: string[]
  linkAttachment?: { url: string; title: string; description: string }
  mode: 'draft' | 'queue' | 'spread'
  dueAt?: number
  tagId: string | null
}

export type CreatedPost = {
  id: string
  status: string
  dueAt: string | null
  externalLink: string | null
}

/** Thrown when Buffer accepted the request but refused the post; `kind` says whether to go on. */
export class BufferPostError extends Error {
  constructor(
    message: string,
    readonly kind: 'limit' | 'invalid' | 'other',
  ) {
    super(message)
  }
}

/** One post into Buffer, as a draft, into the queue, or at a time (SPEC §24.5). */
export async function createBufferPost(
  ctx: ActionCtx,
  userId: Id<'users'>,
  post: CreatePostInput,
): Promise<CreatedPost> {
  const metadata: Record<string, unknown> = {}
  if (post.service === 'twitter') {
    metadata.twitter = {
      isAiGenerated: true,
      ...(post.thread?.length
        ? { thread: [post.text, ...post.thread].map((text) => ({ text })) }
        : {}),
    }
  } else if (post.linkAttachment && post.service === 'linkedin') {
    metadata.linkedin = { linkAttachment: post.linkAttachment }
  } else if (post.linkAttachment && (post.service === 'threads' || post.service === 'bluesky')) {
    metadata[post.service] = {
      linkAttachment: { url: post.linkAttachment.url, title: post.linkAttachment.title },
    }
  }
  const input: Record<string, unknown> = {
    channelId: post.channelId,
    text: post.text,
    schedulingType: 'automatic',
    aiAssisted: true,
    source: 'dispatchlet',
    ...(post.tagId ? { tagIds: [post.tagId] } : {}),
    ...(Object.keys(metadata).length ? { metadata } : {}),
    ...(post.mode === 'draft' || draftsOnly()
      ? { mode: 'addToQueue', saveToDraft: true }
      : post.mode === 'queue'
        ? { mode: 'addToQueue' }
        : { mode: 'customScheduled', dueAt: new Date(post.dueAt ?? Date.now()).toISOString() }),
  }
  const { createPost } = await bufferCallFor<{
    createPost: MutationPayload & {
      post?: { id: string; status: string; dueAt: string | null; externalLink: string | null }
    }
  }>(
    ctx,
    userId,
    `mutation DispatchletCreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        __typename
        ... on PostActionSuccess { post { id status dueAt externalLink } }
        ... on LimitReachedError { message }
        ... on InvalidInputError { message }
        ... on MutationError { message }
      }
    }`,
    { input },
  )
  if (createPost.post) return createPost.post
  const kind =
    createPost.__typename === 'LimitReachedError'
      ? 'limit'
      : createPost.__typename === 'InvalidInputError'
        ? 'invalid'
        : 'other'
  throw new BufferPostError(createPost.message ?? `Buffer returned ${createPost.__typename}`, kind)
}

/** Moves a draft into the queue (SPEC §24.6). Returns the post's new status. */
export async function approveBufferPost(
  ctx: ActionCtx,
  userId: Id<'users'>,
  bufferPostId: string,
): Promise<string> {
  const { editPost } = await bufferCallFor<{
    editPost: MutationPayload & { post?: { id: string; status: string } }
  }>(
    ctx,
    userId,
    `mutation DispatchletApprove($id: PostId!) {
      editPost(input: { id: $id, saveToDraft: false, mode: addToQueue }) {
        __typename
        ... on PostActionSuccess { post { id status } }
        ... on MutationError { message }
      }
    }`,
    { id: bufferPostId },
    'interactive',
  )
  if (editPost.post) return editPost.post.status
  throw new BufferPostError(editPost.message ?? 'Buffer did not move the post', 'other')
}

/** Replaces a draft's text in Buffer and keeps it a draft. */
export async function editBufferPostText(
  ctx: ActionCtx,
  userId: Id<'users'>,
  bufferPostId: string,
  text: string,
): Promise<void> {
  const { editPost } = await bufferCallFor<{
    editPost: MutationPayload & { post?: { id: string; status: string } }
  }>(
    ctx,
    userId,
    `mutation DispatchletEditText($id: PostId!, $text: String!) {
      editPost(input: { id: $id, text: $text, saveToDraft: true }) {
        __typename
        ... on PostActionSuccess { post { id status } }
        ... on MutationError { message }
      }
    }`,
    { id: bufferPostId, text },
    'interactive',
  )
  if (!editPost.post)
    throw new BufferPostError(editPost.message ?? 'Buffer did not save the change', 'other')
}

/** The current status of posts Dispatchlet created, one query per organization (SPEC §24.7). */
export async function postStatuses(
  ctx: ActionCtx,
  userId: Id<'users'>,
  organizationId: string,
  channelIds: string[],
  since: number,
): Promise<
  {
    id: string
    status: string
    sentAt: string | null
    externalLink: string | null
    error: string | null
  }[]
> {
  const { posts } = await bufferCallFor<{
    posts: {
      edges: {
        node: {
          id: string
          status: string
          sentAt: string | null
          externalLink: string | null
          error: { message: string } | null
        }
      }[]
    }
  }>(
    ctx,
    userId,
    `query DispatchletStatus($orgId: OrganizationId!, $ids: [ChannelId!], $since: DateTime!) {
      posts(first: 50, input: { # keep in step with STATUS_PAGE in status.ts
        organizationId: $orgId,
        filter: { channelIds: $ids, createdAt: { start: $since } },
        sort: [{ field: createdAt, direction: desc }]
      }) {
        edges { node { id status sentAt externalLink error { message } } }
      }
    }`,
    { orgId: organizationId, ids: channelIds, since: new Date(since).toISOString() },
  )
  return posts.edges.map((e) => ({ ...e.node, error: e.node.error?.message ?? null }))
}

export type PostMetric = { type: string; value: number; unit: string }

/** A sent post's metrics (SPEC §24.8). One call per post, so the caller rations them. */
export async function postMetrics(
  ctx: ActionCtx,
  userId: Id<'users'>,
  bufferPostId: string,
): Promise<{ metrics: PostMetric[]; updatedAt: string | null } | null> {
  const { post } = await bufferCallFor<{
    post: { metrics: PostMetric[] | null; metricsUpdatedAt: string | null } | null
  }>(
    ctx,
    userId,
    `query DispatchletMetrics($id: PostId!) {
      post(input: { id: $id }) { id metrics { type value unit } metricsUpdatedAt }
    }`,
    { id: bufferPostId },
  )
  if (!post) return null
  return { metrics: post.metrics ?? [], updatedAt: post.metricsUpdatedAt }
}

/**
 * A two-part thread saved as a draft on one channel, to confirm Buffer takes the thread metadata.
 * Internal only: `npx convex run buffer:probeThread '{"userId": "...", "channelId": "..."}'`.
 */
export const probeThread = internalAction({
  args: { userId: v.id('users'), channelId: v.string() },
  returns: v.object({ id: v.string(), status: v.string() }),
  handler: async (ctx, { userId, channelId }) => {
    const created = await createBufferPost(ctx, userId, {
      channelId,
      service: 'twitter',
      text: 'Dispatchlet thread check, part one. This draft was made to confirm threads reach Buffer in one piece.',
      thread: [
        'Part two. If you can read this under the first part in Buffer, threads work. Delete me.',
      ],
      mode: 'draft',
      tagId: null,
    })
    return { id: created.id, status: created.status }
  },
})
