import { authTables } from '@convex-dev/auth/server'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  ...authTables,
  /** Convex Auth's users table, plus the settings the app keeps for each person. */
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    /** IANA time zone, such as Africa/Johannesburg. Runs are scheduled in it. */
    timezone: v.optional(v.string()),
  })
    .index('email', ['email'])
    .index('phone', ['phone']),
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
    /** Buffer's `pk` for this grant's budget: the same for two accounts if the budget is shared. */
    ratePartition: v.optional(v.string()),
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
  /** The latest known Buffer call budget per partition, spent as calls are reserved (lib/budget). */
  bufferBudgets: defineTable({
    partition: v.string(),
    windows: v.array(
      v.object({ name: v.string(), limit: v.number(), remaining: v.number(), resetAt: v.number() }),
    ),
    observedAt: v.number(),
  }).index('by_partition', ['partition']),
  /** When an alert email went out, so the unauthenticated alert endpoint can rate-limit itself. */
  alertsSent: defineTable({ kind: v.string(), sentAt: v.number() }).index('by_kind_sentAt', [
    'kind',
    'sentAt',
  ]),
  /**
   * One row per scheduled or manual run of an automation, and per eval run. Totals are summed from
   * aiCalls as each step finishes, so the live run log and the cost per run come from one place.
   */
  runs: defineTable({
    userId: v.optional(v.id('users')),
    /** Why the run exists: 'eval' (a fixture run from the CLI) now; 'scheduled', 'now', 'dry' later. */
    kind: v.string(),
    /** Which eval fixture (lib/evals), when kind is 'eval'. */
    fixtureId: v.optional(v.number()),
    status: v.string(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    /** The step log, newest last. */
    steps: v.array(v.object({ step: v.string(), at: v.number(), note: v.string() })),
    usage: v.object({
      inputTokens: v.number(),
      outputTokens: v.number(),
      cacheWriteTokens: v.number(),
      cacheReadTokens: v.number(),
      webSearches: v.number(),
      webFetches: v.number(),
    }),
    costUsd: v.number(),
    /** What research found, kept on the run until the stories table exists. */
    result: v.optional(v.any()),
    error: v.optional(v.string()),
  })
    .index('by_user', ['userId'])
    .index('by_kind_startedAt', ['kind', 'startedAt']),
  /** Every model call, with what it cost, so the cost per run is measured and not guessed. */
  aiCalls: defineTable({
    runId: v.optional(v.id('runs')),
    userId: v.optional(v.id('users')),
    purpose: v.string(),
    model: v.string(),
    stopReason: v.union(v.string(), v.null()),
    usage: v.object({
      inputTokens: v.number(),
      outputTokens: v.number(),
      cacheWriteTokens: v.number(),
      cacheReadTokens: v.number(),
      webSearches: v.number(),
      webFetches: v.number(),
    }),
    costUsd: v.number(),
    durationMs: v.number(),
    refusal: v.union(v.string(), v.null()),
    createdAt: v.number(),
  })
    .index('by_run', ['runId'])
    .index('by_createdAt', ['createdAt']),
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
