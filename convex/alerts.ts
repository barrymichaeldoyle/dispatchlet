import { v } from 'convex/values'
import { internalMutation } from './_generated/server'

const MINUTE = 60_000
/** At most one error email every 10 minutes, and 20 a day. */
export const ERROR_ALERT_GAP = 10 * MINUTE
export const ERROR_ALERTS_PER_DAY = 20

/**
 * Whether an error alert email may go out now; records it if so. The alert endpoint has no
 * secret, so this cap is what stops anyone from using it to flood the inbox.
 */
export const claimErrorAlert = internalMutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const now = Date.now()
    const recent = await ctx.db
      .query('alertsSent')
      .withIndex('by_kind_sentAt', (q) =>
        q.eq('kind', 'error').gt('sentAt', now - 24 * 60 * MINUTE),
      )
      .collect()
    const old = await ctx.db
      .query('alertsSent')
      .withIndex('by_kind_sentAt', (q) =>
        q.eq('kind', 'error').lte('sentAt', now - 24 * 60 * MINUTE),
      )
      .take(50)
    for (const row of old) await ctx.db.delete(row._id)
    if (recent.length >= ERROR_ALERTS_PER_DAY) return false
    if (recent.some((row) => row.sentAt > now - ERROR_ALERT_GAP)) return false
    await ctx.db.insert('alertsSent', { kind: 'error', sentAt: now })
    return true
  },
})
