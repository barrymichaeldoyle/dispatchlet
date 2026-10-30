import { getAuthUserId } from '@convex-dev/auth/server'
import { v, type Infer } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server'
import { isTextService } from './buffer'
import { SetupAnswers, type Service } from './lib/ai/setup'
import { SERVICE_LIMITS } from './lib/ai/write'
import {
  allowanceFor,
  automationCap,
  generationsPerDay,
  runsPerMinute,
  scheduleSpreadMinutes,
} from './lib/limits'
import { Playbook, parsePlaybook, renderPlaybook } from './lib/playbook'
import { nextRunAt, type Cadence } from './lib/schedule'
import { cadenceValidator, setupValidator } from './schema'

/**
 * Counts one playbook generation for a person on Dispatchlet's key and refuses past the daily cap.
 * Someone with their own key pays for it, so they are not counted.
 */
async function claimGeneration(ctx: MutationCtx, user: Doc<'users'>): Promise<void> {
  if (allowanceFor(user).ownKey) return
  const day = new Date().toISOString().slice(0, 10)
  const used = user.generationDay === day ? (user.generationsToday ?? 0) : 0
  if (used >= generationsPerDay())
    throw new Error(
      'No playbook generations left today. Try again tomorrow, or add your own Anthropic key.',
    )
  await ctx.db.patch(user._id, { generationDay: day, generationsToday: used + 1 })
}

/** The longest playbook text accepted, so a huge playbook cannot inflate every run's prompt. */
const MAX_PLAYBOOK_CHARS = 20_000

async function viewerId(ctx: QueryCtx | MutationCtx): Promise<Id<'users'>> {
  const userId = await getAuthUserId(ctx)
  if (!userId) throw new Error('Not signed in')
  return userId
}

/** The automation, if it is the signed-in person's and not deleted. */
export async function ownAutomation(
  ctx: QueryCtx | MutationCtx,
  id: Id<'automations'>,
): Promise<Doc<'automations'>> {
  return await automationOf(ctx, await viewerId(ctx), id)
}

/** The automation, if it belongs to the given person and is not deleted. The API's version. */
export async function automationOf(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>,
  id: Id<'automations'>,
): Promise<Doc<'automations'>> {
  const automation = await ctx.db.get(id)
  if (!automation || automation.userId !== userId || automation.deletedAt)
    throw new Error('Automation not found')
  return automation
}

const MINUTE = 60_000

/**
 * The time a run actually starts. Runs keep their set time unless that minute already holds
 * `runsPerMinute()` others; then the run takes the next minute with room, up to
 * `scheduleSpreadMinutes()` later, so a popular time like 08:00 doesn't send every run to the AI
 * at once. Within a minute, runs are spaced evenly. Exported for tests.
 *
 * Later (SPEC §41.2): once paid plans exist, paid automations keep their minute and a free one
 * is the run that moves.
 */
export async function spreadStart(
  ctx: MutationCtx,
  self: Id<'automations'>,
  wanted: number,
): Promise<number> {
  const perMinute = Math.max(1, runsPerMinute())
  const spread = scheduleSpreadMinutes()
  const booked = await ctx.db
    .query('automations')
    .withIndex('by_nextRunAt', (q) =>
      q.gte('nextRunAt', wanted).lt('nextRunAt', wanted + (spread + 1) * MINUTE),
    )
    .collect()
  const others = booked.filter((a) => a._id !== self && a.status === 'active')
  for (let minute = 0; minute <= spread; minute++) {
    const from = wanted + minute * MINUTE
    const taken = others.filter((a) => a.nextRunAt! >= from && a.nextRunAt! < from + MINUTE).length
    if (taken < perMinute) return from + Math.round((taken * MINUTE) / perMinute)
  }
  return wanted + spread * MINUTE
}

/**
 * Books the next run in the user's zone and remembers the scheduled function so a pause or an
 * edit can cancel it. Only active automations are booked.
 */
export async function scheduleNext(
  ctx: MutationCtx,
  automation: Doc<'automations'>,
  after = Date.now(),
) {
  if (automation.scheduledFnId) await ctx.scheduler.cancel(automation.scheduledFnId)
  if (automation.status !== 'active') {
    await ctx.db.patch(automation._id, {
      scheduledFnId: undefined,
      nextRunAt: undefined,
      nextRunSetFor: undefined,
    })
    return
  }
  const wanted = nextRunAt(automation.cadence as Cadence, automation.timezone, after)
  const at = await spreadStart(ctx, automation._id, wanted)
  const scheduledFnId = await ctx.scheduler.runAt(at, internal.runs.start, {
    automationId: automation._id,
  })
  await ctx.db.patch(automation._id, {
    scheduledFnId,
    nextRunAt: at,
    nextRunSetFor: wanted,
    updatedAt: Date.now(),
  })
}

/** Starts an automation from the setup answers and the chosen channels; the playbook follows. */
export const create = mutation({
  args: { setup: setupValidator, channelIds: v.array(v.string()) },
  returns: v.id('automations'),
  handler: async (ctx, args) => await createFor(ctx, await viewerId(ctx), args),
})

export async function createFor(
  ctx: MutationCtx,
  userId: Id<'users'>,
  args: { setup: Infer<typeof setupValidator>; channelIds: string[] },
): Promise<Id<'automations'>> {
  {
    const user = await ctx.db.get(userId)
    if (!user) throw new Error('Not signed in')
    const live = (
      await ctx.db
        .query('automations')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect()
    ).filter((a) => !a.deletedAt)
    if (live.length >= automationCap())
      throw new Error(`${automationCap()} automations is the limit. Delete one first.`)
    await claimGeneration(ctx, user)
    const channels = await ctx.db
      .query('bufferChannels')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    const chosen = channels.filter(
      (c) => args.channelIds.includes(c.channelId) && isTextService(c.service),
    )
    if (!chosen.length) throw new Error('Pick at least one channel')
    const setup = SetupAnswers.parse({
      ...args.setup,
      services: [...new Set(chosen.map((c) => c.service as Service))],
    })
    const now = Date.now()
    const id = await ctx.db.insert('automations', {
      userId,
      name: setup.research.slice(0, 60),
      status: 'generating',
      setup,
      channelIds: chosen.map((c) => c.channelId),
      cadence: setup.cadence,
      timezone: user.timezone ?? 'UTC',
      postingMode: setup.postingMode,
      maxPostsPerRun: setup.maxStories,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.scheduler.runAfter(0, internal.playbooks.generate, { automationId: id })
    return id
  }
}

/** Asks for the playbook again, from the same answers. Keeps earlier versions. */
export const regenerate = mutation({
  args: { id: v.id('automations') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const automation = await ownAutomation(ctx, id)
    if (automation.status === 'generating') return null
    const user = await ctx.db.get(automation.userId)
    if (user) await claimGeneration(ctx, user)
    await ctx.db.patch(id, {
      status: 'generating',
      generationError: undefined,
      updatedAt: Date.now(),
    })
    await ctx.scheduler.runAfter(0, internal.playbooks.generate, { automationId: id })
    return null
  },
})

const automationSummary = v.object({
  _id: v.id('automations'),
  name: v.string(),
  status: v.string(),
  cadence: cadenceValidator,
  timezone: v.string(),
  postingMode: v.string(),
  maxPostsPerRun: v.number(),
  channelIds: v.array(v.string()),
  nextRunAt: v.union(v.number(), v.null()),
  lastRunAt: v.union(v.number(), v.null()),
  generationError: v.union(v.string(), v.null()),
  version: v.number(),
})

function summary(a: Doc<'automations'>, version: number) {
  return {
    _id: a._id,
    name: a.name,
    status: a.status,
    cadence: a.cadence,
    timezone: a.timezone,
    postingMode: a.postingMode,
    maxPostsPerRun: a.maxPostsPerRun,
    channelIds: a.channelIds,
    // The time the person set; a busy minute may start it a little later (spreadStart).
    nextRunAt: a.nextRunSetFor ?? a.nextRunAt ?? null,
    lastRunAt: a.lastRunAt ?? null,
    generationError: a.generationError ?? null,
    version,
  }
}

async function latestVersion(ctx: QueryCtx | MutationCtx, automationId: Id<'automations'>) {
  return await ctx.db
    .query('playbookVersions')
    .withIndex('by_automation_version', (q) => q.eq('automationId', automationId))
    .order('desc')
    .first()
}

export const list = query({
  args: {},
  returns: v.array(automationSummary),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return []
    return await listFor(ctx, userId)
  },
})

export async function listFor(ctx: QueryCtx, userId: Id<'users'>) {
  {
    const rows = await ctx.db
      .query('automations')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .order('desc')
      .collect()
    const out = []
    for (const a of rows) {
      if (a.deletedAt) continue
      const version = await latestVersion(ctx, a._id)
      out.push(summary(a, version?.version ?? 0))
    }
    return out
  }
}

/** One automation with its latest playbook and the channels it posts to. */
export const get = query({
  args: { id: v.id('automations') },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    return await getFor(ctx, userId, id)
  },
})

export async function getFor(ctx: QueryCtx, userId: Id<'users'>, id: Id<'automations'>) {
  {
    const a = await ctx.db.get(id)
    if (!a || a.userId !== userId || a.deletedAt) return null
    const version = await latestVersion(ctx, id)
    const channels = await ctx.db
      .query('bufferChannels')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    const user = await ctx.db.get(userId)
    return {
      ...summary(a, version?.version ?? 0),
      setup: a.setup,
      playbook: version ? (version.playbook as Playbook) : null,
      text: version?.text ?? null,
      playbookCreatedBy: version?.createdBy ?? null,
      channels: channels
        .filter((c) => a.channelIds.includes(c.channelId))
        .map((c) => ({
          channelId: c.channelId,
          service: c.service,
          name: c.name,
          usable: c.usable,
          problem: c.problem ?? null,
        })),
      allowance: user ? allowanceFor(user) : null,
    }
  }
}

/** Saves an edited playbook as a new version. The text is the source; it must parse. */
export const savePlaybook = mutation({
  args: { id: v.id('automations'), text: v.string() },
  returns: v.union(
    v.object({ ok: v.literal(true), version: v.number() }),
    v.object({ ok: v.literal(false), line: v.number(), message: v.string() }),
  ),
  handler: async (ctx, { id, text }) => await savePlaybookFor(ctx, await viewerId(ctx), id, text),
})

export async function savePlaybookFor(
  ctx: MutationCtx,
  userId: Id<'users'>,
  id: Id<'automations'>,
  text: string,
): Promise<{ ok: true; version: number } | { ok: false; line: number; message: string }> {
  {
    await automationOf(ctx, userId, id)
    if (text.length > MAX_PLAYBOOK_CHARS)
      return {
        ok: false as const,
        line: 1,
        message: `A playbook can be up to ${MAX_PLAYBOOK_CHARS.toLocaleString('en-US')} characters.`,
      }
    const parsed = parsePlaybook(text)
    if (!parsed.ok) return parsed
    const latest = await latestVersion(ctx, id)
    const version = (latest?.version ?? 0) + 1
    const versionId = await ctx.db.insert('playbookVersions', {
      automationId: id,
      version,
      playbook: parsed.playbook,
      text: renderPlaybook(parsed.playbook),
      createdBy: 'user',
      createdAt: Date.now(),
    })
    await ctx.db.patch(id, {
      playbookVersionId: versionId,
      name: parsed.playbook.name,
      updatedAt: Date.now(),
    })
    return { ok: true as const, version }
  }
}

/** Stores a generated playbook as the next version and marks the automation ready. */
export const storeGenerated = internalMutation({
  args: { automationId: v.id('automations'), playbook: v.any(), error: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { automationId, playbook, error }) => {
    const automation = await ctx.db.get(automationId)
    if (!automation) return null
    if (error || !playbook) {
      await ctx.db.patch(automationId, {
        status: automation.playbookVersionId ? 'ready' : 'failed',
        generationError: error ?? 'No playbook came back.',
        updatedAt: Date.now(),
      })
      return null
    }
    const checked = Playbook.parse(playbook)
    const latest = await latestVersion(ctx, automationId)
    const versionId = await ctx.db.insert('playbookVersions', {
      automationId,
      version: (latest?.version ?? 0) + 1,
      playbook: checked,
      text: renderPlaybook(checked),
      createdBy: 'ai',
      createdAt: Date.now(),
    })
    const wasActive = automation.status === 'generating' && automation.scheduledFnId
    await ctx.db.patch(automationId, {
      status: wasActive ? 'active' : 'ready',
      name: checked.name,
      playbookVersionId: versionId,
      generationError: undefined,
      updatedAt: Date.now(),
    })
    const user = await ctx.db.get(automation.userId)
    if (user && !user.firstPlaybookAt) await ctx.db.patch(user._id, { firstPlaybookAt: Date.now() })
    // A new automation's first playbook goes straight into a dry run, so the first thing the
    // person sees is it researching, not a button to press.
    if (!latest) await ctx.scheduler.runAfter(0, internal.runs.firstDryRun, { automationId })
    return null
  },
})

/** Schedule, channels, posting mode and story count, from the automation page. */
export const updateConfig = mutation({
  args: {
    id: v.id('automations'),
    cadence: v.optional(cadenceValidator),
    channelIds: v.optional(v.array(v.string())),
    postingMode: v.optional(v.union(v.literal('draft'), v.literal('queue'), v.literal('spread'))),
    maxPostsPerRun: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { id, ...changes }) =>
    await updateConfigFor(ctx, await viewerId(ctx), id, changes),
})

export type ConfigChanges = {
  cadence?: Cadence
  channelIds?: string[]
  postingMode?: 'draft' | 'queue' | 'spread'
  maxPostsPerRun?: number
}

export async function updateConfigFor(
  ctx: MutationCtx,
  userId: Id<'users'>,
  id: Id<'automations'>,
  changes: ConfigChanges,
): Promise<null> {
  {
    const automation = await automationOf(ctx, userId, id)
    if (
      changes.maxPostsPerRun !== undefined &&
      (changes.maxPostsPerRun < 1 || changes.maxPostsPerRun > 3)
    )
      throw new Error('Between 1 and 3 stories a run')
    if (changes.channelIds) {
      const channels = await ctx.db
        .query('bufferChannels')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect()
      const known = new Set(
        channels.filter((c) => isTextService(c.service)).map((c) => c.channelId),
      )
      if (!changes.channelIds.length || changes.channelIds.some((c) => !known.has(c)))
        throw new Error('Pick at least one channel, from your Buffer channels')
    }
    const patch: Partial<Doc<'automations'>> = { updatedAt: Date.now() }
    if (changes.cadence) patch.cadence = changes.cadence
    if (changes.channelIds) patch.channelIds = changes.channelIds
    if (changes.postingMode) patch.postingMode = changes.postingMode
    if (changes.maxPostsPerRun !== undefined) patch.maxPostsPerRun = changes.maxPostsPerRun
    await ctx.db.patch(id, patch)
    if (changes.cadence) await scheduleNext(ctx, { ...automation, ...patch })
    return null
  }
}

export const setStatus = mutation({
  args: { id: v.id('automations'), status: v.union(v.literal('active'), v.literal('paused')) },
  returns: v.null(),
  handler: async (ctx, { id, status }) => await setStatusFor(ctx, await viewerId(ctx), id, status),
})

export async function setStatusFor(
  ctx: MutationCtx,
  userId: Id<'users'>,
  id: Id<'automations'>,
  status: 'active' | 'paused',
): Promise<null> {
  {
    const automation = await automationOf(ctx, userId, id)
    if (!automation.playbookVersionId) throw new Error('The playbook is not ready yet')
    const user = await ctx.db.get(automation.userId)
    if (status === 'active' && user && allowanceFor(user).runsLeft === 0)
      throw new Error('No free runs left. Add your own Anthropic key in settings to keep going.')
    await ctx.db.patch(id, { status, consecutiveFailures: 0, updatedAt: Date.now() })
    await scheduleNext(ctx, { ...automation, status })
    return null
  }
}

export const remove = mutation({
  args: { id: v.id('automations') },
  returns: v.null(),
  handler: async (ctx, { id }) => await removeFor(ctx, await viewerId(ctx), id),
})

export async function removeFor(
  ctx: MutationCtx,
  userId: Id<'users'>,
  id: Id<'automations'>,
): Promise<null> {
  {
    const automation = await automationOf(ctx, userId, id)
    if (automation.scheduledFnId) await ctx.scheduler.cancel(automation.scheduledFnId)
    await ctx.db.patch(id, {
      status: 'paused',
      deletedAt: Date.now(),
      scheduledFnId: undefined,
      nextRunAt: undefined,
      nextRunSetFor: undefined,
    })
    return null
  }
}

/**
 * The home page in one query: each automation with its last run in words, posts this week, and
 * the drafts waiting for a yes.
 */
export const dashboard = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const weekAgo = Date.now() - 7 * 86_400_000
    const rows = await ctx.db
      .query('automations')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .order('desc')
      .collect()
    const recentPosts = await ctx.db
      .query('posts')
      .withIndex('by_user_createdAt', (q) => q.eq('userId', userId).gt('createdAt', weekAgo))
      .collect()
    const channels = await ctx.db
      .query('bufferChannels')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    const names = new Map(channels.map((c) => [c.channelId, c.name]))
    const limits = new Map(
      channels.filter((c) => c.maxLength).map((c) => [c.channelId, c.maxLength!] as const),
    )
    const automations = []
    for (const a of rows) {
      if (a.deletedAt) continue
      const last = await ctx.db
        .query('runs')
        .withIndex('by_automation_startedAt', (q) => q.eq('automationId', a._id))
        .order('desc')
        .first()
      const sent = recentPosts.filter((p) => p.automationId === a._id && p.bufferPostId)
      const runsThisWeek = await ctx.db
        .query('runs')
        .withIndex('by_automation_startedAt', (q) =>
          q.eq('automationId', a._id).gt('startedAt', weekAgo),
        )
        .collect()
      automations.push({
        _id: a._id,
        name: a.name,
        status: a.status,
        cadence: a.cadence,
        timezone: a.timezone,
        nextRunAt: a.nextRunSetFor ?? a.nextRunAt ?? null,
        lastRun: last
          ? {
              _id: last._id,
              startedAt: last.startedAt,
              finished: Boolean(last.finishedAt),
              status: last.status,
              kind: last.kind,
              note: last.steps.at(-1)?.note ?? '',
              posted: last.posted ?? 0,
              kept: last.kept ?? 0,
            }
          : null,
        postsThisWeek: sent.length,
        /** When each post of the last week reached Buffer, for the activity strip. */
        postTimes: sent.map((p) => p.createdAt),
        runTimes: runsThisWeek.filter((r) => r.kind !== 'dry').map((r) => r.startedAt),
      })
    }
    const drafts = recentPosts
      .filter((p) => p.status === 'draft' && p.bufferPostId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((p) => ({
        _id: p._id,
        runId: p.runId,
        automationId: p.automationId,
        channelName: names.get(p.channelId) ?? p.service,
        channelId: p.channelId,
        service: p.service,
        text: p.text,
        limit: limits.get(p.channelId) ?? SERVICE_LIMITS[p.service as Service]?.maxLength ?? 280,
        createdAt: p.createdAt,
      }))
    const user = await ctx.db.get(userId)
    const active = automations.filter((a) => a.status === 'active' && a.nextRunAt)
    return {
      automations,
      drafts,
      postsThisWeek: recentPosts.filter((p) => p.bufferPostId).length,
      nextRunAt: active.length ? Math.min(...active.map((a) => a.nextRunAt!)) : null,
      timezone: user?.timezone ?? 'UTC',
    }
  },
})

/** Posts on one automation in the last 30 days, with Buffer's metrics summed, for its page. */
export const performance = query({
  args: { id: v.id('automations') },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const a = await ctx.db.get(id)
    if (!a || a.userId !== userId) return null
    const since = Date.now() - 30 * 86_400_000
    const posts = (
      await ctx.db
        .query('posts')
        .withIndex('by_user_createdAt', (q) => q.eq('userId', userId).gt('createdAt', since))
        .collect()
    ).filter((p) => p.automationId === id && p.bufferPostId)
    const sent = posts.filter((p) => p.status === 'sent')
    const totals = new Map<string, number>()
    let best: { title: string; value: number; type: string; runId: Id<'runs'> } | null = null
    for (const p of sent) {
      for (const m of p.metrics ?? []) {
        totals.set(m.type, (totals.get(m.type) ?? 0) + m.value)
        if (m.type === 'impressions' || m.type === 'views') {
          if (!best || m.value > best.value) {
            const story = await ctx.db.get(p.storyId)
            best = { title: story?.title ?? '', value: m.value, type: m.type, runId: p.runId }
          }
        }
      }
    }
    return {
      posts: posts.length,
      sent: sent.length,
      drafts: posts.filter((p) => p.status === 'draft').length,
      withMetrics: sent.filter((p) => p.metrics?.length).length,
      totals: [...totals]
        .map(([type, value]) => ({ type, value }))
        .sort((x, y) => y.value - x.value),
      best,
    }
  },
})

/** Adds a skip rule to the playbook as a new version, from a story the person did not want. */
export const addExcludeRule = mutation({
  args: { id: v.id('automations'), rule: v.string() },
  returns: v.number(),
  handler: async (ctx, { id, rule }) => await addExcludeRuleFor(ctx, await viewerId(ctx), id, rule),
})

export async function addExcludeRuleFor(
  ctx: MutationCtx,
  userId: Id<'users'>,
  id: Id<'automations'>,
  rule: string,
): Promise<number> {
  {
    await automationOf(ctx, userId, id)
    const text = rule.trim().replace(/\s+/g, ' ')
    if (text.length < 3 || text.length > 200) throw new Error('A rule is one short sentence.')
    const latest = await latestVersion(ctx, id)
    if (!latest) throw new Error('The playbook is not ready yet')
    const playbook = Playbook.parse(latest.playbook)
    const sentence = /[.!?]$/.test(text) ? text : `${text}.`
    if (playbook.exclude.some((e) => e.toLowerCase() === sentence.toLowerCase()))
      return latest.version
    const next = { ...playbook, exclude: [...playbook.exclude, sentence] }
    const version = latest.version + 1
    const versionId = await ctx.db.insert('playbookVersions', {
      automationId: id,
      version,
      playbook: next,
      text: renderPlaybook(next),
      createdBy: 'user',
      createdAt: Date.now(),
    })
    await ctx.db.patch(id, { playbookVersionId: versionId, updatedAt: Date.now() })
    return version
  }
}
