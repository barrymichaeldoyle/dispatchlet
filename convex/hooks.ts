import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server'
import { automationOf } from './automations'
import { displayPrefix, generateSecret, hashSecret, HOOK_PREFIX } from './lib/apiToken'

/** Inbound hook URLs (SPEC §44.5). The token in the URL is stored hashed, like an API token. */

const hookView = v.object({
  _id: v.id('inboundHooks'),
  automationId: v.id('automations'),
  name: v.string(),
  prefix: v.string(),
  createdAt: v.number(),
  lastUsedAt: v.union(v.number(), v.null()),
  uses: v.number(),
})

function view(h: Doc<'inboundHooks'>) {
  return {
    _id: h._id,
    automationId: h.automationId,
    name: h.name,
    prefix: h.prefix,
    createdAt: h.createdAt,
    lastUsedAt: h.lastUsedAt ?? null,
    uses: h.uses,
  }
}

async function listOf(ctx: QueryCtx | MutationCtx, userId: Id<'users'>) {
  return (
    await ctx.db
      .query('inboundHooks')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .order('desc')
      .collect()
  ).map(view)
}

async function createOf(
  ctx: MutationCtx,
  userId: Id<'users'>,
  automationId: Id<'automations'>,
  name: string,
) {
  await automationOf(ctx, userId, automationId)
  const clean = name.trim().replace(/\s+/g, ' ')
  if (clean.length < 1 || clean.length > 40)
    throw new Error('Give the hook a name of up to 40 characters.')
  const existing = await ctx.db
    .query('inboundHooks')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect()
  if (existing.length >= 20) throw new Error('Twenty hooks is the limit. Delete one first.')
  const token = generateSecret(HOOK_PREFIX)
  const prefix = displayPrefix(token, HOOK_PREFIX)
  const _id = await ctx.db.insert('inboundHooks', {
    userId,
    automationId,
    name: clean,
    hash: await hashSecret(token),
    prefix,
    createdAt: Date.now(),
    uses: 0,
  })
  return { _id, token, prefix }
}

async function removeOf(ctx: MutationCtx, userId: Id<'users'>, id: Id<'inboundHooks'>) {
  const hook = await ctx.db.get(id)
  if (!hook || hook.userId !== userId) throw new Error('Hook not found')
  await ctx.db.delete(id)
  return null
}

export const list = query({
  args: {},
  returns: v.array(hookView),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    return userId ? await listOf(ctx, userId) : []
  },
})

export const create = mutation({
  args: { automationId: v.id('automations'), name: v.string() },
  returns: v.object({ _id: v.id('inboundHooks'), token: v.string(), prefix: v.string() }),
  handler: async (ctx, { automationId, name }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not signed in')
    return await createOf(ctx, userId, automationId, name)
  },
})

export const remove = mutation({
  args: { id: v.id('inboundHooks') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not signed in')
    return await removeOf(ctx, userId, id)
  },
})

export const listFor = internalQuery({
  args: { userId: v.id('users') },
  returns: v.array(hookView),
  handler: async (ctx, { userId }) => await listOf(ctx, userId),
})

export const createFor = internalMutation({
  args: { userId: v.id('users'), automationId: v.id('automations'), name: v.string() },
  returns: v.object({ _id: v.id('inboundHooks'), token: v.string(), prefix: v.string() }),
  handler: async (ctx, { userId, automationId, name }) =>
    await createOf(ctx, userId, automationId, name),
})

export const removeFor = internalMutation({
  args: { userId: v.id('users'), id: v.id('inboundHooks') },
  returns: v.null(),
  handler: async (ctx, { userId, id }) => await removeOf(ctx, userId, id),
})

export const byHash = internalQuery({
  args: { hash: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id('inboundHooks'),
      userId: v.id('users'),
      automationId: v.id('automations'),
    }),
  ),
  handler: async (ctx, { hash }) => {
    const hook = await ctx.db
      .query('inboundHooks')
      .withIndex('by_hash', (q) => q.eq('hash', hash))
      .first()
    return hook ? { _id: hook._id, userId: hook.userId, automationId: hook.automationId } : null
  },
})

export const touch = internalMutation({
  args: { id: v.id('inboundHooks') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const hook = await ctx.db.get(id)
    if (hook) await ctx.db.patch(id, { lastUsedAt: Date.now(), uses: hook.uses + 1 })
    return null
  },
})
