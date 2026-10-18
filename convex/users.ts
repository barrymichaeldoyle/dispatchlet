import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'
import { query } from './_generated/server'
import { isAllowlisted } from './lib/allowlist'

/** Who is signed in, and whether they may use the app yet (see lib/allowlist). */
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
    return { email, name: user.name ?? null, bufferId, allowed: isAllowlisted(bufferId, email) }
  },
})
