import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'
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
import { scheduleNext } from './automations'
import {
  BufferBudgetError,
  BufferPostError,
  channelsAtLimit,
  createBufferPost,
  ensureTag,
} from './buffer'
import { BufferApiError } from './lib/buffer'
import { anthropicClient, callStructured, modelFor, type CallRecord } from './lib/ai/client'
import { EMPTY_USAGE } from './lib/ai/pricing'
import {
  allowedDomains,
  briefFromPlaybook,
  RESEARCH_SYSTEM,
  researchTools,
  ResearchResult,
  researchUserMessage,
  type Candidate,
} from './lib/ai/research'
import type { Service } from './lib/ai/setup'
import {
  checkPost,
  overBy,
  repairUserMessage,
  SERVICE_LIMITS,
  textLimitFor,
  withLink,
  withoutLink,
  WRITE_SYSTEM,
  WriteResult,
  writeUserMessage,
  type PostDraft,
  type TargetChannel,
} from './lib/ai/write'
import { canonicalUrl, duplicateOf } from './lib/dedupe'
import { allowanceFor, globalDailyCapUsd } from './lib/limits'
import type { Playbook } from './lib/playbook'
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

type Kind = 'scheduled' | 'now' | 'dry'

/**
 * The dry run a new automation starts by itself once its first playbook is written. Only when it
 * has never run and the account has a dry run left; otherwise nothing happens.
 */
export const firstDryRun = internalMutation({
  args: { automationId: v.id('automations') },
  returns: v.null(),
  handler: async (ctx, { automationId }) => {
    const automation = await ctx.db.get(automationId)
    if (!automation || automation.deletedAt || !automation.playbookVersionId) return null
    const ran = await ctx.db
      .query('runs')
      .withIndex('by_automation_startedAt', (q) => q.eq('automationId', automationId))
      .first()
    if (ran) return null
    const user = await ctx.db.get(automation.userId)
    if (!user || allowanceFor(user).dryRunsLeft === 0) return null
    await beginRun(ctx, automation, 'dry', { startedBy: 'first' })
    return null
  },
})

/** The scheduled entry point: books the run and starts it. Never throws, so the chain goes on. */
export const start = internalMutation({
  args: { automationId: v.id('automations') },
  returns: v.null(),
  handler: async (ctx, { automationId }) => {
    const automation = await ctx.db.get(automationId)
    if (!automation || automation.deletedAt || automation.status !== 'active') return null
    await scheduleNext(ctx, { ...automation, scheduledFnId: undefined })
    await beginRun(ctx, automation, 'scheduled')
    return null
  },
})

/** Starts a run now, or a dry run that writes posts but sends nothing. */
export const trigger = mutation({
  args: { automationId: v.id('automations'), dry: v.boolean() },
  returns: v.id('runs'),
  handler: async (ctx, { automationId, dry }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not signed in')
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
      throw new Error('Automation not found')
    if (!automation.playbookVersionId) throw new Error('The playbook is not ready yet')
    // The app's Run now works on a paused automation: a person pressed it. Callers outside the app
    // never run one Dispatchlet paused itself, and a hook never runs one the person paused.
    if (startedBy !== 'app') {
      if (automation.status === 'failed')
        throw new Error('This automation is paused after failed runs. Look at it in the app first.')
      if (automation.status === 'paused' && startedBy === 'hook')
        throw new Error('This automation is paused, so its hooks do not start runs.')
    }
    const running = await ctx.db
      .query('runs')
      .withIndex('by_automation_startedAt', (q) => q.eq('automationId', automationId))
      .order('desc')
      .first()
    if (running && !running.finishedAt && Date.now() - running.startedAt < 15 * 60_000)
      throw new Error('A run is already going. Wait for it to finish.')
    const runId = await beginRun(ctx, automation, dry ? 'dry' : 'now', { hint, startedBy })
    if (!runId)
      throw new Error(
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
  first: ' on its own, to show what the playbook finds',
}

function startNote(kind: Kind, from: { hint?: Hint; startedBy: StartedBy }): string {
  const where = STARTED_FROM[from.startedBy]
  const head =
    kind === 'dry'
      ? `Dry run started${where}. Nothing will be sent to Buffer.`
      : `Run started${where}.`
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
  from: { hint?: Hint; startedBy: StartedBy } = { startedBy: 'schedule' },
): Promise<Id<'runs'> | null> {
  const user = await ctx.db.get(automation.userId)
  if (!user) return null
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
        note: startNote(kind, from),
      },
    ],
    usage: EMPTY_USAGE,
    costUsd: 0,
    startedBy: from.startedBy,
    hint: from.hint,
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
    const since = Date.now() - 86_400_000
    const today = await ctx.db
      .query('aiCalls')
      .withIndex('by_createdAt', (q) => q.gte('createdAt', since))
      .collect()
    return {
      run,
      automation,
      playbook: version.playbook as Playbook,
      user,
      channels: channels.filter((c) => automation.channelIds.includes(c.channelId)),
      covered: covered.map((s) => ({ _id: s._id, title: s.title, canonicalUrl: s.canonicalUrl })),
      spentTodayUsd: today.reduce((sum, c) => sum + c.costUsd, 0),
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
    reason: v.optional(v.string()),
    bufferPostId: v.optional(v.string()),
    bufferStatus: v.optional(v.string()),
    externalLink: v.optional(v.string()),
    dueAt: v.optional(v.number()),
  },
  returns: v.id('posts'),
  handler: async (ctx, args) => {
    const approveToken = args.status === 'draft' ? crypto.randomUUID() : undefined
    const id = await ctx.db.insert('posts', { ...args, approveToken, createdAt: Date.now() })
    if (args.bufferPostId) {
      const run = await ctx.db.get(args.runId)
      if (run) await ctx.db.patch(args.runId, { posted: (run.posted ?? 0) + 1 })
      const user = await ctx.db.get(args.userId)
      if (user && !user.firstPostAt) await ctx.db.patch(user._id, { firstPostAt: Date.now() })
      await emitPostEvent(ctx, id, 'post.created')
    }
    return id
  },
})

export const finish = internalMutation({
  args: {
    runId: v.id('runs'),
    status: v.string(),
    note: v.string(),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { runId, status, note, error }) => {
    const run = await ctx.db.get(runId)
    if (!run) return null
    await ctx.db.patch(runId, {
      status,
      finishedAt: Date.now(),
      error,
      steps: [...run.steps, { step: status, at: Date.now(), note }],
    })
    if (!run.automationId) return null
    const automation = await ctx.db.get(run.automationId)
    if (!automation) return null
    const countsAsFailure = status === 'failed' && run.kind !== 'dry'
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

async function record(ctx: ActionCtx, runId: Id<'runs'>, purpose: string, r: CallRecord) {
  await ctx.runMutation(internal.ai.recordCall, { runId, purpose, ...r })
}

/** The run: research, dedupe, write, publish. Each step is logged as it finishes. */
export const execute = internalAction({
  args: { runId: v.id('runs') },
  returns: v.null(),
  handler: async (ctx, { runId }) => {
    const loaded = await ctx.runQuery(internal.runs.load, { runId })
    if (!loaded) return null
    const { run, automation, playbook, user, channels, covered, spentTodayUsd } = loaded
    const dry = run.kind === 'dry'
    const say = (step: string, note: string, status?: string) =>
      ctx.runMutation(internal.runs.logStep, { runId, step, note, status })
    const fail = (note: string) =>
      ctx.runMutation(internal.runs.finish, { runId, status: 'failed', note, error: note })
    try {
      if (
        !allowanceFor(user).ownKey &&
        spentTodayUsd >= globalDailyCapUsd() &&
        (run.kind === 'scheduled' || (run.startedBy !== undefined && run.startedBy !== 'app'))
      ) {
        await ctx.runMutation(internal.runs.finish, {
          runId,
          status: 'skipped',
          note: 'Dispatchlet has used its daily AI budget. The run will go ahead tomorrow.',
        })
        await ctx.runMutation(internal.alerts.notifyOwner, {
          kind: 'spend-cap',
          detail: `Daily cap of $${globalDailyCapUsd()} reached`,
        })
        return null
      }
      const usable = channels.filter((c) => c.usable)
      if (!usable.length) {
        await fail(
          'None of the channels can post right now. Check them in Buffer, then sync channels in settings.',
        )
        return null
      }
      for (const c of channels)
        if (!c.usable) await say('channels', `${c.name} skipped: it needs attention in Buffer.`)

      const client = anthropicClient(await keyFor(user))
      const brief = briefFromPlaybook(playbook, {
        onlyTheseSources: automation.setup.onlyTheseSources,
        maxPostsPerRun: automation.maxPostsPerRun,
      })
      const domains = allowedDomains(brief)
      const research = await callStructured(client, {
        model: modelFor('research'),
        effort: 'high',
        maxTokens: 8_000,
        system: RESEARCH_SYSTEM,
        user: researchUserMessage(brief, {
          now: new Date(),
          timezone: automation.timezone,
          covered: covered.map((c) => ({ title: c.title, url: c.canonicalUrl })),
          requested: run.hint ?? null,
        }),
        schema: ResearchResult,
        tools: researchTools(domains),
      })
      await record(ctx, runId, 'research', research.record)
      // Searches and page opens that failed, by the tool's own error code, so the log says why.
      for (const e of research.toolErrors)
        await say(
          'research',
          `A ${e.tool === 'web_fetch' ? 'page open' : 'search'} failed (${e.code}): ${e.input}`,
        )
      if (!research.output) {
        await fail(
          research.record.refusal
            ? `Research was declined: ${research.record.refusal}`
            : 'Research returned nothing usable.',
        )
        return null
      }
      const found = research.output.candidates
      await say(
        'research',
        `Searched ${research.record.usage.webSearches} times and opened ${research.record.usage.webFetches} pages. Found ${found.length} ${found.length === 1 ? 'story' : 'stories'}.`,
      )
      if (research.output.notes) await say('research', research.output.notes)

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
            reason: `Not sure enough it is new and on topic (${Math.round(c.confidence * 100)}%).`,
          })
          continue
        }
        const kept = decided.filter((d) => d.decision === 'kept' || d.decision === 'dry').length
        if (kept >= automation.maxPostsPerRun) {
          decided.push({
            ...c,
            canonicalUrl: url,
            decision: 'skipped_limit',
            reason: `Over the ${automation.maxPostsPerRun} a run you asked for.`,
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
        stories: decided.map(({ dupOf, ...s }) => ({ ...s, dupOf })),
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
        `Writing ${keep.length * usable.length} ${keep.length * usable.length === 1 ? 'post' : 'posts'}.`,
        'writing',
      )
      const targets: TargetChannel[] = usable.map((c) => ({
        channelId: c.channelId,
        service: c.service as Service,
        name: c.name,
        maxLength: c.maxLength ?? null,
      }))
      const written = await callStructured(client, {
        model: modelFor('write'),
        effort: 'medium',
        maxTokens: 8_000,
        system: WRITE_SYSTEM,
        user: writeUserMessage(playbook, keep, targets),
        schema: WriteResult,
      })
      await record(ctx, runId, 'write', written.record)
      if (!written.output) {
        await fail(
          written.record.refusal
            ? `Writing was declined: ${written.record.refusal}`
            : 'Writing returned nothing usable.',
        )
        return null
      }
      const storyUrls = new Set(keep.map((k) => k.canonicalUrl))
      const byUrl = new Map(keep.map((k) => [k.canonicalUrl, k]))

      // The system adds the link on channels without a card, then posts that miss their limit get
      // up to two narrower asks that say how much to cut.
      let drafts: PostDraft[] = written.output.posts.map((d) => {
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
        const n = failed.length
        const posts = `${n} ${n === 1 ? 'post' : 'posts'}`
        const tooLong = failed.filter((f) => f.over > 0).length
        await say(
          'write',
          tooLong === n
            ? `${posts} missed the limit. Asking for a shorter version.`
            : tooLong === 0
              ? `${posts} need a rewrite. ${failed[0]!.reason}`
              : `${posts} need a rewrite, ${tooLong} for length.`,
        )
        const repaired = await callStructured(client, {
          model: modelFor('write'),
          effort: 'high',
          maxTokens: 4_000,
          system: WRITE_SYSTEM,
          user: repairUserMessage(failed),
          schema: WriteResult,
        })
        await record(ctx, runId, 'repair', repaired.record)
        for (const fix of repaired.output?.posts ?? []) {
          const channel = targets.find((t) => t.channelId === fix.channelId)
          const index = drafts.findIndex(
            (d) => d.channelId === fix.channelId && d.storyUrl === fix.storyUrl,
          )
          if (index >= 0 && channel)
            drafts = drafts.map((d, i) => (i === index ? withLink(fix, channel) : d))
        }
      }
      const atLimit = dry
        ? new Set<string>()
        : await channelsAtLimit(
            ctx,
            user._id,
            targets.map((t) => t.channelId),
          )
      const tagByOrg = new Map<string, string | null>()
      let dueAt = Date.now() + SPREAD_FIRST_MS
      let published = 0
      let held: { retryAt: number; from: number } | null = null
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
        if (dry) {
          await ctx.runMutation(internal.runs.savePost, { ...base, status: 'dry' })
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
        if (published === 0) await say('publish', 'Sending to Buffer.', 'publishing')
        if (!tagByOrg.has(row.organizationId))
          tagByOrg.set(row.organizationId, await ensureTag(ctx, user._id, row.organizationId))
        const mode = automation.postingMode as 'draft' | 'queue' | 'spread'
        try {
          const created = await createBufferPost(ctx, user._id, {
            channelId: channel.channelId,
            service: channel.service,
            text: checked.post.text,
            thread: checked.post.thread ?? undefined,
            linkAttachment: checked.post.linkAttachment ?? undefined,
            mode,
            dueAt: mode === 'spread' ? dueAt : undefined,
            tagId: tagByOrg.get(row.organizationId) ?? null,
          })
          if (mode === 'spread') dueAt += SPREAD_GAP_MS
          await ctx.runMutation(internal.runs.savePost, {
            ...base,
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
            `${channel.name}: ${mode === 'draft' ? 'saved as a draft' : created.dueAt ? `scheduled for ${new Date(created.dueAt).toLocaleString('en-GB', { timeZone: automation.timezone, dateStyle: 'medium', timeStyle: 'short' })}` : 'added to the queue'}.`,
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
            held = { retryAt, from: drafts.indexOf(draft) }
            break
          }
          const reason = error instanceof Error ? error.message : String(error)
          await ctx.runMutation(internal.runs.savePost, { ...base, status: 'failed', reason })
          await say('publish', `${channel.name}: Buffer did not take the post. ${reason}`)
          if (error instanceof BufferPostError && error.kind === 'limit')
            atLimit.add(channel.channelId)
          if (!(error instanceof BufferPostError)) throw error
        }
      }
      if (held) {
        for (const draft of drafts.slice(held.from)) {
          const channel = targets.find((t) => t.channelId === draft.channelId)
          const story = byUrl.get(draft.storyUrl) ?? byUrl.get(canonicalUrl(draft.storyUrl))
          if (!channel || !story) continue
          await ctx.runMutation(internal.runs.savePost, {
            userId: user._id,
            automationId: automation._id,
            runId,
            storyId: story._id,
            channelId: channel.channelId,
            service: channel.service,
            text: draft.text,
            thread: draft.thread ?? undefined,
            linkAttachment: draft.linkAttachment ?? undefined,
            status: 'held',
            reason: 'Waiting for Buffer’s API allowance to reset.',
          })
        }
        await ctx.runMutation(internal.runs.finish, {
          runId,
          status: 'done',
          note: `${published} ${published === 1 ? 'post' : 'posts'} in Buffer. The rest waited for Buffer’s API allowance, which resets at ${new Date(held.retryAt).toLocaleTimeString('en-GB', { timeZone: automation.timezone, hour: '2-digit', minute: '2-digit' })}; they will be sent then.`,
        })
        await ctx.scheduler.runAt(held.retryAt + 30_000, internal.runs.sendHeld, { runId })
        return null
      }
      await ctx.runMutation(internal.runs.finish, {
        runId,
        status: 'done',
        note: dry
          ? `Dry run finished. ${keep.length} ${keep.length === 1 ? 'story' : 'stories'} and the posts it would send are below. Nothing went to Buffer.`
          : `Done. ${published} ${published === 1 ? 'post' : 'posts'} in Buffer.`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/401|invalid x-api-key|authentication/i.test(message) && user.anthropicKeyEnc)
        await ctx.runMutation(internal.users.markKeyInvalid, { userId: user._id })
      await fail(message)
    }
    return null
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
      if (run)
        await ctx.db.patch(post.runId, {
          posted: (run.posted ?? 0) + 1,
          steps: [
            ...run.steps,
            { step: 'publish', at: Date.now(), note: 'A held post was sent to Buffer.' },
          ],
        })
      await emitPostEvent(ctx, postId, 'post.created')
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
    const mode = automation.postingMode as 'draft' | 'queue' | 'spread'
    const tagByOrg = new Map<string, string | null>()
    let dueAt = Date.now() + SPREAD_FIRST_MS
    for (const post of held) {
      const row = channels.find((c) => c.channelId === post.channelId)
      if (!row) continue
      try {
        if (!tagByOrg.has(row.organizationId))
          tagByOrg.set(
            row.organizationId,
            await ensureTag(ctx, automation.userId, row.organizationId),
          )
        const created = await createBufferPost(ctx, automation.userId, {
          channelId: post.channelId,
          service: post.service,
          text: post.text,
          thread: post.thread,
          linkAttachment: post.linkAttachment,
          mode,
          dueAt: mode === 'spread' ? dueAt : undefined,
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
        if (error instanceof BufferBudgetError) {
          await ctx.scheduler.runAt(error.retryAt + 30_000, internal.runs.sendHeld, { runId })
          return null
        }
        await ctx.runMutation(internal.runs.markSent, {
          postId: post._id,
          status: 'failed',
          reason: error instanceof Error ? error.message : String(error),
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
    return await runView(ctx, run, run.userId)
  },
})

/** Makes a run shareable and returns the token; a second call returns the same token. */
export const share = mutation({
  args: { runId: v.id('runs') },
  returns: v.string(),
  handler: async (ctx, { runId }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not signed in')
    return await shareFor(ctx, userId, runId)
  },
})

export async function shareFor(
  ctx: MutationCtx,
  userId: Id<'users'>,
  runId: Id<'runs'>,
): Promise<string> {
  const run = await ctx.db.get(runId)
  if (!run || run.userId !== userId) throw new Error('Run not found')
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
    if (!userId) throw new Error('Not signed in')
    const run = await ctx.db.get(runId)
    if (!run || run.userId !== userId) throw new Error('Run not found')
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
      post: postView(post, channel?.displayName ?? channel?.name ?? post.service),
      automation: automation ? { id: automation._id, name: automation.name } : null,
      ...extra,
    },
    post.automationId,
  )
}

export async function runView(ctx: QueryCtx, run: Doc<'runs'>, userId: Id<'users'>) {
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
      error: run.error ?? null,
      shareToken: run.shareToken ?? null,
      startedBy: run.startedBy ?? 'schedule',
      hint: run.hint ?? null,
      stories: stories.map((s) => ({
        _id: s._id,
        title: s.title,
        url: s.canonicalUrl,
        source: s.source,
        publishedAt: s.publishedAt,
        summary: s.summary,
        whyItMatters: s.whyItMatters,
        keyFacts: s.keyFacts,
        confidence: s.confidence,
        decision: s.decision,
        reason: s.reason,
      })),
      posts: posts.map((p) => ({
        _id: p._id,
        storyId: p.storyId,
        channelId: p.channelId,
        channelName: names.get(p.channelId) ?? p.service,
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
        sentAt: p.sentAt ?? null,
        metrics: p.metrics ?? null,
      })),
    }
  }
}

/** Changes one of this person's drafts before approving it, from the home or run page. */
export const editDraft = action({
  args: { postId: v.id('posts'), text: v.string() },
  returns: v.string(),
  handler: async (ctx, { postId, text }): Promise<string> => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not signed in')
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
    if (!userId) throw new Error('Not signed in')
    return await ctx.runAction(internal.approvals.approveForUser, { userId, postId })
  },
})
