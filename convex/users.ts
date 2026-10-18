import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'
import { query } from './_generated/server'

/** Comma-separated values from a Convex env var, trimmed and lower-cased. */
function listFromEnv(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Who is signed in, and whether they may use the app yet. Until launch only Buffer accounts on
 * the allowlist get past sign-in: `ALLOWED_BUFFER_IDS` (Buffer account IDs) or `ALLOWED_EMAILS`.
 */
export const viewer = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      email: v.union(v.string(), v.null()),
      name: v.union(v.string(), v.null()),
      bufferId: v.union(v.string(), v.null()),
      allowed: v.boolean(),
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
    const allowed =
      (bufferId !== null && listFromEnv('ALLOWED_BUFFER_IDS').includes(bufferId.toLowerCase())) ||
      (email !== null && listFromEnv('ALLOWED_EMAILS').includes(email))
    return { email, name: user.name ?? null, bufferId, allowed }
  },
})
