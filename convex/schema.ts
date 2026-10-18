import { authTables } from '@convex-dev/auth/server'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  ...authTables,
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
