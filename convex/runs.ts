import { AuthenticationError } from '@anthropic-ai/sdk'
import { getAuthUserId } from '@convex-dev/auth/server'
import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server'
import { addExcludeRuleFor, ownAutomation, scheduleNext, type PostingMode } from './automations'
import { isAllowlisted } from './lib/allowlist'
import { nextRunAt } from './lib/schedule'
import {
  BufferBudgetError,
  BufferPostError,
  channelQueues,
  channelsAtLimit,
  createBufferIdea,
  createBufferPost,
  ensureTag,
} from './buffer'
import { BufferApiError } from './lib/buffer'
import {
  anthropicClient,
  callStructured,
  modelFor,
  STRUCTURED_MAX_TOKENS,
  type CallRecord,
} from './lib/ai/client'
import { EMPTY_USAGE } from './lib/ai/pricing'
import {
  allowedDomains,
  briefFromPlaybook,
  historicalProblem,
  redate,
  researchSystemFor,
  researchTools,
  ResearchResult,
  researchUserMessage,
  type Candidate,
} from './lib/ai/research'
import type { Service } from './lib/ai/setup'
import {
  checkPost,
  overBy,
  provenPosts,
  repairUserMessage,
  SERVICE_LIMITS,
  textLimitFor,
  trimToFit,
  type PostDraft,
  type TargetChannel,
  withLink,
  withoutLink,
  WRITE_SYSTEM,
  WriteResult,
  writeUserMessage,
} from './lib/ai/write'
import { canonicalUrl, duplicateOf } from './lib/dedupe'
import { hostOfUrl, limitReason, SOURCE_FAILURES, toolNote, type ToolEvent } from './lib/runLog'
import { allowanceFor, globalDailyCapUsd } from './lib/limits'
import {
  datedSlots,
  freeSlots,
  localDate,
  PLAN_HORIZON_DAYS,
  PLAN_LEAD_MS,
  PLAN_SELECTION_LEAD_MS,
  datedTargets,
  type PublicationPlan,
  type QueueSchedule,
} from './lib/plan'
import { type Playbook, serviceLabel } from './lib/playbook'
import { keyFor } from './users'
import { postView } from './views'
import { emit } from './webhooks'

/** Stories below this confidence are never posted (SPEC §25). */
const MIN_CONFIDENCE = 0.5
/**
 * A story the run was asked to cover (a hook, the API, MCP) is kept above this instead. Below it,
 * research found the page does not back the story up, so it is skipped with that reason.
 */
const MIN_REQUESTED_CONFIDENCE = 0.25
/** Spread mode: posts in one run go out at least this far apart, starting soon. */
const SPREAD_GAP_MS = 2 * 60 * 60_000
const SPREAD_FIRST_MS = 10 * 60_000
/** Post states that hold a planned slot. Failed, rejected, skipped and dry posts free it. */
const SLOT_HOLDING = new Set(['publishing', 'held', 'scheduled', 'queued', 'draft', 'sent'])

const slotLabel = (at: number, zone: string) =>
  new Date(at).toLocaleString('en-GB', {
    timeZone: zone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

/** A local date, YYYY-MM-DD, as "Thu 12 Nov". */
const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })

/**
 * How a post goes to Buffer. A post with its own time (a planned day, or an on-this-day date) is
 * scheduled for it in any mode but drafts, which keep the time for when they are approved.
 */
export function postModeFor(mode: PostingMode, plannedFor: number | undefined): PostingMode {
  return plannedFor !== undefined && mode !== 'draft' ? 'planned' : mode
}

type Kind = 'scheduled' | 'now' | 'dry'

/** How long an unfinished run is taken to be going; after this the sweeper closes it. */
export const RUN_IN_FLIGHT_MS = 15 * 60_000

/**
 * Whether a run of this automation is still going: unfinished and younger than the sweeper's
 * cut-off. Every way of starting a run checks this, so two never overlap and post twice.
 */
export async function runInFlight(
  ctx: Pick<QueryCtx, 'db'>,
  automationId: Id<'automations'>,
  now = Date.now(),
): Promise<boolean> {
  const recent = await ctx.db
    .query('runs')
    .withIndex('by_automation_startedAt', (q) =>
      q.eq('automationId', automationId).gt('startedAt', now - RUN_IN_FLIGHT_MS),
    )
    .collect()
  return recent.some((r) => !r.finishedAt)
}

/** The scheduled entry point: books the run and starts it. Never throws, so the chain goes on. */
export const start = internalMutation({
  args: { automationId: v.id('automations') },
  returns: v.null(),
  handler: async (ctx, { automationId }) => {
    const automation = await ctx.db.get(automationId)
    if (!automation || automation.deletedAt || automation.status !== 'active') return null
    const setFor = automation.nextRunSetFor
    await scheduleNext(ctx, { ...automation, scheduledFnId: undefined })
    // A run the person started minutes ago is still going: it covers this slot.
    if (await runInFlight(ctx, automationId)) {
      console.log(`Scheduled run skipped for ${automationId}: a run is already going.`)
      return null
    }
    await beginRun(ctx, automation, 'scheduled', {
      startedBy: 'schedule',
      late: setFor ? Date.now() - setFor : undefined,
    })
    return null
  },
})

/** Starts a run now, or a dry run that writes posts but sends nothing. */
export const trigger = mutation({
  args: { automationId: v.id('automations'), dry: v.boolean() },
  returns: v.id('runs'),
  handler: async (ctx, { automationId, dry }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not signed in')
    return await triggerFor(ctx, userId, { automationId, dry, startedBy: 'app' })
  },
})

export type Hint = { title: string; url?: string; notes?: string }
export type StartedBy = 'schedule' | 'app' | 'api' | 'hook' | 'mcp' | 'first'

/** Starts a run for a person from the app, the API, an inbound hook or MCP. Same rules for all. */
export async function triggerFor(
  ctx: MutationCtx,
  userId: Id<'users'>,
  {
    automationId,
    dry,
    hint,
    startedBy,
  }: {
    automationId: Id<'automations'>
    dry: boolean
    hint?: Hint
    startedBy: StartedBy
  },
): Promise<Id<'runs'>> {
  {
    const automation = await ctx.db.get(automationId)
    if (!automation || automation.userId !== userId || automation.deletedAt)
      throw new ConvexError('Automation not found')
    if (!automation.playbookVersionId) throw new ConvexError('The playbook is not ready yet')
    // The app's Run now works on a paused automation: a person pressed it. Callers outside the app
    // never run one Dispatchlet paused itself, and a hook never runs one the person paused.
    if (startedBy !== 'app') {
      if (automation.status === 'failed')
        throw new ConvexError(
          'This automation is paused after failed runs. Look at it in the app first.',
        )
      if (automation.status === 'paused' && startedBy === 'hook')
        throw new ConvexError('This automation is paused, so its hooks do not start runs.')
    }
    if (await runInFlight(ctx, automationId))
      throw new ConvexError('A run is already going. Wait for it to finish.')
    const runId = await beginRun(ctx, automation, dry ? 'dry' : 'now', { hint, startedBy })
    if (!runId)
      throw new ConvexError(
        dry
          ? 'No dry runs left.'
          : 'No free runs left. Add your own Anthropic key in settings to keep going.',
      )
    return runId
  }
}

const STARTED_FROM: Record<StartedBy, string> = {
  schedule: '',
  app: '',
  api: ' from the API',
  hook: ' from a hook',
  mcp: ' from an assistant',
  // Runs from when a new automation started its own dry run, before the person chose.
  first: ' on its own, to show what the playbook finds',
}

function startNote(
  kind: Kind,
  from: { hint?: Hint; startedBy: StartedBy; late?: number },
  timezone: string,
): string {
  const where = STARTED_FROM[from.startedBy]
  const head =
    kind === 'dry'
      ? `Dry run started${where}. Nothing will be sent to Buffer.`
      : `Run started${where}.${lateNote(from.late, timezone)}`
  return from.hint ? `${head} Asked to cover: ${from.hint.title}` : head
}

/**
 * Books a run row and the action that does the work, after checking the allowance. A scheduled
 * run that the allowance does not cover is recorded as skipped so the person can see why.
 */
async function beginRun(
  ctx: Parameters<typeof scheduleNext>[0],
  automation: Doc<'automations'>,
  kind: Kind,
  from: { hint?: Hint; startedBy: StartedBy; late?: number } = { startedBy: 'schedule' },
): Promise<Id<'runs'> | null> {
  const user = await ctx.db.get(automation.userId)
  if (!user) return null
  // Taken off the allowlist since connecting: the grant stays, but nothing runs on it.
  const connection = await ctx.db
    .query('bufferConnections')
    .withIndex('by_user', (q) => q.eq('userId', user._id))
    .first()
  if (!isAllowlisted(connection?.bufferAccountId ?? null, user.email ?? null)) {
    if (from.startedBy === 'schedule' || from.startedBy === 'first') {
      console.log(`Run not started for ${user._id}: the account is not on the allowlist.`)
      return null
    }
    throw new ConvexError('This account is not allowed into Dispatchlet yet, so it cannot run.')
  }
  const allowance = allowanceFor(user)
  const left = kind === 'dry' ? allowance.dryRunsLeft : allowance.runsLeft
  const now = Date.now()
  if (left === 0) {
    if (kind === 'scheduled') {
      await ctx.db.insert('runs', {
        userId: user._id,
        automationId: automation._id,
        playbookVersionId: automation.playbookVersionId,
        kind,
        status: 'skipped',
        startedAt: now,
        finishedAt: now,
        steps: [
          {
            step: 'skipped',
            at: now,
            note: 'No free runs left. Add your own Anthropic key in settings to keep going.',
          },
        ],
        usage: EMPTY_USAGE,
        costUsd: 0,
      })
      await ctx.scheduler.runAfter(0, internal.email.sendRunsUsedUp, { userId: user._id })
    }
    return null
  }
  if (!allowance.ownKey) {
    await ctx.db.patch(
      user._id,
      kind === 'dry'
        ? { freeDryRunsUsed: (user.freeDryRunsUsed ?? 0) + 1 }
        : { freeRunsUsed: (user.freeRunsUsed ?? 0) + 1 },
    )
  }
  const runId = await ctx.db.insert('runs', {
    userId: user._id,
    automationId: automation._id,
    playbookVersionId: automation.playbookVersionId,
    kind,
    status: 'researching',
    startedAt: now,
    steps: [
      {
        step: 'research',
        at: now,
        note: startNote(kind, from, automation.timezone),
      },
    ],
    usage: EMPTY_USAGE,
    costUsd: 0,
    startedBy: from.startedBy,
    hint: from.hint,
    freeRun: allowance.ownKey ? undefined : true,
  })
  await ctx.db.patch(automation._id, { lastRunAt: now, updatedAt: now })
  await ctx.scheduler.runAfter(0, internal.runs.execute, { runId })
  return runId
}

export const load = internalQuery({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId)
    if (!run?.automationId || !run.playbookVersionId || !run.userId) return null
    const automation = await ctx.db.get(run.automationId)
    const version = await ctx.db.get(run.playbookVersionId)
    const user = await ctx.db.get(run.userId)
    if (!automation || !version || !user) return null
    const channels = await ctx.db
      .query('bufferChannels')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect()
    const covered = await ctx.db
      .query('stories')
      .withIndex('by_automation_decision', (q) =>
        q.eq('automationId', automation._id).eq('decision', 'kept'),
      )
      .order('desc')
      .take(200)
      // A story that got nothing into Buffer was not covered: a later run may try it again.
      .then((rows) => rows.filter((s) => !s.notPosted))
    // Sent posts with Buffer's metrics from the last 90 days, for the writer's examples.
    const sentPosts = (
      await ctx.db
        .query('posts')
        .withIndex('by_automation_createdAt', (q) =>
          q.eq('automationId', automation._id).gt('createdAt', Date.now() - 90 * 86_400_000),
        )
        .collect()
    ).filter((p) => p.userId === user._id && p.status === 'sent' && p.metrics?.length)
    // The last day's spend, from hourly buckets (ai.addSpend): at most 25 rows, however busy the day.
    const since = Date.now() - 86_400_000
    const today = await ctx.db
      .query('aiSpend')
      .withIndex('by_hour', (q) => q.gte('hourStart', since - 3_600_000))
      .collect()
    // Until the buckets cover a whole day (they start at deploy), the hours before the first
    // bucket are summed from the calls themselves, as before.
    const firstBucket = today.reduce((min, b) => Math.min(min, b.hourStart), Infinity)
    const uncovered =
      firstBucket > since
        ? await ctx.db
            .query('aiCalls')
            .withIndex('by_createdAt', (q) =>
              q.gte('createdAt', since).lt('createdAt', Math.min(firstBucket, Date.now())),
            )
            .collect()
        : []
    return {
      run,
      automation,
      playbook: version.playbook as Playbook,
      user,
      channels: channels.filter((c) => automation.channelIds.includes(c.channelId)),
      covered: covered.map((s) => ({ _id: s._id, title: s.title, canonicalUrl: s.canonicalUrl })),
      spentTodayUsd:
        today.reduce((sum, c) => sum + c.usd, 0) + uncovered.reduce((sum, c) => sum + c.costUsd, 0),
      proven: provenPosts(sentPosts),
    }
  },
})

export const logStep = internalMutation({
  args: { runId: v.id('runs'), status: v.optional(v.string()), step: v.string(), note: v.string() },
  returns: v.null(),
  handler: async (ctx, { runId, status, step, note }) => {
    const run = await ctx.db.get(runId)
    if (!run) return null
    await ctx.db.patch(runId, {
      ...(status ? { status } : {}),
      steps: [...run.steps, { step, at: Date.now(), note }],
    })
    return null
  },
})

const storyFields = {
  title: v.string(),
  canonicalUrl: v.string(),
  source: v.string(),
  publishedAt: v.string(),
  summary: v.string(),
  whyItMatters: v.string(),
  keyFacts: v.array(v.string()),
  confidence: v.number(),
  decision: v.string(),
  reason: v.string(),
  dupOf: v.optional(v.id('stories')),
  eventDate: v.optional(v.string()),
  forDate: v.optional(v.string()),
}

export const saveStories = internalMutation({
  args: {
    runId: v.id('runs'),
    automationId: v.id('automations'),
    stories: v.array(v.object(storyFields)),
  },
  returns: v.array(v.id('stories')),
  handler: async (ctx, { runId, automationId, stories }) => {
    const ids: Id<'stories'>[] = []
    for (const story of stories)
      ids.push(
        await ctx.db.insert('stories', { ...story, runId, automationId, createdAt: Date.now() }),
      )
    const kept = stories.filter((s) => s.decision === 'kept' || s.decision === 'dry').length
    await ctx.db.patch(runId, { found: stories.length, kept })
    return ids
  },
})

export const savePost = internalMutation({
  args: {
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
    status: v.string(),
    publishingAt: v.optional(v.number()),
    reason: v.optional(v.string()),
    bufferPostId: v.optional(v.string()),
    bufferStatus: v.optional(v.string()),
    externalLink: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    plannedFor: v.optional(v.number()),
  },
  returns: v.id('posts'),
  handler: async (ctx, args) => {
    const approveToken = args.status === 'draft' ? crypto.randomUUID() : undefined
    const id = await ctx.db.insert('posts', { ...args, approveToken, createdAt: Date.now() })
    if (args.status === 'dry') {
      const run = await ctx.db.get(args.runId)
      if (run) await ctx.db.patch(args.runId, { wouldSend: (run.wouldSend ?? 0) + 1 })
    }
    if (args.bufferPostId) {
      const run = await ctx.db.get(args.runId)
      if (run) await ctx.db.patch(args.runId, { posted: (run.posted ?? 0) + 1 })
      const user = await ctx.db.get(args.userId)
      if (user && !user.firstPostAt) await ctx.db.patch(user._id, { firstPostAt: Date.now() })
      await emitPostEvent(ctx, id, 'post.created')
      await ctx.scheduler.runAfter(0, internal.buffer.addPostNote, { postId: id })
    }
    return id
  },
})

/** Planned slots this automation's posts already hold from `from` on (other or earlier batches). */
export const occupiedSlots = internalQuery({
  args: { automationId: v.id('automations'), from: v.number() },
  returns: v.array(v.number()),
  handler: async (ctx, { automationId, from }) => {
    const posts = await ctx.db
      .query('posts')
      .withIndex('by_automation_plannedFor', (q) =>
        q.eq('automationId', automationId).gte('plannedFor', from),
      )
      .take(500)
    return [...new Set(posts.filter((p) => SLOT_HOLDING.has(p.status)).map((p) => p.plannedFor!))]
  },
})

/** Statuses of a post that is in Buffer, or may be, or is waiting to go: its story is covered. */
const REACHED_BUFFER = new Set(['publishing', 'held', 'draft', 'queued', 'scheduled', 'sent'])

/**
 * Flags the run's kept stories that got nothing into Buffer, so they are not counted as covered and
 * a later run may try them again. A story the person skipped stays covered, and so does one with a
 * post that failed in a way that may have reached Buffer ("Check Buffer…").
 */
async function markNotPosted(ctx: MutationCtx, runId: Id<'runs'>) {
  const stories = await ctx.db
    .query('stories')
    .withIndex('by_run', (q) => q.eq('runId', runId))
    .collect()
  const kept = stories.filter((s) => s.decision === 'kept' && !s.review)
  if (!kept.length) return
  const posts = await ctx.db
    .query('posts')
    .withIndex('by_run', (q) => q.eq('runId', runId))
    .collect()
  for (const story of kept) {
    const reached = posts.some(
      (p) =>
        p.storyId === story._id &&
        (Boolean(p.bufferPostId) ||
          REACHED_BUFFER.has(p.status) ||
          (p.status === 'failed' && /Check Buffer/.test(p.reason ?? ''))),
    )
    if (!reached) await ctx.db.patch(story._id, { notPosted: true })
  }
}

export const finish = internalMutation({
  args: {
    runId: v.id('runs'),
    status: v.string(),
    note: v.string(),
    error: v.optional(v.string()),
    /** False when the failure was on Dispatchlet's side, so it never pauses the automation. */
    counts: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { runId, status, note, error, counts }) => {
    const run = await ctx.db.get(runId)
    if (!run) return null
    await ctx.db.patch(runId, {
      status,
      finishedAt: Date.now(),
      error,
      steps: [...run.steps, { step: status, at: Date.now(), note }],
    })
    if (run.kind !== 'dry') await markNotPosted(ctx, runId)
    if (!run.automationId) return null
    const automation = await ctx.db.get(run.automationId)
    if (!automation) return null
    const countsAsFailure = status === 'failed' && run.kind !== 'dry' && counts !== false
    const failures = countsAsFailure
      ? (automation.consecutiveFailures ?? 0) + 1
      : status === 'done'
        ? 0
        : (automation.consecutiveFailures ?? 0)
    await ctx.db.patch(automation._id, { consecutiveFailures: failures, updatedAt: Date.now() })
    // Lost Buffer access pauses the automation now; the reconnect email has already gone out.
    const lostAccess = countsAsFailure && /Sign in with Buffer again/.test(error ?? '')
    const brief = { id: automation._id, name: automation.name }
    if (lostAccess && automation.status === 'active') {
      await ctx.db.patch(automation._id, { status: 'paused' })
      await scheduleNext(ctx, { ...automation, status: 'paused' })
      await emit(
        ctx,
        automation.userId,
        'automation.paused',
        { automation: brief, reason: 'lost_access' },
        automation._id,
      )
    } else if (failures >= 3 && automation.status === 'active') {
      await ctx.db.patch(automation._id, { status: 'failed' })
      await scheduleNext(ctx, { ...automation, status: 'failed' })
      await emit(
        ctx,
        automation.userId,
        'automation.paused',
        { automation: brief, reason: 'failures' },
        automation._id,
      )
      await ctx.scheduler.runAfter(0, internal.email.sendPaused, {
        userId: automation.userId,
        automationId: automation._id,
      })
      await ctx.scheduler.runAfter(0, internal.push.notify, {
        userId: automation.userId,
        title: `${automation.name} is paused`,
        body: 'Three runs failed in a row. The run log says what went wrong.',
        url: `/app/a/${automation._id}`,
        tag: `paused-${automation._id}`,
      })
    }
    const user = await ctx.db.get(automation.userId)
    const prefs = user?.emailPrefs ?? 'every'
    const emailOn = user?.emailEnabled ?? true
    const drafts = automation.postingMode === 'draft' && (run.posted ?? 0) > 0
    const posted = run.posted ?? 0
    const wantsNote =
      status === 'done' &&
      run.kind !== 'dry' &&
      posted > 0 &&
      (prefs === 'every' || (prefs === 'drafts' && drafts))
    const runUrl = `/app/a/${automation._id}/runs/${runId}`
    if (wantsNote) {
      if (emailOn) await ctx.scheduler.runAfter(0, internal.email.sendDigest, { runId })
      await ctx.scheduler.runAfter(0, internal.push.notify, {
        userId: automation.userId,
        title: drafts
          ? `${posted} ${posted === 1 ? 'draft' : 'drafts'} waiting for a yes`
          : `${posted} ${posted === 1 ? 'post' : 'posts'} in Buffer`,
        body: `${automation.name}: ${note}`,
        url: runUrl,
        tag: `run-${runId}`,
      })
    }
    const finished = await ctx.db.get(runId)
    if (finished)
      await emit(
        ctx,
        automation.userId,
        'run.finished',
        { run: await runView(ctx, finished, automation.userId), automation: brief },
        automation._id,
      )
    if (countsAsFailure && prefs !== 'never' && failures === 1) {
      if (emailOn) await ctx.scheduler.runAfter(0, internal.email.sendRunFailed, { runId })
      await ctx.scheduler.runAfter(0, internal.push.notify, {
        userId: automation.userId,
        title: `A run of ${automation.name} failed`,
        body: error ?? note,
        url: runUrl,
        tag: `run-${runId}`,
      })
    }
    return null
  },
})

/**
 * Gives each story a slot, best first. An anniversary story takes only the slot on its own
 * date; other stories take the earliest free slot.
 */
export function assignSlots(
  stories: { canonicalUrl: string; forDate?: string | null }[],
  slots: number[],
  zone: string,
): Map<string, number> {
  const free = [...slots]
  const out = new Map<string, number>()
  for (const story of stories) {
    const index = story.forDate
      ? free.findIndex((at) => localDate(at, zone) === story.forDate)
      : free.length
        ? 0
        : -1
    if (index < 0) continue
    out.set(story.canonicalUrl, free[index]!)
    free.splice(index, 1)
  }
  return out
}

/** Stories written per call in a large batch; small runs stay one call, as before. */
const WRITE_BATCH_STORIES = 3

const storyCount = (n: number) => `${n} ${n === 1 ? 'story' : 'stories'}`

/** The closing line of a dry run, honest about posts that failed their checks. */
export function dryNote(stories: number, posts: number): string {
  if (!posts)
    return `Dry run finished. It kept ${storyCount(stories)}, but none of the posts passed the checks, so this run would send nothing. The reasons are below.`
  return `Dry run finished. It would send ${posts} ${posts === 1 ? 'post' : 'posts'} for ${storyCount(stories)}. Nothing went to Buffer.`
}

/** The closing line of a planned batch: what is scheduled when, and any days left empty. */
export function planNote(o: {
  dry: boolean
  published: number
  placed: number[]
  kept: number
  storyLimit: number
  openDays: number
  timezone: string
}): string {
  // oxlint-disable-next-line unicorn/no-array-sort -- a fresh copy
  const days = [...o.placed].sort((a, b) => a - b).map((at) => slotLabel(at, o.timezone))
  const head = o.dry
    ? `Dry run finished. It would schedule ${storyCount(days.length)}: ${days.join('; ')}. Nothing went to Buffer.`
    : `Done. ${o.published} ${o.published === 1 ? 'post' : 'posts'} in Buffer, for ${days.join('; ')}.`
  const short =
    o.kept < o.storyLimit
      ? ` Research found ${storyCount(o.kept)} good enough for ${o.storyLimit} planned, so ${o.storyLimit - o.kept} ${o.storyLimit - o.kept === 1 ? 'day has' : 'days have'} no post.`
      : ''
  const unplaced =
    o.placed.length < o.kept
      ? ` ${storyCount(o.kept - o.placed.length)} had no posting day left by the time ${o.kept - o.placed.length === 1 ? 'it was' : 'they were'} written.`
      : ''
  return `${head}${short}${unplaced}`
}

async function record(ctx: ActionCtx, runId: Id<'runs'>, purpose: string, r: CallRecord) {
  await ctx.runMutation(internal.ai.recordCall, { runId, purpose, ...r })
}

/**
 * How long a run's AI calls have, from the start of the action. Convex stops an action at ten
 * minutes; the SDK retries timeouts, so without a deadline one slow research call could use all of
 * it and leave posts stuck in `publishing`. The rest is for saving and sending to Buffer.
 */
const RUN_AI_DEADLINE_MS = 8 * 60_000

/** The reply came back but could not be read: thrown so serviceFailure treats it as the AI's fault. */
const UNREADABLE = 'Failed to parse structured output: the AI reply could not be read.'

/** One post per story and channel, the first the writer gave; returns how many were dropped. */
export function onePerStoryAndChannel<T extends { storyUrl: string; channelId: string }>(
  posts: T[],
): { posts: T[]; dropped: number } {
  const seen = new Set<string>()
  const kept = posts.filter((p) => {
    const key = `${canonicalUrl(p.storyUrl)}|${p.channelId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { posts: kept, dropped: posts.length - kept.length }
}

/**
 * A send to Buffer that got no clear answer: a timeout, a dropped connection or a 5xx. Buffer may
 * or may not have the post, so it is not sent again, and the rest of the run waits.
 */
export function bufferDidNotAnswer(error: unknown): boolean {
  if (error instanceof BufferApiError) return error.status >= 500
  if (error instanceof BufferPostError || error instanceof BufferBudgetError) return false
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error)
  return (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    /fetch failed|network|ECONNRESET|ETIMEDOUT|timed out|aborted/i.test(message)
  )
}

/** The run: research, dedupe, write, publish. Each step is logged as it finishes. */
export const execute = internalAction({
  args: { runId: v.id('runs') },
  returns: v.null(),
  handler: async (ctx, { runId }) => {
    const deadline = Date.now() + RUN_AI_DEADLINE_MS
    const loaded = await ctx.runQuery(internal.runs.load, { runId })
    if (!loaded) return null
    const { run, automation, playbook, user, channels, covered, spentTodayUsd, proven } = loaded
    const dry = run.kind === 'dry'
    const say = (step: string, note: string, status?: string) =>
      ctx.runMutation(internal.runs.logStep, { runId, step, note, status })
    const fail = (note: string) =>
      ctx.runMutation(internal.runs.finish, { runId, status: 'failed', note, error: note })
    // Posts Buffer took. A run that sent any keeps its free run, whatever goes wrong after.
    let published = 0
    try {
      if (
        !allowanceFor(user).ownKey &&
        spentTodayUsd >= globalDailyCapUsd() &&
        (run.kind === 'scheduled' || (run.startedBy !== undefined && run.startedBy !== 'app'))
      ) {
        if (run.freeRun) await ctx.runMutation(internal.runs.refundFreeRun, { runId })
        await ctx.runMutation(internal.runs.finish, {
          runId,
          status: 'skipped',
          note: `Dispatchlet has used its AI budget for today, so this run was skipped.${run.freeRun ? ' It did not use one of your free runs.' : ''} The next one goes ahead as scheduled.`,
        })
        await ctx.runMutation(internal.alerts.notifyOwner, {
          kind: 'spend-cap',
          detail: `Daily cap of $${globalDailyCapUsd()} reached`,
        })
        return null
      }
      const usable = channels.filter((c) => c.usable)
      if (!usable.length) {
        // Locked or disconnected channels are a Buffer setting, not a broken run: skip without
        // counting a failure (three pause the automation) and give a free run back.
        const why = channels.map((c) => `${c.name}: ${channelIssue(c)}`).join('. ')
        if (run.freeRun) await ctx.runMutation(internal.runs.refundFreeRun, { runId })
        await ctx.runMutation(internal.runs.finish, {
          runId,
          status: 'skipped',
          note: `Nothing to post to. ${why}. Fix it in Buffer, then sync channels in settings.${run.freeRun ? ' This run did not use one of your free runs.' : ''}`,
        })
        return null
      }
      for (const c of channels)
        if (!c.usable) await say('channels', `${c.name} skipped: ${channelIssue(c)}.`)

      // A planned batch keeps at most one story per open posting day in the week from this run.
      const planned = automation.postingMode === 'planned'
      const plan: PublicationPlan | null = planned ? (automation.publicationPlan ?? null) : null
      if (planned && !plan) {
        await fail('This automation has no publication plan. Choose posting days and a time.')
        return null
      }
      const horizonStart = run.startedAt
      const openSlots = plan
        ? freeSlots(
            plan,
            automation.timezone,
            horizonStart,
            Date.now(),
            await ctx.runQuery(internal.runs.occupiedSlots, {
              automationId: automation._id,
              from: horizonStart,
            }),
            PLAN_SELECTION_LEAD_MS,
          )
        : []
      const storyLimit = plan
        ? Math.min(automation.maxPostsPerRun, openSlots.length)
        : automation.maxPostsPerRun
      if (plan) {
        if (!storyLimit) {
          if (run.freeRun) await ctx.runMutation(internal.runs.refundFreeRun, { runId })
          await ctx.runMutation(internal.runs.finish, {
            runId,
            status: 'skipped',
            note: `Every posting day in the next ${PLAN_HORIZON_DAYS} days already has a post from this automation or is too soon, so nothing was researched.${run.freeRun ? ' This run did not use one of your free runs.' : ''}`,
          })
          return null
        }
        await say(
          'plan',
          `Planning up to ${storyLimit} ${storyLimit === 1 ? 'story' : 'stories'} for ${openSlots.length} open posting ${openSlots.length === 1 ? 'day' : 'days'}: ${openSlots.map((at) => slotLabel(at, automation.timezone)).join(', ')}.`,
        )
      }

      // History and on-this-day runs. An anniversary is for a posting date: each open day of a
      // planned week. Without a plan, each story is scheduled on its own date at the channel's
      // Buffer queue times, so the dates are the ones posts go out on before the next run.
      const researchMode = automation.researchMode ?? 'recent'
      const today = localDate(Date.now(), automation.timezone)
      const dated = researchMode === 'anniversary' && !plan
      const queues = dated
        ? await channelQueues(ctx, user._id, usable)
        : new Map<string, QueueSchedule | null>()
      const targetDates =
        researchMode !== 'anniversary'
          ? []
          : plan
            ? [...new Set(openSlots.map((at) => localDate(at, automation.timezone)))]
            : datedTargets(
                [...queues.values()],
                automation.timezone,
                Date.now() + PLAN_SELECTION_LEAD_MS,
                automation.status === 'active'
                  ? nextRunAt(automation.cadence, automation.timezone) + PLAN_SELECTION_LEAD_MS
                  : null,
              )
      if (dated) {
        const unknown = usable.filter((c) => !queues.get(c.channelId)).map((c) => c.name)
        await say(
          'plan',
          `On this day: looking for anniversaries on ${targetDates.map((d) => dayLabel(d)).join(', ')}. Each post is scheduled for its own date${unknown.length === usable.length ? ', at 09:00, 12:00 or 15:00 because Buffer did not share the queue times' : ' at the channel’s Buffer queue times'}.${unknown.length && unknown.length < usable.length ? ` ${unknown.join(', ')}: queue times unknown, so 09:00, 12:00 or 15:00.` : ''}`,
        )
      }

      const client = anthropicClient(await keyFor(user))
      const toolEvents: ToolEvent[] = []
      const baseBrief = briefFromPlaybook(playbook, {
        onlyTheseSources: automation.setup.onlyTheseSources,
        maxPostsPerRun: storyLimit,
      })
      // An on-this-day playbook may carry the day it was written; search this run's day instead.
      const onDay = researchMode === 'anniversary' ? (targetDates[0] ?? today) : null
      const brief = onDay
        ? { ...baseBrief, sources: baseBrief.sources.map((s) => redate(s, onDay)) }
        : baseBrief
      const domains = allowedDomains(brief)
      const research = await callStructured(client, {
        model: modelFor('research'),
        effort: 'high',
        maxTokens: STRUCTURED_MAX_TOKENS,
        system: researchSystemFor(researchMode),
        user: researchUserMessage(brief, {
          now: new Date(),
          timezone: automation.timezone,
          covered: covered.map((c) => ({ title: c.title, url: c.canonicalUrl })),
          requested: run.hint ?? null,
          batch: plan ? { days: PLAN_HORIZON_DAYS, stories: storyLimit } : null,
          mode: researchMode,
          targetDates,
        }),
        schema: ResearchResult,
        tools: researchTools(domains, undefined, brief.maxCandidates),
        deadline,
        // Each search and page open goes in the log as it lands, so the run page fills as it works.
        onTool: async (event) => {
          toolEvents.push(event)
          const note = toolNote(event)
          if (note) await say(event.tool === 'web_search' ? 'search' : 'read', note)
        },
      })
      await record(ctx, runId, 'research', research.record)
      // Playbook sources that would not open, or opened again, so one that keeps failing is flagged.
      const sourceHosts = new Set(
        playbook.sources.map((s) => (s.url ? hostOfUrl(s.url) : null)).filter(Boolean),
      )
      const opened = (failed: boolean) => [
        ...new Set(
          toolEvents
            .filter(
              (e) =>
                e.tool === 'web_fetch' && (failed ? SOURCE_FAILURES.has(e.error ?? '') : !e.error),
            )
            .map((e) => hostOfUrl(e.input))
            .filter((h): h is string => h !== null && sourceHosts.has(h)),
        ),
      ]
      await ctx.runMutation(internal.automations.noteSourceHealth, {
        automationId: automation._id,
        failed: opened(true),
        ok: opened(false),
      })
      if (research.unreadable) throw new ConvexError(UNREADABLE)
      if (!research.output) {
        await fail(
          research.record.refusal
            ? `Research was declined: ${research.record.refusal}`
            : 'Research returned nothing usable.',
        )
        return null
      }
      // Dates only mean something in the mode that asked for them.
      const found = research.output.candidates.map((c) => ({
        ...c,
        eventDate: researchMode === 'recent' ? null : c.eventDate,
        forDate: researchMode === 'anniversary' ? c.forDate : null,
      }))
      await say(
        'research',
        `Searched ${research.record.usage.webSearches} times and opened ${research.record.usage.webFetches} pages. Found ${found.length} ${found.length === 1 ? 'story' : 'stories'}.`,
      )
      if (research.output.notes) await say('notes', research.output.notes)

      // Decide: duplicates first, then confidence, then the run's story limit.
      const decided: (Candidate & { decision: string; reason: string; dupOf?: Id<'stories'> })[] =
        []
      const keptSoFar: { title: string; canonicalUrl: string; _id?: Id<'stories'> }[] = [...covered]
      // The story the run was asked to cover, matched by its link, or by title without one.
      const hint = run.hint
      const hintUrl = hint?.url ? canonicalUrl(hint.url) : null
      const isRequested = (c: Candidate) =>
        Boolean(hint) &&
        (hintUrl
          ? canonicalUrl(c.canonicalUrl) === hintUrl
          : Boolean(duplicateOf({ title: hint!.title, canonicalUrl: '' }, [c])))
      // Asked-for first, then by confidence.
      // oxlint-disable-next-line unicorn/no-array-sort -- the copy is sorted in place on purpose
      const ranked = [...found].sort(
        (a, b) => Number(isRequested(b)) - Number(isRequested(a)) || b.confidence - a.confidence,
      )
      for (const c of ranked) {
        const url = canonicalUrl(c.canonicalUrl)
        const dup = duplicateOf({ title: c.title, canonicalUrl: url }, keptSoFar)
        if (dup) {
          decided.push({
            ...c,
            canonicalUrl: url,
            decision: 'skipped_dup',
            reason:
              dup.by === 'url'
                ? 'Already covered: the same page.'
                : `Already covered as "${dup.match.title}".`,
            dupOf: dup.match._id,
          })
          continue
        }
        const requested = isRequested(c)
        const datedWrong = historicalProblem(c, researchMode, targetDates, today)
        if (datedWrong) {
          decided.push({ ...c, canonicalUrl: url, decision: 'skipped_quality', reason: datedWrong })
          continue
        }
        // A planned week remembers one event per day, on that day.
        if (
          plan &&
          researchMode === 'anniversary' &&
          decided.some(
            (d) => (d.decision === 'kept' || d.decision === 'dry') && d.forDate === c.forDate,
          )
        ) {
          decided.push({
            ...c,
            canonicalUrl: url,
            decision: 'skipped_limit',
            reason: `Another story is already planned for ${c.forDate}.`,
          })
          continue
        }
        if (requested && c.confidence < MIN_REQUESTED_CONFIDENCE) {
          decided.push({
            ...c,
            canonicalUrl: url,
            decision: 'skipped_quality',
            reason: `Asked for, but the page did not back it up (${Math.round(c.confidence * 100)}%).`,
          })
          continue
        }
        if (!requested && c.confidence < MIN_CONFIDENCE) {
          decided.push({
            ...c,
            canonicalUrl: url,
            decision: 'skipped_quality',
            reason:
              researchMode === 'recent'
                ? `Not sure enough it is new and on topic (${Math.round(c.confidence * 100)}%).`
                : `Not sure enough of the facts and the date (${Math.round(c.confidence * 100)}%).`,
          })
          continue
        }
        const kept = decided.filter((d) => d.decision === 'kept' || d.decision === 'dry').length
        if (kept >= storyLimit) {
          decided.push({
            ...c,
            canonicalUrl: url,
            decision: 'skipped_limit',
            reason:
              plan && storyLimit < automation.maxPostsPerRun
                ? `Over the ${storyLimit} open posting ${storyLimit === 1 ? 'day' : 'days'} in this week's plan.`
                : limitReason(storyLimit),
          })
          continue
        }
        decided.push({
          ...c,
          canonicalUrl: url,
          decision: dry ? 'dry' : 'kept',
          reason: requested
            ? 'Kept: the run was asked to cover it.'
            : dry
              ? 'Kept for the dry run.'
              : 'Kept.',
        })
        keptSoFar.push({ title: c.title, canonicalUrl: url })
      }
      const storyIds = await ctx.runMutation(internal.runs.saveStories, {
        runId,
        automationId: automation._id,
        stories: decided.map(({ dupOf, eventDate, forDate, ...s }) => ({
          ...s,
          dupOf,
          eventDate: eventDate ?? undefined,
          forDate: forDate ?? undefined,
        })),
      })
      const keep = decided
        .map((s, i) => ({ ...s, _id: storyIds[i]! }))
        .filter((s) => s.decision === 'kept' || s.decision === 'dry')
      const dups = decided.filter((d) => d.decision === 'skipped_dup').length
      await say(
        'select',
        `Kept ${keep.length}. Skipped ${decided.length - keep.length}${dups ? `, ${dups} already covered` : ''}.`,
      )
      if (!keep.length) {
        await ctx.runMutation(internal.runs.finish, {
          runId,
          status: 'done',
          note: covered.length
            ? 'Nothing new worth posting since the last run.'
            : 'Nothing worth posting yet.',
        })
        return null
      }

      // Write.
      await say(
        'write',
        `Writing ${keep.length * usable.length} ${keep.length * usable.length === 1 ? 'post' : 'posts'}.${proven.length ? ` Learning from your ${proven.length} best ${proven.length === 1 ? 'post' : 'posts'} so far.` : ''}`,
        'writing',
      )
      const targets: TargetChannel[] = usable.map((c) => ({
        channelId: c.channelId,
        service: c.service as Service,
        name: c.name,
        maxLength: c.maxLength ?? null,
      }))
      // Planned dates the writer can see, so a post meant for Friday does not say "today".
      const tentative = new Map<string, number>()
      if (plan)
        assignSlots(keep, openSlots, automation.timezone).forEach((at, url) =>
          tentative.set(url, at),
        )
      if (dated)
        for (const k of keep)
          if (k.forDate)
            tentative.set(
              k.canonicalUrl,
              datedSlots(
                queues.get(usable[0]!.channelId) ?? null,
                k.forDate,
                automation.timezone,
              )[0]!,
            )
      // A large batch is written a few stories at a time, so one reply never has to carry them all.
      const writtenPosts: PostDraft[] = []
      for (let from = 0; from < keep.length; from += WRITE_BATCH_STORIES) {
        const chunk = keep.slice(from, from + WRITE_BATCH_STORIES)
        const written = await callStructured(client, {
          model: modelFor('write'),
          effort: 'medium',
          maxTokens: STRUCTURED_MAX_TOKENS,
          system: WRITE_SYSTEM,
          user: writeUserMessage(
            playbook,
            chunk,
            targets,
            proven,
            plan ? { timezone: automation.timezone, at: tentative } : undefined,
          ),
          schema: WriteResult,
          deadline,
        })
        await record(ctx, runId, 'write', written.record)
        if (written.unreadable) throw new ConvexError(UNREADABLE)
        if (written.output) {
          writtenPosts.push(...written.output.posts)
          continue
        }
        const why = written.record.refusal
          ? `Writing was declined: ${written.record.refusal}`
          : 'Writing returned nothing usable.'
        if (keep.length <= WRITE_BATCH_STORIES) {
          await fail(why)
          return null
        }
        await say('write', `${why} ${chunk.length} of the stories are left out.`)
      }
      if (!writtenPosts.length) {
        await fail('Writing returned nothing usable.')
        return null
      }
      const storyUrls = new Set(keep.map((k) => k.canonicalUrl))
      const byUrl = new Map(keep.map((k) => [k.canonicalUrl, k]))

      // The system adds the link on channels without a card, then posts that miss their limit get
      // up to two narrower asks that say how much to cut.
      // Two posts for the same story on the same channel would both be sent: the first is kept.
      const unique = onePerStoryAndChannel(writtenPosts)
      if (unique.dropped)
        await say(
          'write',
          `${unique.dropped} ${unique.dropped === 1 ? 'post repeated' : 'posts repeated'} a story on the same channel and ${unique.dropped === 1 ? 'was' : 'were'} left out.`,
        )
      let drafts: PostDraft[] = unique.posts.map((d) => {
        const channel = targets.find((t) => t.channelId === d.channelId)
        return channel ? withLink(d, channel) : d
      })
      for (let round = 0; round < 3; round++) {
        const failed = drafts.flatMap((draft) => {
          const channel = targets.find((t) => t.channelId === draft.channelId)
          if (!channel) return []
          const checked = checkPost(draft, channel, playbook, storyUrls)
          return checked.ok
            ? []
            : [
                {
                  post: withoutLink(draft),
                  channel,
                  limit: textLimitFor(channel, playbook),
                  reason: checked.reason,
                  over: overBy(draft, channel, playbook),
                },
              ]
        })
        if (!failed.length) break
        // Too long by a sentence or two: drop the last sentences here, without another model call.
        let trimmed = 0
        for (const f of failed) {
          if (f.over <= 0) continue
          const index = drafts.findIndex(
            (d) => d.channelId === f.channel.channelId && d.storyUrl === f.post.storyUrl,
          )
          const cut = index >= 0 ? trimToFit(drafts[index]!, f.channel, playbook) : null
          if (!cut || !checkPost(cut, f.channel, playbook, storyUrls).ok) continue
          drafts = drafts.map((d, i) => (i === index ? cut : d))
          trimmed++
        }
        if (trimmed) {
          await say(
            'write',
            `Shortened ${trimmed} ${trimmed === 1 ? 'post' : 'posts'} to fit by dropping the last sentence.`,
          )
          continue
        }
        const n = failed.length
        const posts = `${n} ${n === 1 ? 'post' : 'posts'}`
        const tooLong = failed.filter((f) => f.over > 0).length
        await say(
          'write',
          tooLong === n
            ? `${posts} missed the limit. Asking for a shorter version.`
            : tooLong === 0
              ? `${posts} ${n === 1 ? 'needs' : 'need'} a rewrite. ${failed[0]!.reason}`
              : `${posts} ${n === 1 ? 'needs' : 'need'} a rewrite, ${tooLong} for length.`,
        )
        const repaired = await callStructured(client, {
          model: modelFor('write'),
          effort: 'high',
          maxTokens: 4_000,
          system: WRITE_SYSTEM,
          user: repairUserMessage(failed),
          schema: WriteResult,
          deadline,
        })
        await record(ctx, runId, 'repair', repaired.record)
        // Nothing usable came back: asking again with the same input would only spend more.
        if (!repaired.output?.posts.length) {
          await say('write', 'The rewrite came back empty, so those posts are left out.')
          break
        }
        // A rewrite replaces its draft; a second rewrite of the same post is ignored.
        for (const fix of onePerStoryAndChannel(repaired.output.posts).posts) {
          const channel = targets.find((t) => t.channelId === fix.channelId)
          const index = drafts.findIndex(
            (d) => d.channelId === fix.channelId && d.storyUrl === fix.storyUrl,
          )
          if (index >= 0 && channel)
            drafts = drafts.map((d, i) => (i === index ? withLink(fix, channel) : d))
        }
      }
      // Deleted or paused while this run was researching and writing: send nothing to Buffer.
      if (!dry) {
        const current = await ctx.runQuery(internal.runs.automationState, {
          automationId: automation._id,
        })
        const pausedSince = automation.status === 'active' && current?.status !== 'active'
        if (!current || current.deletedAt || pausedSince) {
          await ctx.runMutation(internal.runs.finish, {
            runId,
            status: 'skipped',
            note: `This automation was ${!current || current.deletedAt ? 'deleted' : 'paused'} while the run was going, so nothing was sent to Buffer.`,
          })
          return null
        }
      }
      const atLimit = dry
        ? new Set<string>()
        : await channelsAtLimit(
            ctx,
            user._id,
            targets.map((t) => t.channelId),
          )
      // Slots are assigned now, against what Buffer already holds from this automation, best story
      // first. A story with no slot left (time passed while writing, or taken) is not posted.
      const slotFor = new Map<Id<'stories'>, number>()
      if (plan) {
        const fresh = freeSlots(
          plan,
          automation.timezone,
          horizonStart,
          Date.now(),
          await ctx.runQuery(internal.runs.occupiedSlots, {
            automationId: automation._id,
            from: horizonStart,
          }),
          PLAN_LEAD_MS,
        )
        const assigned = assignSlots(keep, fresh, automation.timezone)
        for (const k of keep) {
          const at = assigned.get(k.canonicalUrl)
          if (at !== undefined) slotFor.set(k._id, at)
        }
      }
      // On this day without a plan: each post gets its channel's next queue time on the story's
      // date, one story per time. A date with no time left is not posted late.
      const datedAt = new Map<string, number | null>()
      if (dated) {
        const taken = new Set(
          await ctx.runQuery(internal.runs.occupiedSlots, {
            automationId: automation._id,
            from: Date.now(),
          }),
        )
        const used = new Map<string, Set<number>>()
        for (const k of keep)
          for (const t of targets) {
            const channelUsed = used.get(t.channelId) ?? new Set<number>()
            used.set(t.channelId, channelUsed)
            const at = k.forDate
              ? datedSlots(queues.get(t.channelId) ?? null, k.forDate, automation.timezone).find(
                  (slot) =>
                    slot >= Date.now() + PLAN_LEAD_MS && !channelUsed.has(slot) && !taken.has(slot),
                )
              : undefined
            if (at !== undefined) channelUsed.add(at)
            datedAt.set(`${k._id}|${t.channelId}`, at ?? null)
          }
      }
      const tagByOrg = new Map<string, string | null>()
      let dueAt = Date.now() + SPREAD_FIRST_MS
      let held: { retryAt: number; why: 'busy' | 'share' | 'silent' } | null = null
      // A dry run's posts that passed every check, so its last line says what it would really send.
      let wouldSend = 0
      for (const draft of drafts) {
        const channel = targets.find((t) => t.channelId === draft.channelId)
        const row = channels.find((c) => c.channelId === draft.channelId)
        const story = byUrl.get(draft.storyUrl) ?? byUrl.get(canonicalUrl(draft.storyUrl))
        if (!channel || !row || !story) {
          await say(
            'write',
            `A post was dropped: it named a channel or story that was not in the run.`,
          )
          continue
        }
        const checked = checkPost(draft, channel, playbook, storyUrls)
        const base = {
          userId: user._id,
          automationId: automation._id,
          runId,
          storyId: story._id,
          channelId: channel.channelId,
          service: channel.service,
          text: checked.post.text,
          thread: checked.post.thread ?? undefined,
          linkAttachment: checked.post.linkAttachment ?? undefined,
          plannedFor: plan
            ? slotFor.get(story._id)
            : dated
              ? (datedAt.get(`${story._id}|${channel.channelId}`) ?? undefined)
              : undefined,
        }
        if (!checked.ok) {
          await ctx.runMutation(internal.runs.savePost, {
            ...base,
            status: 'rejected',
            reason: checked.reason,
          })
          await say(
            'write',
            `${channel.name}: a post for "${story.title}" was not used. ${checked.reason}`,
          )
          continue
        }
        if (plan && !slotFor.has(story._id)) {
          await ctx.runMutation(internal.runs.savePost, {
            ...base,
            status: 'skipped',
            reason: 'No posting day was left for it in this week’s plan.',
          })
          continue
        }
        if (dated && base.plannedFor === undefined) {
          await ctx.runMutation(internal.runs.savePost, {
            ...base,
            status: 'skipped',
            reason: story.forDate
              ? `Its date, ${dayLabel(story.forDate)}, has no posting time left on ${channel.name}, so it was not posted late.`
              : 'It had no date to post on.',
          })
          continue
        }
        if (dry) {
          await ctx.runMutation(internal.runs.savePost, { ...base, status: 'dry' })
          wouldSend++
          continue
        }
        if (atLimit.has(channel.channelId)) {
          await ctx.runMutation(internal.runs.savePost, {
            ...base,
            status: 'skipped',
            reason: `${channel.name} is at its daily posting limit in Buffer.`,
          })
          await say('publish', `${channel.name} skipped: at its daily posting limit in Buffer.`)
          continue
        }
        // Buffer stopped taking posts earlier in this run: the rest wait, checked like any other.
        if (held) {
          await ctx.runMutation(internal.runs.savePost, {
            ...base,
            status: 'held',
            reason: 'Waiting for Buffer to accept more posts.',
          })
          continue
        }
        if (published === 0) await say('publish', 'Sending to Buffer.', 'publishing')
        if (!tagByOrg.has(row.organizationId))
          tagByOrg.set(row.organizationId, await ensureTag(ctx, user._id, row.organizationId))
        const mode = postModeFor(automation.postingMode as PostingMode, base.plannedFor)
        // The row goes in before the call, so a run that dies mid-way leaves a trace of a post that
        // may be in Buffer (the sweeper fails it) instead of a post Buffer has and Dispatchlet forgot.
        const postId = await ctx.runMutation(internal.runs.savePost, {
          ...base,
          status: 'publishing',
          publishingAt: Date.now(),
        })
        try {
          const created = await createBufferPost(ctx, user._id, {
            channelId: channel.channelId,
            service: channel.service,
            text: checked.post.text,
            thread: checked.post.thread ?? undefined,
            linkAttachment: checked.post.linkAttachment ?? undefined,
            mode,
            dueAt: mode === 'spread' ? dueAt : mode === 'planned' ? base.plannedFor : undefined,
            tagId: tagByOrg.get(row.organizationId) ?? null,
          })
          if (mode === 'spread') dueAt += SPREAD_GAP_MS
          await ctx.runMutation(internal.runs.markSent, {
            postId,
            status:
              mode === 'draft' || created.status === 'draft'
                ? 'draft'
                : created.dueAt
                  ? 'scheduled'
                  : 'queued',
            bufferPostId: created.id,
            bufferStatus: created.status,
            externalLink: created.externalLink ?? undefined,
            dueAt: created.dueAt ? Date.parse(created.dueAt) : undefined,
          })
          published++
          await say(
            'publish',
            `${channel.name}: "${story.title}" ${mode === 'draft' ? 'saved as a draft' : created.dueAt ? `scheduled for ${new Date(created.dueAt).toLocaleString('en-GB', { timeZone: automation.timezone, dateStyle: 'medium', timeStyle: 'short' })}` : 'added to the queue'}.`,
          )
        } catch (error) {
          // Buffer's allowance is spent, or Buffer asked us to slow down: this post and the rest
          // of the run wait for the window to reset, nothing is marked failed.
          const rateLimited =
            error instanceof BufferBudgetError ||
            (error instanceof BufferApiError && error.status === 429)
          if (rateLimited) {
            const retryAt =
              error instanceof BufferBudgetError ? error.retryAt : Date.now() + 15 * 60_000
            await ctx.runMutation(internal.runs.markSent, {
              postId,
              status: 'held',
              reason: 'Waiting for Buffer to accept more posts.',
            })
            held = {
              retryAt,
              why:
                error instanceof BufferBudgetError && error.reason === 'share' ? 'share' : 'busy',
            }
            continue
          }
          // No clear answer: Buffer may have the post, so it is failed rather than sent twice, and
          // the rest wait like a rate-limited run instead of being lost with the run.
          if (bufferDidNotAnswer(error)) {
            const reason =
              'Buffer did not answer while this post was being sent. Check Buffer before sending it again.'
            await ctx.runMutation(internal.runs.markSent, { postId, status: 'failed', reason })
            await say('publish', `${channel.name}: ${reason}`)
            held = { retryAt: Date.now() + 15 * 60_000, why: 'silent' }
            continue
          }
          const reason = error instanceof Error ? error.message : String(error)
          await ctx.runMutation(internal.runs.markSent, { postId, status: 'failed', reason })
          await say('publish', `${channel.name}: Buffer did not take the post. ${reason}`)
          if (error instanceof BufferPostError && error.kind === 'limit')
            atLimit.add(channel.channelId)
          if (!(error instanceof BufferPostError)) throw error
        }
      }
      if (held) {
        await ctx.runMutation(internal.runs.finish, {
          runId,
          status: 'done',
          note: `${published} ${published === 1 ? 'post' : 'posts'} in Buffer. The rest are waiting ${held.why === 'share' ? 'for your account’s daily share of Buffer requests to free up' : held.why === 'silent' ? 'because Buffer stopped answering' : 'because Buffer is busy'}, and will be sent at ${new Date(held.retryAt).toLocaleTimeString('en-GB', { timeZone: automation.timezone, hour: '2-digit', minute: '2-digit' })}.`,
        })
        // Booked through bookHeldRetry so the sweeper sees the booking and does not send again.
        await ctx.runMutation(internal.runs.bookHeldRetry, { runId, at: held.retryAt + 30_000 })
        return null
      }
      await ctx.runMutation(internal.runs.finish, {
        runId,
        status: 'done',
        note: plan
          ? planNote({
              dry,
              published,
              placed: [...slotFor.values()],
              kept: keep.length,
              storyLimit,
              openDays: openSlots.length,
              timezone: automation.timezone,
            })
          : dry
            ? dryNote(keep.length, wouldSend)
            : `Done. ${published} ${published === 1 ? 'post' : 'posts'} in Buffer.`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Only Anthropic's own 401 means the person's key is bad; Buffer's 401 says nothing about it.
      if (error instanceof AuthenticationError && user.anthropicKeyEnc)
        await ctx.runMutation(internal.users.markKeyInvalid, { userId: user._id })
      const ours = serviceFailure(error)
      if (ours) {
        // Dispatchlet's side (the AI, Buffer or the network): the person keeps their free run and
        // the automation keeps its standing.
        const refund = run.freeRun && published === 0
        if (refund) await ctx.runMutation(internal.runs.refundFreeRun, { runId })
        await ctx.runMutation(internal.runs.finish, {
          runId,
          status: 'failed',
          note: `${ours}${refund ? ' This run did not use one of your free runs.' : ''} It does not count toward pausing this automation.`,
          error: message,
          counts: false,
        })
      } else await fail(message)
    }
    return null
  },
})

/** Books sendHeld for a run and notes when, so the sweeper can tell a waiting run from a lost one. */
export const bookHeldRetry = internalMutation({
  args: { runId: v.id('runs'), at: v.number() },
  returns: v.null(),
  handler: async (ctx, { runId, at }) => {
    await ctx.db.patch(runId, { heldRetryAt: at })
    await ctx.scheduler.runAt(at, internal.runs.sendHeld, { runId })
    return null
  },
})

/** Moves a held post to `publishing`, or returns false when something else already took it. */
export const claimHeld = internalMutation({
  args: { postId: v.id('posts') },
  returns: v.boolean(),
  handler: async (ctx, { postId }) => {
    const post = await ctx.db.get(postId)
    if (post?.status !== 'held') return false
    await ctx.db.patch(postId, { status: 'publishing', publishingAt: Date.now() })
    return true
  },
})

export const heldPosts = internalQuery({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId)
    if (!run?.automationId) return null
    const automation = await ctx.db.get(run.automationId)
    const posts = await ctx.db
      .query('posts')
      .withIndex('by_run', (q) => q.eq('runId', runId))
      .collect()
    const channels = automation
      ? await ctx.db
          .query('bufferChannels')
          .withIndex('by_user', (q) => q.eq('userId', automation.userId))
          .collect()
      : []
    return { automation, held: posts.filter((p) => p.status === 'held'), channels }
  },
})

export const markSent = internalMutation({
  args: {
    postId: v.id('posts'),
    status: v.string(),
    reason: v.optional(v.string()),
    bufferPostId: v.optional(v.string()),
    bufferStatus: v.optional(v.string()),
    externalLink: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    publishingAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { postId, ...patch }) => {
    const post = await ctx.db.get(postId)
    if (!post) return null
    await ctx.db.patch(postId, {
      ...patch,
      approveToken: patch.status === 'draft' ? crypto.randomUUID() : undefined,
    })
    if (patch.bufferPostId) {
      const run = await ctx.db.get(post.runId)
      // A post sent after the run finished is one that was held: the run log says so.
      if (run)
        await ctx.db.patch(post.runId, {
          posted: (run.posted ?? 0) + 1,
          ...(post.status === 'held' || (post.status === 'publishing' && run.finishedAt)
            ? {
                steps: [
                  ...run.steps,
                  { step: 'publish', at: Date.now(), note: 'A held post was sent to Buffer.' },
                ],
              }
            : {}),
        })
      await emitPostEvent(ctx, postId, 'post.created')
      if (!post.bufferPostId)
        await ctx.scheduler.runAfter(0, internal.buffer.addPostNote, { postId })
    }
    return null
  },
})

/** Sends the posts a run held back when Buffer's allowance ran out, once it has reset. */
export const sendHeld = internalAction({
  args: { runId: v.id('runs') },
  returns: v.null(),
  handler: async (ctx, { runId }) => {
    const loaded = await ctx.runQuery(internal.runs.heldPosts, { runId })
    if (!loaded?.automation || !loaded.held.length) return null
    const { automation, held, channels } = loaded
    // Deleted or paused while the posts waited: they stay out of Buffer, like the main pass.
    if (automation.deletedAt || automation.status !== 'active') {
      for (const post of held)
        await ctx.runMutation(internal.runs.markSent, {
          postId: post._id,
          status: 'skipped',
          reason: `The automation was ${automation.deletedAt ? 'deleted' : 'paused'} before Buffer could take this post.`,
        })
      return null
    }
    // A story skipped on the run page while its posts waited: they stay out of Buffer too.
    for (const post of held.filter((p) => p.reviewSkipped))
      await ctx.runMutation(internal.runs.markSent, {
        postId: post._id,
        status: 'skipped',
        reason: 'You skipped this story before Buffer could take this post.',
      })
    const toSend = held.filter((p) => !p.reviewSkipped)
    if (!toSend.length) return null
    const tagByOrg = new Map<string, string | null>()
    const atLimit = await channelsAtLimit(ctx, automation.userId, [
      ...new Set(toSend.map((p) => p.channelId)),
    ])
    let dueAt = Date.now() + SPREAD_FIRST_MS
    for (const post of toSend) {
      const row = channels.find((c) => c.channelId === post.channelId)
      if (!row) continue
      if (atLimit.has(post.channelId)) {
        await ctx.runMutation(internal.runs.markSent, {
          postId: post._id,
          status: 'skipped',
          reason: `${row.displayName ?? row.name} is at its daily posting limit in Buffer.`,
        })
        continue
      }
      // A planned or dated post keeps its day. If that time has passed while Buffer was busy, it
      // is not posted late or moved onto another story's day.
      const mode = postModeFor(automation.postingMode as PostingMode, post.plannedFor)
      if (mode === 'planned' && (!post.plannedFor || post.plannedFor < Date.now() + PLAN_LEAD_MS)) {
        await ctx.runMutation(internal.runs.markSent, {
          postId: post._id,
          status: 'skipped',
          reason: post.plannedFor
            ? `Its planned time, ${slotLabel(post.plannedFor, automation.timezone)}, passed while Buffer was busy, so it was not posted late.`
            : 'It had no planned posting time.',
        })
        continue
      }
      try {
        if (!tagByOrg.has(row.organizationId))
          tagByOrg.set(
            row.organizationId,
            await ensureTag(ctx, automation.userId, row.organizationId),
          )
        // As in the main pass: the row says `publishing` before the call, so a send that dies
        // half-way is failed by the sweeper rather than sent again. The claim only wins while the
        // post is still held, so two sendHelds that overlap never both send it.
        if (!(await ctx.runMutation(internal.runs.claimHeld, { postId: post._id }))) continue
        const created = await createBufferPost(ctx, automation.userId, {
          channelId: post.channelId,
          service: post.service,
          text: post.text,
          thread: post.thread,
          linkAttachment: post.linkAttachment,
          mode,
          dueAt: mode === 'spread' ? dueAt : mode === 'planned' ? post.plannedFor : undefined,
          tagId: tagByOrg.get(row.organizationId) ?? null,
        })
        if (mode === 'spread') dueAt += SPREAD_GAP_MS
        await ctx.runMutation(internal.runs.markSent, {
          postId: post._id,
          status:
            mode === 'draft' || created.status === 'draft'
              ? 'draft'
              : created.dueAt
                ? 'scheduled'
                : 'queued',
          bufferPostId: created.id,
          bufferStatus: created.status,
          externalLink: created.externalLink ?? undefined,
          dueAt: created.dueAt ? Date.parse(created.dueAt) : undefined,
        })
      } catch (error) {
        // Still out of calls, or Buffer asked us to slow down: the rest wait for the next window.
        const rateLimited =
          error instanceof BufferBudgetError ||
          (error instanceof BufferApiError && error.status === 429)
        if (rateLimited) {
          const retryAt =
            error instanceof BufferBudgetError ? error.retryAt : Date.now() + 15 * 60_000
          await ctx.runMutation(internal.runs.markSent, {
            postId: post._id,
            status: 'held',
            reason: 'Waiting for Buffer to accept more posts.',
          })
          await ctx.runMutation(internal.runs.bookHeldRetry, { runId, at: retryAt + 30_000 })
          return null
        }
        await ctx.runMutation(internal.runs.markSent, {
          postId: post._id,
          status: 'failed',
          reason: bufferDidNotAnswer(error)
            ? 'Buffer did not answer while this post was being sent. Check Buffer before sending it again.'
            : error instanceof Error
              ? error.message
              : String(error),
        })
      }
    }
    return null
  },
})

/** The runs of one automation, newest first, for the Runs tab. */
export const listByAutomation = query({
  args: { automationId: v.id('automations') },
  handler: async (ctx, { automationId }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return []
    return await listRunsFor(ctx, userId, automationId)
  },
})

/** The runs of one of the person's automations, newest first; `before` pages by startedAt. */
export async function listRunsFor(
  ctx: QueryCtx,
  userId: Id<'users'>,
  automationId: Id<'automations'>,
  limit = 50,
  before?: number,
) {
  {
    const automation = await ctx.db.get(automationId)
    if (!automation || automation.userId !== userId) return []
    const runs = await ctx.db
      .query('runs')
      .withIndex('by_automation_startedAt', (q) =>
        before === undefined
          ? q.eq('automationId', automationId)
          : q.eq('automationId', automationId).lt('startedAt', before),
      )
      .order('desc')
      .take(Math.min(Math.max(limit, 1), 50))
    return runs.map((r) => ({
      _id: r._id,
      kind: r.kind,
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt ?? null,
      found: r.found ?? 0,
      kept: r.kept ?? 0,
      posted: r.posted ?? 0,
      // Absent on dry runs from before it was counted: unknown, not zero.
      wouldSend: r.wouldSend ?? null,
      costUsd: r.costUsd,
      last: r.steps.at(-1)?.note ?? '',
    }))
  }
}

/** One run with its stories and posts, live while it runs. */
export const get = query({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    return await getRunFor(ctx, userId, runId)
  },
})

export async function getRunFor(ctx: QueryCtx, userId: Id<'users'>, runId: Id<'runs'>) {
  const run = await ctx.db.get(runId)
  if (!run || run.userId !== userId || !run.automationId) return null
  const automation = await ctx.db.get(run.automationId)
  if (!automation || automation.deletedAt) return null
  return await runView(ctx, run, userId)
}

/** A shared run, by its link, for anyone. Same view, no approve tokens or ids that matter. */
export const shared = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!token) return null
    const run = await ctx.db
      .query('runs')
      .withIndex('by_shareToken', (q) => q.eq('shareToken', token))
      .first()
    if (!run?.userId || !run.automationId) return null
    return await runView(ctx, run, run.userId, true)
  },
})

/** Makes a run shareable and returns the token; a second call returns the same token. */
export const share = mutation({
  args: { runId: v.id('runs') },
  returns: v.string(),
  handler: async (ctx, { runId }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not signed in')
    return await shareFor(ctx, userId, runId)
  },
})

export async function shareFor(
  ctx: MutationCtx,
  userId: Id<'users'>,
  runId: Id<'runs'>,
): Promise<string> {
  const run = await ctx.db.get(runId)
  if (!run || run.userId !== userId) throw new ConvexError('Run not found')
  if (run.shareToken) return run.shareToken
  const token = crypto.randomUUID().replaceAll('-', '')
  await ctx.db.patch(runId, { shareToken: token })
  return token
}

export const unshare = mutation({
  args: { runId: v.id('runs') },
  returns: v.null(),
  handler: async (ctx, { runId }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not signed in')
    const run = await ctx.db.get(runId)
    if (!run || run.userId !== userId) throw new ConvexError('Run not found')
    await ctx.db.patch(runId, { shareToken: undefined })
    return null
  },
})

/** Fires a post event to the person's webhooks with the post as the API shows it. */
export async function emitPostEvent(
  ctx: MutationCtx,
  postId: Id<'posts'>,
  type: 'post.created' | 'post.approved' | 'post.sent',
  extra: Record<string, unknown> = {},
) {
  const post = await ctx.db.get(postId)
  if (!post) return
  const channel = await ctx.db
    .query('bufferChannels')
    .withIndex('by_user_channel', (q) =>
      q.eq('userId', post.userId).eq('channelId', post.channelId),
    )
    .first()
  const automation = await ctx.db.get(post.automationId)
  await emit(
    ctx,
    post.userId,
    type,
    {
      post: postView(post, channel?.displayName ?? channel?.name ?? serviceLabel(post.service)),
      automation: automation ? { id: automation._id, name: automation.name } : null,
      ...extra,
    },
    post.automationId,
  )
}

export async function runView(
  ctx: QueryCtx,
  run: Doc<'runs'>,
  userId: Id<'users'>,
  isShared = false,
) {
  const runId = run._id
  {
    const automation = run.automationId ? await ctx.db.get(run.automationId) : null
    const stories = await ctx.db
      .query('stories')
      .withIndex('by_run', (q) => q.eq('runId', runId))
      .collect()
    const posts = await ctx.db
      .query('posts')
      .withIndex('by_run', (q) => q.eq('runId', runId))
      .collect()
    const channels = await ctx.db
      .query('bufferChannels')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    const names = new Map(channels.map((c) => [c.channelId, c.name]))
    const limits = new Map(channels.map((c) => [c.channelId, c.maxLength] as const))
    // The earlier story a repeat matched, so the page can show what was already posted.
    const earlier = new Map<Id<'stories'>, { title: string; runId: Id<'runs'> }>()
    for (const s of stories)
      if (s.dupOf && !earlier.has(s.dupOf)) {
        const match = await ctx.db.get(s.dupOf)
        if (match) earlier.set(s.dupOf, { title: match.title, runId: match.runId })
      }
    return {
      _id: run._id,
      automationId: run.automationId!,
      automationName: automation?.name ?? '',
      timezone: automation?.timezone ?? 'UTC',
      kind: run.kind,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt ?? null,
      steps: run.steps,
      usage: run.usage,
      costUsd: run.costUsd,
      // A shared run is public: the raw error and the hint (which can be a hook's private text)
      // stay with the owner.
      error: isShared ? null : (run.error ?? null),
      shareToken: run.shareToken ?? null,
      startedBy: run.startedBy ?? 'schedule',
      hint: isShared ? null : (run.hint ?? null),
      /** What the owner can do next from this run: turn the automation on, see when it runs. */
      automation:
        isShared || !automation
          ? null
          : {
              status: automation.status,
              nextRunAt:
                automation.status === 'active'
                  ? (automation.nextRunSetFor ?? automation.nextRunAt ?? null)
                  : null,
            },
      stories: stories.map((s) => ({
        _id: s._id,
        title: s.title,
        url: s.canonicalUrl,
        source: s.source,
        publishedAt: s.publishedAt,
        eventDate: s.eventDate ?? null,
        forDate: s.forDate ?? null,
        summary: s.summary,
        whyItMatters: s.whyItMatters,
        keyFacts: s.keyFacts,
        confidence: s.confidence,
        decision: s.decision,
        reason: s.reason,
        savedAsIdea: Boolean(s.ideaId),
        review: isShared ? null : (s.review ?? null),
        repeatOf: s.dupOf
          ? {
              title: earlier.get(s.dupOf)?.title ?? null,
              runId: isShared ? null : (earlier.get(s.dupOf)?.runId ?? null),
            }
          : null,
      })),
      posts: posts.map((p) => ({
        _id: p._id,
        storyId: p.storyId,
        channelId: p.channelId,
        bufferPostId: p.bufferPostId ?? null,
        channelName: names.get(p.channelId) ?? serviceLabel(p.service),
        service: p.service,
        text: p.text,
        thread: p.thread ?? null,
        linkAttachment: p.linkAttachment ?? null,
        status: p.status,
        limit: limits.get(p.channelId) ?? SERVICE_LIMITS[p.service as Service]?.maxLength ?? 280,
        reason: p.reason ?? null,
        bufferStatus: p.bufferStatus ?? null,
        externalLink: p.externalLink ?? null,
        dueAt: p.dueAt ?? null,
        plannedFor: p.plannedFor ?? null,
        sentAt: p.sentAt ?? null,
        metrics: p.metrics ?? null,
      })),
    }
  }
}

/** Editorial feedback is private. Buffer posts keep their actual status. */
export const skipStory = mutation({
  args: { storyId: v.id('stories'), reason: v.string() },
  handler: async (ctx, { storyId, reason }) => {
    const story = await ctx.db.get(storyId)
    if (!story) throw new ConvexError('Story not found')
    await ownAutomation(ctx, story.automationId)
    const run = await ctx.db.get(story.runId)
    if (!run?.finishedAt) throw new ConvexError('Wait for this run to finish before reviewing it.')
    if (!['kept', 'dry'].includes(story.decision))
      throw new ConvexError('Only a selected story can be skipped.')
    const clean = reason.trim()
    if (clean.length < 3 || clean.length > 500)
      throw new ConvexError('Give a reason between 3 and 500 characters.')
    if (story.review) return null
    const posts = await ctx.db
      .query('posts')
      .withIndex('by_run', (q) => q.eq('runId', story.runId))
      .collect()
    const related = posts.filter((p) => p.storyId === storyId)
    if (related.some((p) => p.approvingAt && Date.now() - p.approvingAt < 10 * 60_000))
      throw new ConvexError('A post is being approved. Wait for it to finish, then try again.')
    await ctx.db.patch(storyId, { review: { reason: clean, at: Date.now() } })
    for (const post of related) await ctx.db.patch(post._id, { reviewSkipped: true })
    return null
  },
})

/** Undo the editorial skip; any explicitly accepted playbook rule stays in the playbook. */
export const undoSkipStory = mutation({
  args: { storyId: v.id('stories') },
  handler: async (ctx, { storyId }) => {
    const story = await ctx.db.get(storyId)
    if (!story) throw new ConvexError('Story not found')
    await ownAutomation(ctx, story.automationId)
    await ctx.db.patch(storyId, { review: undefined })
    const posts = await ctx.db
      .query('posts')
      .withIndex('by_run', (q) => q.eq('runId', story.runId))
      .collect()
    for (const post of posts.filter((p) => p.storyId === storyId))
      await ctx.db.patch(post._id, { reviewSkipped: undefined })
    return null
  },
})

/** Accept the exact rule the person reviewed, merging into the latest playbook atomically. */
export const applyStoryRule = mutation({
  args: { storyId: v.id('stories'), rule: v.string() },
  handler: async (ctx, { storyId, rule }) => {
    const story = await ctx.db.get(storyId)
    if (!story) throw new ConvexError('Story not found')
    const automation = await ownAutomation(ctx, story.automationId)
    if (!story.review) throw new ConvexError('Skip this story and give a reason first.')
    if (story.review.appliedVersion) return story.review.appliedVersion
    const version = await addExcludeRuleFor(ctx, automation.userId, automation._id, rule)
    await ctx.db.patch(storyId, {
      review: {
        ...story.review,
        appliedRule: rule.trim(),
        appliedVersion: version,
      },
    })
    return version
  },
})

/** Changes one of this person's drafts before approving it, from the home or run page. */
export const editDraft = action({
  args: { postId: v.id('posts'), text: v.string() },
  returns: v.string(),
  handler: async (ctx, { postId, text }): Promise<string> => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not signed in')
    return await ctx.runAction(internal.approvals.editForUser, {
      userId,
      postId,
      text,
      from: 'app',
    })
  },
})

/** Moves one of this person's drafts into the queue, from the run page. */
export const approve = action({
  args: { postId: v.id('posts') },
  returns: v.string(),
  handler: async (ctx, { postId }): Promise<string> => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not signed in')
    return await ctx.runAction(internal.approvals.approveForUser, { userId, postId })
  },
})

/**
 * A failure on Dispatchlet's side rather than the person's: the AI busy, rate limited, down or
 * unreadable; Buffer down or rate limiting us; or a service not answering at all. Returns the note
 * to show, or null for anything else (a bad key, lost Buffer access, a real problem with the run).
 */
export function serviceFailure(error: unknown): string | null {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status: unknown }).status)
      : NaN
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof BufferBudgetError) return error.message
  if (error instanceof BufferApiError) {
    if (status === 429 || status >= 500)
      return 'Buffer was not answering properly, so the run stopped. Try again in a few minutes.'
    return null
  }
  if (status === 401 || status === 403) return null
  if (status === 429 || status === 529 || /overloaded/i.test(message))
    return 'The AI service was too busy to finish this run. Try again in a few minutes.'
  if (status >= 500 || /Failed to parse structured output/.test(message))
    return 'The AI service had a problem and the run stopped. Try again in a few minutes.'
  if (/fetch failed|network|ECONNRESET|ETIMEDOUT|timed out|aborted/i.test(message))
    return 'A service Dispatchlet relies on did not answer, so the run stopped. Try again in a few minutes.'
  return null
}

/** Gives back the free run a failed run was charged, once. */
export const refundFreeRun = internalMutation({
  args: { runId: v.id('runs') },
  returns: v.null(),
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId)
    if (!run?.freeRun || !run.userId) return null
    const user = await ctx.db.get(run.userId)
    if (user) {
      await ctx.db.patch(
        user._id,
        run.kind === 'dry'
          ? { freeDryRunsUsed: Math.max(0, (user.freeDryRunsUsed ?? 0) - 1) }
          : { freeRunsUsed: Math.max(0, (user.freeRunsUsed ?? 0) - 1) },
      )
    }
    await ctx.db.patch(runId, { freeRun: undefined })
    return null
  },
})

/**
 * Says why a scheduled run started after its set time, when spreadStart moved it out of a busy
 * minute. Under 10 seconds is just the scheduler and says nothing.
 */
export function lateNote(late: number | undefined, timezone: string, now = Date.now()): string {
  if (late === undefined || late < 10_000 || late > 60 * 60_000) return ''
  const setFor = new Date(now - late).toLocaleTimeString('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  })
  const minutes = Math.round(late / 60_000)
  const gap = late < 60_000 ? 'A few seconds' : minutes === 1 ? '1 minute' : `${minutes} minutes`
  return ` ${gap} after ${setFor}, because a lot of runs were set for then.`
}

/** Stories worth keeping for later: good ones that missed the cut, and a dry run's picks. */
export const IDEA_DECISIONS = new Set(['skipped_limit', 'skipped_quality', 'dry'])

export const ideaContext = internalQuery({
  args: { userId: v.id('users'), storyId: v.id('stories') },
  handler: async (ctx, { userId, storyId }) => {
    const story = await ctx.db.get(storyId)
    const automation = story ? await ctx.db.get(story.automationId) : null
    if (!story || !automation || automation.userId !== userId) return null
    const channels = await ctx.db
      .query('bufferChannels')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    const mine = channels.filter((c) => automation.channelIds.includes(c.channelId))
    const connection = await ctx.db
      .query('bufferConnections')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()
    return {
      story,
      canWriteIdeas: connection?.scope.split(' ').includes('ideas:write') ?? false,
      organizationId: mine[0]?.organizationId ?? channels[0]?.organizationId ?? null,
      services: [...new Set(mine.map((c) => c.service))],
    }
  },
})

export const markIdea = internalMutation({
  args: { storyId: v.id('stories'), ideaId: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { storyId, ideaId }) => {
    // Without an idea id this releases a claim after Buffer refused, so a retry can go ahead.
    await ctx.db.patch(storyId, { ...(ideaId ? { ideaId } : {}), ideaSavingAt: undefined })
    return null
  },
})

/** One save at a time per story, so a double click cannot put two ideas in Buffer. */
export const claimIdea = internalMutation({
  args: { storyId: v.id('stories') },
  returns: v.union(
    v.object({ kind: v.literal('claimed') }),
    v.object({ kind: v.literal('busy') }),
    v.object({ kind: v.literal('saved'), ideaId: v.string() }),
  ),
  handler: async (ctx, { storyId }) => {
    const story = await ctx.db.get(storyId)
    if (story?.ideaId) return { kind: 'saved' as const, ideaId: story.ideaId }
    if (story?.ideaSavingAt && Date.now() - story.ideaSavingAt < 10 * 60_000)
      return { kind: 'busy' as const }
    if (story) await ctx.db.patch(storyId, { ideaSavingAt: Date.now() })
    return { kind: 'claimed' as const }
  },
})

/** The text of an idea: what happened, why it matters, and where it came from. */
export function ideaText(story: {
  summary: string
  whyItMatters: string
  source: string
  canonicalUrl: string
}): string {
  return [story.summary, story.whyItMatters, `Source: ${story.source}, ${story.canonicalUrl}`]
    .filter((part) => part.trim())
    .join('\n\n')
}

/** Saves one story to Buffer Ideas for the person, once. Shared by the app, the API and MCP. */
export const saveIdeaForUser = internalAction({
  args: { userId: v.id('users'), storyId: v.id('stories') },
  returns: v.string(),
  handler: async (ctx, { userId, storyId }): Promise<string> => {
    const found = await ctx.runQuery(internal.runs.ideaContext, { userId, storyId })
    if (!found) throw new ConvexError('Story not found')
    const { story, organizationId, services, canWriteIdeas } = found
    if (story.ideaId) return story.ideaId
    if (!IDEA_DECISIONS.has(story.decision))
      throw new ConvexError(
        'Only stories that were skipped or picked on a dry run can be saved as ideas.',
      )
    if (!canWriteIdeas)
      throw new ConvexError('Reconnect Buffer in settings to let Dispatchlet save ideas.')
    if (!organizationId) throw new ConvexError('Sync your Buffer channels first.')
    const claim = await ctx.runMutation(internal.runs.claimIdea, { storyId })
    if (claim.kind === 'saved') return claim.ideaId
    if (claim.kind === 'busy')
      throw new ConvexError('This story is already being saved to Buffer Ideas.')
    try {
      const ideaId = await createBufferIdea(ctx, userId, organizationId, {
        title: story.title.slice(0, 200),
        text: ideaText(story),
        services,
      })
      await ctx.runMutation(internal.runs.markIdea, { storyId, ideaId })
      return ideaId
    } catch (error) {
      await ctx.runMutation(internal.runs.markIdea, { storyId })
      throw error
    }
  },
})

/** From the run page: saves a story that missed the cut to Buffer Ideas. */
export const saveIdea = action({
  args: { storyId: v.id('stories') },
  returns: v.string(),
  handler: async (ctx, { storyId }): Promise<string> => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not signed in')
    return await ctx.runAction(internal.runs.saveIdeaForUser, { userId, storyId })
  },
})

/** Why a channel was left out of a run, as the end of a sentence. */
export function channelIssue(channel: { problem?: string }): string {
  if (channel.problem === 'locked')
    return 'it is locked in Buffer, usually by the plan’s channel limit'
  if (channel.problem === 'disconnected') return 'it is disconnected in Buffer'
  if (channel.problem === 'unsupported') return 'Dispatchlet can’t post to that network yet'
  return 'it needs attention in Buffer'
}

/** How long a run can go unfinished before it is taken as stopped (a Convex action lasts 10 minutes at most). */
const ABANDONED_AFTER = 15 * 60_000

/**
 * Every 10 minutes: closes runs that stopped part way, such as an action that hit its time limit,
 * so their pages stop showing "Researching" for ever. They give back their free run and do not
 * count toward pausing the automation, since stopping was on Dispatchlet's side.
 */
export const abandonedRuns = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    // Only unfinished runs are read, however many finished ones the day had.
    const rows = await ctx.db
      .query('runs')
      .withIndex('by_finishedAt_startedAt', (q) =>
        q.eq('finishedAt', undefined).lt('startedAt', now - ABANDONED_AFTER),
      )
      .collect()
    return rows.map((run) => ({
      _id: run._id,
      freeRun: Boolean(run.freeRun),
      posted: run.posted ?? 0,
    }))
  },
})

/** How long a post may sit in `publishing` before its run is taken to have died mid-call. */
const PUBLISHING_STALE_AFTER = ABANDONED_AFTER
/** How long a held post waits before the sweeper asks for it to be sent again. */
const HELD_STALE_AFTER = 2 * 3_600_000

/**
 * Posts whose run died around them: `publishing` rows older than the action limit (Buffer may or
 * may not have the post), and `held` rows whose sendHeld never came back.
 */
export const stalePosts = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    // Few posts are ever `publishing` at once, so reading them all and checking the stamp is cheap.
    const publishing = (
      await ctx.db
        .query('posts')
        .withIndex('by_status_createdAt', (q) => q.eq('status', 'publishing'))
        .collect()
    ).filter((p) => (p.publishingAt ?? p.createdAt) < now - PUBLISHING_STALE_AFTER)
    const held = await ctx.db
      .query('posts')
      .withIndex('by_status_createdAt', (q) =>
        q.eq('status', 'held').lt('createdAt', now - HELD_STALE_AFTER),
      )
      .collect()
    // Held posts wait as long as a day for the person's share, with a sendHeld booked for then.
    // Only a run with no booking, or one whose booked send never came back, is sent again.
    const heldRuns: Id<'runs'>[] = []
    for (const runId of new Set(held.map((p) => p.runId))) {
      const run = await ctx.db.get(runId)
      if (!run) continue
      if (run.heldRetryAt && run.heldRetryAt > now - HELD_STALE_AFTER) continue
      heldRuns.push(runId)
    }
    return { publishing: publishing.map((p) => p._id), heldRuns }
  },
})

export const sweepAbandoned = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    const runs = await ctx.runQuery(internal.runs.abandonedRuns, { now: Date.now() })
    for (const run of runs) {
      // A run that got posts into Buffer was used, even though it did not finish.
      const refund = run.freeRun && !run.posted
      if (refund) await ctx.runMutation(internal.runs.refundFreeRun, { runId: run._id })
      await ctx.runMutation(internal.runs.finish, {
        runId: run._id,
        status: 'failed',
        note: `This run stopped before it finished, on Dispatchlet’s side.${refund ? ' It did not use one of your free runs.' : ''} It does not count toward pausing this automation.`,
        error: 'abandoned',
        counts: false,
      })
    }
    const stale = await ctx.runQuery(internal.runs.stalePosts, { now: Date.now() })
    for (const postId of stale.publishing)
      await ctx.runMutation(internal.runs.markSent, {
        postId,
        status: 'failed',
        reason:
          'The run stopped while this post was being sent. Check Buffer before sending again.',
      })
    for (const runId of stale.heldRuns)
      await ctx.runMutation(internal.runs.bookHeldRetry, { runId, at: Date.now() })
    await ctx.runMutation(internal.alerts.beat, { kind: 'sweep-abandoned' })
    return runs.length
  },
})

/** An automation's status and deletion, read fresh just before a run sends anything. */
export const automationState = internalQuery({
  args: { automationId: v.id('automations') },
  handler: async (ctx, { automationId }) => {
    const a = await ctx.db.get(automationId)
    return a ? { status: a.status, deletedAt: a.deletedAt ?? null } : null
  },
})
