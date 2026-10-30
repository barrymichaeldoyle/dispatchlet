import { authTables } from '@convex-dev/auth/server'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export const usageValidator = v.object({
  inputTokens: v.number(),
  outputTokens: v.number(),
  cacheWriteTokens: v.number(),
  cacheReadTokens: v.number(),
  webSearches: v.number(),
  webFetches: v.number(),
})

export const cadenceValidator = v.object({
  preset: v.union(v.literal('daily'), v.literal('weekly')),
  time: v.string(),
  weekday: v.union(v.string(), v.null()),
})

/** The seven setup answers (lib/ai/setup), as the automation keeps them. */
export const setupValidator = v.object({
  research: v.string(),
  services: v.array(v.string()),
  avoid: v.string(),
  sources: v.array(v.string()),
  onlyTheseSources: v.boolean(),
  cadence: cadenceValidator,
  maxStories: v.number(),
  postingMode: v.union(v.literal('draft'), v.literal('queue')),
})

/** A story a caller asks a run to cover, from the API, an inbound hook or MCP. */
export const hintValidator = v.object({
  title: v.string(),
  url: v.optional(v.string()),
  notes: v.optional(v.string()),
})

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
    /** Runs and dry runs used on the free allowance (lib/limits). */
    freeRunsUsed: v.optional(v.number()),
    freeDryRunsUsed: v.optional(v.number()),
    /** Playbooks written on Dispatchlet's key today (UTC day), capped so a loop cannot burn the key. */
    generationDay: v.optional(v.string()),
    generationsToday: v.optional(v.number()),
    /** The person's own Anthropic key, AES-GCM encrypted, which lifts the run allowance. */
    anthropicKeyEnc: v.optional(v.string()),
    anthropicKeyInvalidAt: v.optional(v.number()),
    /** When to be told after a run: every, drafts (only when drafts wait), problems, never. */
    emailPrefs: v.optional(v.string()),
    /** Whether that goes by email. Push goes to every device with a subscription. */
    emailEnabled: v.optional(v.boolean()),
    /** Set once, so the first-run milestones are only said once. */
    firstPlaybookAt: v.optional(v.number()),
    firstPostAt: v.optional(v.number()),
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
    /** Networks in the Buffer account that Dispatchlet cannot post to, such as instagram. */
    otherServices: v.optional(v.array(v.string())),
    /** The "Dispatchlet" tag id in each Buffer organization, created on first publish. */
    tags: v.optional(
      v.array(
        v.object({ organizationId: v.string(), tagId: v.string(), name: v.optional(v.string()) }),
      ),
    ),
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
    /** Why it is not usable, from Buffer: disconnected or locked (over the plan's channel limit). */
    problem: v.optional(v.string()),
    /** The channel's own post limit when Buffer reports one (Premium X, a Mastodon server). */
    maxLength: v.optional(v.number()),
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
  /** An automation: the setup answers that are configuration, plus its schedule state. */
  automations: defineTable({
    userId: v.id('users'),
    name: v.string(),
    /** generating (playbook on its way), ready (never enabled), active, paused, failed (needs a look). */
    status: v.string(),
    setup: setupValidator,
    channelIds: v.array(v.string()),
    cadence: cadenceValidator,
    timezone: v.string(),
    postingMode: v.string(),
    maxPostsPerRun: v.number(),
    playbookVersionId: v.optional(v.id('playbookVersions')),
    /** Why generation failed, shown on the setup screen. */
    generationError: v.optional(v.string()),
    /** When the next run really starts, after spreading a busy minute (automations.spreadStart). */
    nextRunAt: v.optional(v.number()),
    /** The time the person set for it, which is what the app shows. */
    nextRunSetFor: v.optional(v.number()),
    scheduledFnId: v.optional(v.id('_scheduled_functions')),
    lastRunAt: v.optional(v.number()),
    consecutiveFailures: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index('by_user', ['userId'])
    .index('by_nextRunAt', ['nextRunAt']),
  /** Every saved playbook, newest version highest. A run keeps the version it started with. */
  playbookVersions: defineTable({
    automationId: v.id('automations'),
    version: v.number(),
    playbook: v.any(),
    text: v.string(),
    createdBy: v.string(),
    createdAt: v.number(),
  }).index('by_automation_version', ['automationId', 'version']),
  /**
   * One row per run of an automation (scheduled, run now, dry run) and per eval run. Totals are
   * summed from aiCalls as each step finishes, so the live run log and the cost per run come from
   * one place.
   */
  runs: defineTable({
    userId: v.optional(v.id('users')),
    automationId: v.optional(v.id('automations')),
    playbookVersionId: v.optional(v.id('playbookVersions')),
    /** scheduled, now, dry, or eval (a fixture run from the CLI). */
    kind: v.string(),
    fixtureId: v.optional(v.number()),
    /** researching, writing, publishing, done, failed, skipped. */
    status: v.string(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    /** The step log, newest last. */
    steps: v.array(v.object({ step: v.string(), at: v.number(), note: v.string() })),
    usage: usageValidator,
    costUsd: v.number(),
    /** Counts for the list views. */
    found: v.optional(v.number()),
    kept: v.optional(v.number()),
    posted: v.optional(v.number()),
    /** What research found, kept on eval runs. */
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    /** Set when the person shares the run; anyone with the link can read it. */
    shareToken: v.optional(v.string()),
    /** Where the run was started from: schedule, app, api, hook or mcp. */
    startedBy: v.optional(v.string()),
    /** A story the caller asked this run to cover (API, inbound hook, MCP). */
    hint: v.optional(hintValidator),
    /** Charged to the free allowance, so a failure on Dispatchlet's side can give it back. */
    freeRun: v.optional(v.boolean()),
  })
    .index('by_user', ['userId'])
    .index('by_automation_startedAt', ['automationId', 'startedAt'])
    .index('by_kind_startedAt', ['kind', 'startedAt'])
    .index('by_shareToken', ['shareToken']),
  /** Every story a run considered, with the decision, so the next run never repeats one. */
  stories: defineTable({
    automationId: v.id('automations'),
    runId: v.id('runs'),
    title: v.string(),
    canonicalUrl: v.string(),
    source: v.string(),
    publishedAt: v.string(),
    summary: v.string(),
    whyItMatters: v.string(),
    keyFacts: v.array(v.string()),
    confidence: v.number(),
    /** kept, skipped_dup, skipped_quality, skipped_limit, dry (kept on a dry run, not covered). */
    decision: v.string(),
    reason: v.string(),
    dupOf: v.optional(v.id('stories')),
    /** Buffer's idea id once the person saved this story to their Ideas board. */
    ideaId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_run', ['runId'])
    .index('by_automation_decision', ['automationId', 'decision'])
    .index('by_automation_url', ['automationId', 'canonicalUrl']),
  /** Every post written, and what Buffer did with it. */
  posts: defineTable({
    userId: v.id('users'),
    automationId: v.id('automations'),
    runId: v.id('runs'),
    storyId: v.id('stories'),
    channelId: v.string(),
    service: v.string(),
    text: v.string(),
    thread: v.optional(v.array(v.string())),
    linkAttachment: v.optional(
      v.object({ url: v.string(), title: v.string(), description: v.string() }),
    ),
    /** dry (never sent), rejected (failed a check), draft, queued, scheduled, sent, failed. */
    status: v.string(),
    reason: v.optional(v.string()),
    bufferPostId: v.optional(v.string()),
    bufferStatus: v.optional(v.string()),
    externalLink: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    approveToken: v.optional(v.string()),
    /** Buffer's metrics for a sent post, fetched daily from a day after it went out. */
    metrics: v.optional(
      v.array(v.object({ type: v.string(), value: v.number(), unit: v.string() })),
    ),
    metricsUpdatedAt: v.optional(v.number()),
    /** When the status poll last asked Buffer about this post (status.dueForCheck). */
    statusCheckedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_run', ['runId'])
    .index('by_user_createdAt', ['userId', 'createdAt'])
    .index('by_createdAt', ['createdAt'])
    .index('by_approveToken', ['approveToken'])
    .index('by_bufferPostId', ['bufferPostId']),
  /** Every model call, with what it cost, so the cost per run is measured and not guessed. */
  aiCalls: defineTable({
    runId: v.optional(v.id('runs')),
    userId: v.optional(v.id('users')),
    purpose: v.string(),
    model: v.string(),
    stopReason: v.union(v.string(), v.null()),
    usage: usageValidator,
    costUsd: v.number(),
    durationMs: v.number(),
    refusal: v.union(v.string(), v.null()),
    createdAt: v.number(),
  })
    .index('by_run', ['runId'])
    .index('by_createdAt', ['createdAt']),
  /** One row per device that asked for push, as the browser's PushSubscription. */
  pushSubscriptions: defineTable({
    userId: v.id('users'),
    endpoint: v.string(),
    keys: v.object({ p256dh: v.string(), auth: v.string() }),
    userAgent: v.optional(v.string()),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index('by_user', ['userId'])
    .index('by_endpoint', ['endpoint']),
  /**
   * Personal API tokens (SPEC §44.2). Only the SHA-256 hash is stored; the prefix is shown in
   * settings. `source` says whether the person made it or an OAuth consent did.
   */
  apiTokens: defineTable({
    userId: v.id('users'),
    name: v.string(),
    scope: v.union(v.literal('read'), v.literal('write')),
    hash: v.string(),
    prefix: v.string(),
    source: v.string(),
    oauthClientName: v.optional(v.string()),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index('by_hash', ['hash'])
    .index('by_user', ['userId']),
  /** Fixed-window request counts for the API: one row per token-minute and per user-hour. */
  apiRateWindows: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index('by_key', ['key']),
  /** An outbound webhook (SPEC §44.4). The signing secret is AES-GCM encrypted. */
  webhooks: defineTable({
    userId: v.id('users'),
    url: v.string(),
    secretEnc: v.string(),
    events: v.array(v.string()),
    automationId: v.optional(v.id('automations')),
    active: v.boolean(),
    createdAt: v.number(),
    lastDeliveryAt: v.optional(v.number()),
    lastStatus: v.optional(v.string()),
    failedInARow: v.number(),
  }).index('by_user', ['userId']),
  /** One row per attempt series: the payload, the latest attempt and what the receiver said. */
  webhookDeliveries: defineTable({
    webhookId: v.id('webhooks'),
    userId: v.id('users'),
    event: v.string(),
    payload: v.string(),
    attempt: v.number(),
    /** pending, ok, failed. */
    status: v.string(),
    responseStatus: v.optional(v.number()),
    error: v.optional(v.string()),
    nextAttemptAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_webhook_createdAt', ['webhookId', 'createdAt'])
    .index('by_user', ['userId'])
    .index('by_createdAt', ['createdAt']),
  /** Inbound hook URLs (SPEC §44.5): a token in the URL starts a run on one automation. */
  inboundHooks: defineTable({
    userId: v.id('users'),
    automationId: v.id('automations'),
    name: v.string(),
    hash: v.string(),
    prefix: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    uses: v.number(),
  })
    .index('by_hash', ['hash'])
    .index('by_user', ['userId'])
    .index('by_automation', ['automationId']),
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
