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
} from './_generated/server'
import { scheduleNext } from './automations'
import {
  BufferBudgetError,
  BufferPostError,
  channelsAtLimit,
  createBufferPost,
  ensureTag,
} from './buffer'
import { anthropicClient, callStructured, MODELS, type CallRecord } from './lib/ai/client'
import { EMPTY_USAGE } from './lib/ai/pricing'
import {
  allowedDomains,
  briefFromPlaybook,
  RESEARCH_LIMITS,
  RESEARCH_SYSTEM,
  ResearchResult,
  researchUserMessage,
  type Candidate,
} from './lib/ai/research'
import type { Service } from './lib/ai/setup'
import {
  checkPost,
  limitFor,
  repairUserMessage,
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

/** Stories below this confidence are never posted (SPEC §25). */
const MIN_CONFIDENCE = 0.5
/** Spread mode: posts in one run go out at least this far apart, starting soon. */
const SPREAD_GAP_MS = 2 * 60 * 60_000
const SPREAD_FIRST_MS = 10 * 60_000

type Kind = 'scheduled' | 'now' | 'dry'

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
    const automation = await ctx.db.get(automationId)
    if (!automation || automation.userId !== userId || automation.deletedAt)
      throw new Error('Automation not found')
    if (!automation.playbookVersionId) throw new Error('The playbook is not ready yet')
    const running = await ctx.db
      .query('runs')
      .withIndex('by_automation_startedAt', (q) => q.eq('automationId', automationId))
      .order('desc')
      .first()
    if (running && !running.finishedAt && Date.now() - running.startedAt < 15 * 60_000)
      throw new Error('A run is already going')
    const runId = await beginRun(ctx, automation, dry ? 'dry' : 'now')
    if (!runId)
      throw new Error(
        dry
          ? 'No dry runs left.'
          : 'No free runs left. Add your own Anthropic key in settings to keep going.',
      )
    return runId
  },
})

/**
 * Books a run row and the action that does the work, after checking the allowance. A scheduled
 * run that the allowance does not cover is recorded as skipped so the person can see why.
 */
async function beginRun(
  ctx: Parameters<typeof scheduleNext>[0],
  automation: Doc<'automations'>,
  kind: Kind,
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
        note: kind === 'dry' ? 'Dry run started. Nothing will be sent to Buffer.' : 'Run started.',
      },
    ],
    usage: EMPTY_USAGE,
    costUsd: 0,
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
    const failures = status === 'failed' ? (automation.consecutiveFailures ?? 0) + 1 : 0
    await ctx.db.patch(automation._id, { consecutiveFailures: failures, updatedAt: Date.now() })
    if (failures >= 3 && automation.status === 'active') {
      await ctx.db.patch(automation._id, { status: 'failed' })
      await scheduleNext(ctx, { ...automation, status: 'failed' })
      await ctx.scheduler.runAfter(0, internal.email.sendPaused, {
        userId: automation.userId,
        automationId: automation._id,
      })
    }
    if (status === 'done' && run.kind !== 'dry' && (run.posted ?? 0) > 0)
      await ctx.scheduler.runAfter(0, internal.email.sendDigest, { runId })
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
        run.kind === 'scheduled'
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
        model: MODELS.research,
        effort: 'medium',
        maxTokens: 8_000,
        system: RESEARCH_SYSTEM,
        user: researchUserMessage(brief, {
          now: new Date(),
          timezone: automation.timezone,
          covered: covered.map((c) => ({ title: c.title, url: c.canonicalUrl })),
        }),
        schema: ResearchResult,
        tools: [
          {
            type: 'web_search_20260209',
            name: 'web_search',
            max_uses: RESEARCH_LIMITS.maxSearches,
            ...(domains ? { allowed_domains: domains } : {}),
          },
          {
            type: 'web_fetch_20260209',
            name: 'web_fetch',
            max_uses: RESEARCH_LIMITS.maxFetches,
            max_content_tokens: RESEARCH_LIMITS.maxFetchTokens,
            ...(domains ? { allowed_domains: domains } : {}),
          },
        ],
      })
      await record(ctx, runId, 'research', research.record)
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
      // oxlint-disable-next-line unicorn/no-array-sort -- the copy is sorted in place on purpose
      const ranked = [...found].sort((a, b) => b.confidence - a.confidence)
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
        if (c.confidence < MIN_CONFIDENCE) {
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
          reason: dry ? 'Kept for the dry run.' : 'Kept.',
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
        model: MODELS.write,
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

      // Posts that miss their limit get one more chance, as a narrower ask.
      let drafts: PostDraft[] = written.output.posts
      const failed = drafts.flatMap((draft) => {
        const channel = targets.find((t) => t.channelId === draft.channelId)
        if (!channel) return []
        const checked = checkPost(draft, channel, playbook, storyUrls)
        return checked.ok
          ? []
          : [{ post: draft, channel, limit: limitFor(channel, playbook), reason: checked.reason }]
      })
      if (failed.length) {
        await say(
          'write',
          `${failed.length} ${failed.length === 1 ? 'post' : 'posts'} missed the limit. Asking for a shorter version.`,
        )
        const repaired = await callStructured(client, {
          model: MODELS.write,
          effort: 'medium',
          maxTokens: 4_000,
          system: WRITE_SYSTEM,
          user: repairUserMessage(failed),
          schema: WriteResult,
        })
        await record(ctx, runId, 'repair', repaired.record)
        for (const fix of repaired.output?.posts ?? []) {
          const index = drafts.findIndex(
            (d) => d.channelId === fix.channelId && d.storyUrl === fix.storyUrl,
          )
          if (index >= 0) drafts = drafts.map((d, i) => (i === index ? fix : d))
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
            status: mode === 'draft' ? 'draft' : created.dueAt ? 'scheduled' : 'queued',
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
          const reason = error instanceof Error ? error.message : String(error)
          await ctx.runMutation(internal.runs.savePost, { ...base, status: 'failed', reason })
          await say('publish', `${channel.name}: Buffer did not take the post. ${reason}`)
          if (error instanceof BufferPostError && error.kind === 'limit')
            atLimit.add(channel.channelId)
          if (error instanceof BufferBudgetError) {
            // Buffer's shared allowance is spent: the rest of this run waits for the window to reset.
            held = { retryAt: error.retryAt, from: drafts.indexOf(draft) + 1 }
            break
          }
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
          status: mode === 'draft' ? 'draft' : created.dueAt ? 'scheduled' : 'queued',
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
    const automation = await ctx.db.get(automationId)
    if (!automation || automation.userId !== userId) return []
    const runs = await ctx.db
      .query('runs')
      .withIndex('by_automation_startedAt', (q) => q.eq('automationId', automationId))
      .order('desc')
      .take(50)
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
  },
})

/** One run with its stories and posts, live while it runs. */
export const get = query({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const run = await ctx.db.get(runId)
    if (!run || run.userId !== userId || !run.automationId) return null
    const automation = await ctx.db.get(run.automationId)
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
    return {
      _id: run._id,
      automationId: run.automationId,
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
        reason: p.reason ?? null,
        bufferStatus: p.bufferStatus ?? null,
        externalLink: p.externalLink ?? null,
        dueAt: p.dueAt ?? null,
        sentAt: p.sentAt ?? null,
        metrics: p.metrics ?? null,
      })),
    }
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
