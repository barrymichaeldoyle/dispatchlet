import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from './_generated/server'
import { displayPrefix, generateSecret, hashSecret, TOKEN_PREFIX } from './lib/apiToken'

const scopeValidator = v.union(v.literal('read'), v.literal('write'))
/** Revoked tokens stay in the list this long, so the person can see what was turned off. */
const KEEP_REVOKED_MS = 30 * 86_400_000
/** `lastUsedAt` is written at most this often per token, so a busy caller does not write a row a request. */
const TOUCH_EVERY_MS = 60_000

const tokenView = v.object({
  _id: v.id('apiTokens'),
  name: v.string(),
  scope: scopeValidator,
  prefix: v.string(),
  source: v.string(),
  oauthClientName: v.union(v.string(), v.null()),
  createdAt: v.number(),
  lastUsedAt: v.union(v.number(), v.null()),
  revokedAt: v.union(v.number(), v.null()),
})

function view(t: Doc<'apiTokens'>) {
  return {
    _id: t._id,
    name: t.name,
    scope: t.scope,
    prefix: t.prefix,
    source: t.source,
    oauthClientName: t.oauthClientName ?? null,
    createdAt: t.createdAt,
    lastUsedAt: t.lastUsedAt ?? null,
    revokedAt: t.revokedAt ?? null,
  }
}

/** The person's tokens, newest first, revoked ones last. */
export const list = query({
  args: {},
  returns: v.array(tokenView),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return []
    const rows = await ctx.db
      .query('apiTokens')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .order('desc')
      .collect()
    return [...rows.filter((t) => !t.revokedAt), ...rows.filter((t) => t.revokedAt)].map(view)
  },
})

/**
 * Makes a token for the signed-in person. The token itself is returned once and never stored.
 * Used by settings and, in stage E, by the OAuth consent page through `createForUser`.
 */
export async function createForUser(
  ctx: MutationCtx,
  userId: Id<'users'>,
  args: { name: string; scope: 'read' | 'write'; source: string; oauthClientName?: string },
): Promise<{ id: Id<'apiTokens'>; token: string; prefix: string }> {
  const name = args.name.trim().replace(/\s+/g, ' ')
  if (name.length < 1 || name.length > 40)
    throw new Error('Give the token a name of up to 40 characters.')
  const token = generateSecret(TOKEN_PREFIX)
  const prefix = displayPrefix(token, TOKEN_PREFIX)
  const id = await ctx.db.insert('apiTokens', {
    userId,
    name,
    scope: args.scope,
    hash: await hashSecret(token),
    prefix,
    source: args.source,
    oauthClientName: args.oauthClientName,
    createdAt: Date.now(),
  })
  return { id, token, prefix }
}

export const create = mutation({
  args: { name: v.string(), scope: scopeValidator },
  returns: v.object({ _id: v.id('apiTokens'), token: v.string(), prefix: v.string() }),
  handler: async (ctx, { name, scope }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not signed in')
    const live = (
      await ctx.db
        .query('apiTokens')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect()
    ).filter((t) => !t.revokedAt)
    if (live.length >= 20) throw new Error('Twenty tokens is the limit. Revoke one first.')
    const made = await createForUser(ctx, userId, { name, scope, source: 'settings' })
    return { _id: made.id, token: made.token, prefix: made.prefix }
  },
})

/**
 * The token behind an OAuth grant, made when the person clicks Allow on the consent page (SPEC
 * §44.7). It shows in settings under the client's name and revoking it ends the grant's access.
 */
export const createForOAuth = mutation({
  args: { clientName: v.string(), write: v.boolean() },
  returns: v.object({ _id: v.id('apiTokens'), token: v.string() }),
  handler: async (ctx, { clientName, write }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not signed in')
    const live = (
      await ctx.db
        .query('apiTokens')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect()
    ).filter((t) => !t.revokedAt)
    if (live.length >= 20)
      throw new Error('Twenty tokens is the limit. Revoke one in settings first.')
    const label = clientName.trim().replace(/\s+/g, ' ').slice(0, 40) || 'An assistant'
    const made = await createForUser(ctx, userId, {
      name: label,
      scope: write ? 'write' : 'read',
      source: 'oauth',
      oauthClientName: label,
    })
    return { _id: made.id, token: made.token }
  },
})

export const revoke = mutation({
  args: { id: v.id('apiTokens') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not signed in')
    const token = await ctx.db.get(id)
    if (!token || token.userId !== userId) throw new Error('Token not found')
    if (!token.revokedAt) await ctx.db.patch(id, { revokedAt: Date.now() })
    return null
  },
})

/** The live token for a hash, for the API's bearer check. Revoked tokens are not found. */
export const byHash = internalQuery({
  args: { hash: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id('apiTokens'),
      userId: v.id('users'),
      scope: scopeValidator,
      lastUsedAt: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx, { hash }) => {
    const token = await ctx.db
      .query('apiTokens')
      .withIndex('by_hash', (q) => q.eq('hash', hash))
      .first()
    if (!token || token.revokedAt) return null
    return {
      _id: token._id,
      userId: token.userId,
      scope: token.scope,
      lastUsedAt: token.lastUsedAt ?? null,
    }
  },
})

export const touch = internalMutation({
  args: { id: v.id('apiTokens') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const token = await ctx.db.get(id)
    if (!token) return null
    if (!token.lastUsedAt || Date.now() - token.lastUsedAt >= TOUCH_EVERY_MS)
      await ctx.db.patch(id, { lastUsedAt: Date.now() })
    return null
  },
})

/** Daily: drops tokens revoked over a month ago and stale rate windows. */
export const purge = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - KEEP_REVOKED_MS
    for (const t of await ctx.db.query('apiTokens').collect())
      if (t.revokedAt && t.revokedAt < cutoff) await ctx.db.delete(t._id)
    const stale = Date.now() - 2 * 3_600_000
    for (const w of await ctx.db.query('apiRateWindows').collect())
      if (w.windowStart < stale) await ctx.db.delete(w._id)
    return null
  },
})
