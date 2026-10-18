import { authTables } from '@convex-dev/auth/server'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  ...authTables,
  /**
   * One Buffer grant per user, from sign-in. Tokens are AES-GCM encrypted (lib/crypto). Buffer's
   * refresh tokens are single-use, so `refreshingAt` is a lock: only one refresh may run at once.
   */
  bufferConnections: defineTable({
    userId: v.id('users'),
    bufferAccountId: v.string(),
    accessTokenEnc: v.string(),
    refreshTokenEnc: v.optional(v.string()),
    expiresAt: v.number(),
    scope: v.string(),
    refreshingAt: v.optional(v.number()),
    needsReauth: v.optional(v.boolean()),
    lastRefreshedAt: v.optional(v.number()),
    /** Buffer's rate-limit headers from the latest call, for the two-account budget check. */
    lastRateLimit: v.optional(v.string()),
    lastRateLimitAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index('by_user', ['userId']),
  /** The text channels in the user's Buffer organizations, refreshed by channel sync. */
  bufferChannels: defineTable({
    userId: v.id('users'),
    organizationId: v.string(),
    channelId: v.string(),
    service: v.string(),
    name: v.string(),
    displayName: v.optional(v.string()),
    avatar: v.optional(v.string()),
    usable: v.boolean(),
    syncedAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_user_channel', ['userId', 'channelId']),
  waitlist: defineTable({
    email: v.string(),
    createdAt: v.number(),
    source: v.string(),
    campaign: v.optional(v.string()),
    confirmedAt: v.optional(v.number()),
    unsubscribedAt: v.optional(v.number()),
    invitedAt: v.optional(v.number()),
    launchEmailSentAt: v.optional(v.number()),
    token: v.string(),
    ip: v.optional(v.string()),
  })
    .index('by_email', ['email'])
    .index('by_token', ['token'])
    .index('by_ip_createdAt', ['ip', 'createdAt']),
})
