import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server'
import { SetupAnswers, type Service } from './lib/ai/setup'
import { allowanceFor } from './lib/limits'
import { Playbook, parsePlaybook, renderPlaybook } from './lib/playbook'
import { nextRunAt, type Cadence } from './lib/schedule'
import { cadenceValidator, setupValidator } from './schema'

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
  const userId = await viewerId(ctx)
  const automation = await ctx.db.get(id)
  if (!automation || automation.userId !== userId || automation.deletedAt)
    throw new Error('Automation not found')
  return automation
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
    await ctx.db.patch(automation._id, { scheduledFnId: undefined, nextRunAt: undefined })
    return
  }
  const at = nextRunAt(automation.cadence as Cadence, automation.timezone, after)
  const scheduledFnId = await ctx.scheduler.runAt(at, internal.runs.start, {
    automationId: automation._id,
  })
  await ctx.db.patch(automation._id, { scheduledFnId, nextRunAt: at, updatedAt: Date.now() })
}

/** Starts an automation from the setup answers and the chosen channels; the playbook follows. */
export const create = mutation({
  args: { setup: setupValidator, channelIds: v.array(v.string()) },
  returns: v.id('automations'),
  handler: async (ctx, args) => {
    const userId = await viewerId(ctx)
    const user = await ctx.db.get(userId)
    if (!user) throw new Error('Not signed in')
    const channels = await ctx.db
      .query('bufferChannels')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    const chosen = channels.filter((c) => args.channelIds.includes(c.channelId))
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
  },
})

/** Asks for the playbook again, from the same answers. Keeps earlier versions. */
export const regenerate = mutation({
  args: { id: v.id('automations') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const automation = await ownAutomation(ctx, id)
    if (automation.status === 'generating') return null
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
    nextRunAt: a.nextRunAt ?? null,
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
  },
})

/** One automation with its latest playbook and the channels it posts to. */
export const get = query({
  args: { id: v.id('automations') },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
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
        })),
      allowance: user ? allowanceFor(user) : null,
    }
  },
})

/** Saves an edited playbook as a new version. The text is the source; it must parse. */
export const savePlaybook = mutation({
  args: { id: v.id('automations'), text: v.string() },
  returns: v.union(
    v.object({ ok: v.literal(true), version: v.number() }),
    v.object({ ok: v.literal(false), line: v.number(), message: v.string() }),
  ),
  handler: async (ctx, { id, text }) => {
    const automation = await ownAutomation(ctx, id)
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
    void automation
    return { ok: true as const, version }
  },
})

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
  handler: async (ctx, { id, ...changes }) => {
    const automation = await ownAutomation(ctx, id)
    if (
      changes.maxPostsPerRun !== undefined &&
      (changes.maxPostsPerRun < 1 || changes.maxPostsPerRun > 3)
    )
      throw new Error('Between 1 and 3 stories a run')
    if (changes.channelIds && !changes.channelIds.length)
      throw new Error('Pick at least one channel')
    const patch: Partial<Doc<'automations'>> = { updatedAt: Date.now() }
    if (changes.cadence) patch.cadence = changes.cadence
    if (changes.channelIds) patch.channelIds = changes.channelIds
    if (changes.postingMode) patch.postingMode = changes.postingMode
    if (changes.maxPostsPerRun !== undefined) patch.maxPostsPerRun = changes.maxPostsPerRun
    await ctx.db.patch(id, patch)
    if (changes.cadence) await scheduleNext(ctx, { ...automation, ...patch })
    return null
  },
})

export const setStatus = mutation({
  args: { id: v.id('automations'), status: v.union(v.literal('active'), v.literal('paused')) },
  returns: v.null(),
  handler: async (ctx, { id, status }) => {
    const automation = await ownAutomation(ctx, id)
    if (!automation.playbookVersionId) throw new Error('The playbook is not ready yet')
    const user = await ctx.db.get(automation.userId)
    if (status === 'active' && user && allowanceFor(user).runsLeft === 0)
      throw new Error('No free runs left. Add your own Anthropic key in settings to keep going.')
    await ctx.db.patch(id, { status, consecutiveFailures: 0, updatedAt: Date.now() })
    await scheduleNext(ctx, { ...automation, status })
    return null
  },
})

export const remove = mutation({
  args: { id: v.id('automations') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const automation = await ownAutomation(ctx, id)
    if (automation.scheduledFnId) await ctx.scheduler.cancel(automation.scheduledFnId)
    await ctx.db.patch(id, {
      status: 'paused',
      deletedAt: Date.now(),
      scheduledFnId: undefined,
      nextRunAt: undefined,
    })
    return null
  },
})

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
    const automations = []
    for (const a of rows) {
      if (a.deletedAt) continue
      const last = await ctx.db
        .query('runs')
        .withIndex('by_automation_startedAt', (q) => q.eq('automationId', a._id))
        .order('desc')
        .first()
      const sent = recentPosts.filter((p) => p.automationId === a._id && p.bufferPostId)
      automations.push({
        _id: a._id,
        name: a.name,
        status: a.status,
        cadence: a.cadence,
        timezone: a.timezone,
        nextRunAt: a.nextRunAt ?? null,
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
        service: p.service,
        text: p.text,
        createdAt: p.createdAt,
      }))
    return { automations, drafts, postsThisWeek: recentPosts.filter((p) => p.bufferPostId).length }
  },
})
