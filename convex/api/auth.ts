/**
 * Bearer-token auth and rate limits for the API (SPEC §44.2, §44.3). `authenticate` returns the
 * caller or a ready-made error response, so every route starts the same way.
 */
import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import type { ActionCtx } from '../_generated/server'
import { bearerFrom, hashSecret, looksLikeSecret, TOKEN_PREFIX } from '../lib/apiToken'
import { errorResponse, type RateHeaders } from './http'

export type Caller = {
  userId: Id<'users'>
  tokenId: Id<'apiTokens'>
  scope: 'read' | 'write'
  rate: RateHeaders
}

export async function authenticate(ctx: ActionCtx, req: Request): Promise<Caller | Response> {
  const token = bearerFrom(req.headers.get('authorization'))
  if (!token || !looksLikeSecret(token, TOKEN_PREFIX))
    return errorResponse(401, 'unauthorized', 'Send a Dispatchlet API token as a Bearer token.')
  const found = await ctx.runQuery(internal.tokens.byHash, { hash: await hashSecret(token) })
  if (!found)
    return errorResponse(401, 'unauthorized', 'That token is not valid or has been revoked.')
  const rate = await ctx.runMutation(internal.api.rate.check, {
    tokenKey: found._id,
    userKey: found.userId,
  })
  const headers: RateHeaders = { limit: rate.limit, remaining: rate.remaining, reset: rate.reset }
  if (!rate.ok)
    return errorResponse(429, 'rate_limited', 'Too many requests. Wait for the window to reset.', {
      rate: headers,
      retryAfter: Math.max(1, rate.reset - Math.floor(Date.now() / 1000)),
    })
  if (!found.lastUsedAt || Date.now() - found.lastUsedAt >= 60_000)
    await ctx.runMutation(internal.tokens.touch, { id: found._id })
  return { userId: found.userId, tokenId: found._id, scope: found.scope, rate: headers }
}

/** A `write` check for a route that changes something. */
export function requireWrite(caller: Caller): Response | null {
  if (caller.scope === 'write') return null
  return errorResponse(
    403,
    'forbidden',
    'This token can only read. Make one with the write scope.',
    {
      rate: caller.rate,
    },
  )
}
