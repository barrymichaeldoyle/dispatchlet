import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server'
import { isAllowlisted, isSignupOpen } from './lib/allowlist'
import { decryptSecret, encryptSecret } from './lib/crypto'
import { allowanceFor } from './lib/limits'

/** Who is signed in, and whether they may use the app yet (see lib/allowlist). */
export const viewer = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      email: v.union(v.string(), v.null()),
      name: v.union(v.string(), v.null()),
      bufferId: v.union(v.string(), v.null()),
      timezone: v.union(v.string(), v.null()),
      allowed: v.boolean(),
      ownKey: v.boolean(),
      runsLeft: v.union(v.number(), v.null()),
      dryRunsLeft: v.union(v.number(), v.null()),
      keyInvalid: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const user = await ctx.db.get(userId)
    if (!user) return null
    const account = await ctx.db
      .query('authAccounts')
      .withIndex('userIdAndProvider', (q) => q.eq('userId', userId).eq('provider', 'buffer'))
      .first()
    const email = user.email?.toLowerCase() ?? null
    const bufferId = account?.providerAccountId ?? null
    return {
      email,
      name: user.name ?? null,
      bufferId,
      timezone: user.timezone ?? null,
      allowed: isAllowlisted(bufferId, email),
      ...allowanceFor(user),
      keyInvalid: Boolean(user.anthropicKeyInvalidAt),
    }
  },
})

/** Whether anyone can sign up yet, for the sign-in page's note. */
export const signupOpen = query({
  args: {},
  returns: v.boolean(),
  handler: async () => isSignupOpen(),
})

/** Whether a string is a time zone this runtime knows, such as Africa/Johannesburg. */
export function isTimeZone(value: string): boolean {
  try {
    return (
      value.length > 0 &&
      value.length < 64 &&
      new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone.length > 0
    )
  } catch {
    return false
  }
}

/** Runs are scheduled in this time zone. The app fills it in from the browser on first visit. */
export const setTimezone = mutation({
  args: { timezone: v.string() },
  returns: v.null(),
  handler: async (ctx, { timezone }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not signed in')
    if (!isTimeZone(timezone)) throw new Error('That is not a time zone.')
    await ctx.db.patch(userId, { timezone })
    return null
  },
})

/** The Anthropic key a user's runs use: their own when they added one, else Dispatchlet's. */
export async function keyFor(user: Doc<'users'>): Promise<string | undefined> {
  if (user.anthropicKeyEnc) return await decryptSecret(user.anthropicKeyEnc)
  return process.env.ANTHROPIC_API_KEY
}

/** Stores the person's own Anthropic key, encrypted. An empty key removes it. */
export const setAnthropicKey = action({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, { key }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not signed in')
    const trimmed = key.trim()
    if (trimmed && !/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(trimmed))
      throw new Error('That does not look like an Anthropic API key. They start with sk-ant-.')
    await ctx.runMutation(internal.users.storeKey, {
      userId,
      anthropicKeyEnc: trimmed ? await encryptSecret(trimmed) : undefined,
    })
    return null
  },
})

export const storeKey = internalMutation({
  args: { userId: v.id('users'), anthropicKeyEnc: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { userId, anthropicKeyEnc }) => {
    await ctx.db.patch(userId, { anthropicKeyEnc, anthropicKeyInvalidAt: undefined })
    return null
  },
})

export const markKeyInvalid = internalMutation({
  args: { userId: v.id('users') },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    await ctx.db.patch(userId, { anthropicKeyInvalidAt: Date.now() })
    return null
  },
})

export const emailFor = internalQuery({
  args: { userId: v.id('users') },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { userId }) => (await ctx.db.get(userId))?.email ?? null,
})

/**
 * Deletes everything held for a user: the account, its sign-in records and sessions, the Buffer
 * connection and channels. The waiting list is separate and keeps its own consent.
 */
export const deleteUserData = internalMutation({
  args: { userId: v.id('users') },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const deleteAll = async (rows: { _id: Id<any> }[]) => {
      for (const row of rows) await ctx.db.delete(row._id)
    }
    const sessions = await ctx.db
      .query('authSessions')
      .withIndex('userId', (q) => q.eq('userId', userId))
      .collect()
    for (const session of sessions) {
      await deleteAll(
        await ctx.db
          .query('authRefreshTokens')
          .withIndex('sessionId', (q) => q.eq('sessionId', session._id))
          .collect(),
      )
    }
    await deleteAll(sessions)
    const accounts: Doc<'authAccounts'>[] = await ctx.db
      .query('authAccounts')
      .withIndex('userIdAndProvider', (q) => q.eq('userId', userId))
      .collect()
    for (const account of accounts) {
      await deleteAll(
        await ctx.db
          .query('authVerificationCodes')
          .withIndex('accountId', (q) => q.eq('accountId', account._id))
          .collect(),
      )
    }
    await deleteAll(accounts)
    await deleteAll(
      await ctx.db
        .query('bufferConnections')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect(),
    )
    await deleteAll(
      await ctx.db
        .query('bufferChannels')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect(),
    )
    if (await ctx.db.get(userId)) await ctx.db.delete(userId)
    return null
  },
})

/**
 * Delete account, from settings: revokes Dispatchlet's access at Buffer, then deletes everything.
 * Revoking is attempted first but does not block the deletion if Buffer is unreachable.
 */
export const deleteAccount = action({
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
      revoked = await ctx
        .runAction(internal.buffer.revokeGrant, {
          accessTokenEnc: connection.accessTokenEnc,
          refreshTokenEnc: connection.refreshTokenEnc,
        })
        .catch(() => false)
    }
    await ctx.runMutation(internal.users.deleteUserData, { userId })
    return { revoked }
  },
})
