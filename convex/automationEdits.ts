import { v, type Infer } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import {
  MAX_PLAYBOOK_CHARS,
  MAX_STORIES_PER_RUN,
  POSTING_MODES,
  normalCadence,
  ownAutomation,
  savePlaybookFor,
  updateConfigFor,
  validateConfigChanges,
} from './automations'
import { describePlan, MAX_PLANNED_STORIES, normalPlan, PLAN_HORIZON_DAYS } from './lib/plan'
import { describeCadence } from './lib/schedule'
import { parsePlaybook, renderPlaybook } from './lib/playbook'
import { automationConfigChangesValidator, automationEditSnapshotValidator } from './schema'

type Snapshot = Infer<typeof automationEditSnapshotValidator>
type Changes = Infer<typeof automationConfigChangesValidator>

/** Server-owned contract. Extend it only when the corresponding execution path is implemented. */
const capabilities = {
  version: 2,
  editable: [
    'playbookText',
    'cadence',
    'channelIds',
    'postingMode',
    'maxPostsPerRun',
    'publicationPlan',
  ],
  cadence: ['daily', 'weekly'],
  postingModes: POSTING_MODES,
  storiesPerRun: {
    min: 1,
    max: MAX_STORIES_PER_RUN,
    plannedMax: MAX_PLANNED_STORIES,
    integer: true,
    rule: `Draft, queue and spread take 1-${MAX_STORIES_PER_RUN} stories a run. Planned takes 1 story per posting day, at most ${MAX_PLANNED_STORIES}.`,
  },
  maxPlaybookCharacters: MAX_PLAYBOOK_CHARS,
  freshnessHours: { min: 6, max: 336 },
  spread: { startsAfterMinutes: 10, intervalMinutes: 120 },
  queue: 'Uses the next free Buffer slots; specific dates are not guaranteed.',
  planned: {
    description: `Research once, then schedule one story per chosen posting day at one local time, across the ${PLAN_HORIZON_DAYS} days from the start of the run. Each selected channel gets that story's post at the same time.`,
    requires: 'A weekly cadence and a publicationPlan with time (HH:MM) and weekdays (mon-sun).',
    horizon: `The ${PLAN_HORIZON_DAYS} days from when the run starts. A posting time that is less than 10 minutes away when posts are sent is skipped; days already holding a post from this automation are skipped.`,
    approval: 'Planned posts are scheduled directly in Buffer; there is no draft approval step.',
    shortBatches:
      'When research finds fewer good stories than posting days, the remaining days stay empty and the run says which.',
  },
  timezone: 'Read from account settings; not editable through proposals.',
  requiresReview: true,
  unsupported: [
    'Archival or anniversary research outside the recent-news freshness rules',
    'Different posting times on different days, or more than one story per day',
    'Draft approval for planned batches',
    'Changing or deleting posts already in Buffer',
    'Enabling, pausing, deleting, or starting an automation through a change proposal',
  ],
}

async function snapshot(ctx: QueryCtx | MutationCtx, a: Doc<'automations'>): Promise<Snapshot> {
  if (!a.playbookVersionId || a.status === 'generating')
    throw new Error('Wait until the playbook is ready before proposing changes.')
  const version = await ctx.db.get(a.playbookVersionId)
  if (!version) throw new Error('The playbook is not ready yet')
  if (!(POSTING_MODES as readonly string[]).includes(a.postingMode))
    throw new Error('Unsupported posting mode')
  return {
    cadence: normalCadence(a.cadence),
    channelIds: a.channelIds,
    postingMode: a.postingMode as Snapshot['postingMode'],
    maxPostsPerRun: a.maxPostsPerRun,
    ...(a.publicationPlan ? { publicationPlan: normalPlan(a.publicationPlan) } : {}),
    text: version.text,
    timezone: a.timezone,
  }
}

function checkRevision(a: Doc<'automations'>, expected: number) {
  if (!Number.isInteger(expected) || expected !== (a.configurationRevision ?? 0))
    throw new Error('This automation changed. Reload it and review a new proposal.')
}

/** Convex may reorder object keys on storage; compare cadence values explicitly. */
function sameCadence(before: Snapshot, after: Snapshot) {
  return (
    before.cadence.preset === after.cadence.preset &&
    before.cadence.time === after.cadence.time &&
    before.cadence.weekday === after.cadence.weekday
  )
}

function samePlan(before: Snapshot, after: Snapshot) {
  const a = before.publicationPlan
  const b = after.publicationPlan
  if (!a || !b) return !a && !b
  return a.time === b.time && a.weekdays.join() === b.weekdays.join()
}

function summarize(before: Snapshot, after: Snapshot): string[] {
  const summary: string[] = []
  if (!sameCadence(before, after))
    summary.push(
      `Research: ${describeCadence(before.cadence)} → ${describeCadence(after.cadence)} (${after.timezone}).`,
    )
  if (JSON.stringify(before.channelIds) !== JSON.stringify(after.channelIds))
    summary.push(`Channels: ${before.channelIds.join(', ')} → ${after.channelIds.join(', ')}.`)
  if (before.postingMode !== after.postingMode)
    summary.push(`Posting mode: ${before.postingMode} → ${after.postingMode}.`)
  if (!samePlan(before, after))
    summary.push(
      `Publication plan: ${before.publicationPlan ? describePlan(before.publicationPlan) : 'none'} → ${after.publicationPlan ? describePlan(after.publicationPlan) : 'none'} (${after.timezone}).`,
    )
  if (before.maxPostsPerRun !== after.maxPostsPerRun)
    summary.push(`At most ${before.maxPostsPerRun} → ${after.maxPostsPerRun} stories per run.`)
  if (
    after.postingMode === 'planned' &&
    (before.postingMode !== 'planned' ||
      !samePlan(before, after) ||
      before.maxPostsPerRun !== after.maxPostsPerRun ||
      JSON.stringify(before.channelIds) !== JSON.stringify(after.channelIds))
  ) {
    const posts = after.maxPostsPerRun * after.channelIds.length
    summary.push(
      `Each weekly batch: up to ${after.maxPostsPerRun} ${after.maxPostsPerRun === 1 ? 'story' : 'stories'} × ${after.channelIds.length} ${after.channelIds.length === 1 ? 'channel' : 'channels'} = up to ${posts} Buffer ${posts === 1 ? 'post' : 'posts'}, scheduled directly without approval.`,
    )
  }
  if (before.text !== after.text)
    summary.push('Update editorial playbook; review the before/after text.')
  return summary
}

function changedConfig(before: Snapshot, after: Snapshot): Changes {
  const changes: Changes = {}
  if (!sameCadence(before, after)) changes.cadence = after.cadence
  if (JSON.stringify(before.channelIds) !== JSON.stringify(after.channelIds))
    changes.channelIds = after.channelIds
  if (before.postingMode !== after.postingMode) changes.postingMode = after.postingMode
  if (before.maxPostsPerRun !== after.maxPostsPerRun) changes.maxPostsPerRun = after.maxPostsPerRun
  if (!samePlan(before, after) && after.publicationPlan)
    changes.publicationPlan = after.publicationPlan
  return changes
}

export async function prepareAutomationEdit(
  ctx: MutationCtx,
  a: Doc<'automations'>,
  baseRevision: number,
  changes: Changes,
  playbookText?: string,
  restoresEditId?: Id<'automationEdits'>,
) {
  checkRevision(a, baseRevision)
  const before = await snapshot(ctx, a)
  await validateConfigChanges(ctx, a.userId, changes, a)
  let text = before.text
  if (playbookText !== undefined) {
    if (playbookText.length > MAX_PLAYBOOK_CHARS) throw new Error('Playbook is too long.')
    const parsed = parsePlaybook(playbookText)
    if (!parsed.ok) throw new Error(`Line ${parsed.line}: ${parsed.message}`)
    text = renderPlaybook(parsed.playbook)
  }
  const after: Snapshot = {
    ...before,
    ...changes,
    cadence: changes.cadence ? normalCadence(changes.cadence) : before.cadence,
    ...(changes.publicationPlan ? { publicationPlan: normalPlan(changes.publicationPlan) } : {}),
    text,
  }
  const summary = summarize(before, after)
  if (!summary.length) throw new Error('This proposal does not change anything.')
  if (changes.channelIds) {
    const channels = await ctx.db
      .query('bufferChannels')
      .withIndex('by_user', (q) => q.eq('userId', a.userId))
      .collect()
    const label = (id: string) => {
      const channel = channels.find((c) => c.channelId === id)
      return channel ? `${channel.name} (${channel.service})` : id
    }
    const at = summary.findIndex((line) => line.startsWith('Channels:'))
    if (at >= 0)
      summary[at] =
        `Channels: ${before.channelIds.map(label).join(', ')} → ${after.channelIds.map(label).join(', ')}.`
  }
  return await ctx.db.insert('automationEdits', {
    automationId: a._id,
    baseRevision,
    before,
    after,
    summary,
    status: 'proposed',
    restoresEditId,
    createdAt: Date.now(),
  })
}

/** Context read before any model call. The returned revision must accompany the proposal. */
export const context = query({
  args: { id: v.id('automations') },
  handler: async (ctx, { id }) => await automationEditContext(ctx, await ownAutomation(ctx, id)),
})

export async function automationEditContext(ctx: QueryCtx | MutationCtx, a: Doc<'automations'>) {
  const channels = await ctx.db
    .query('bufferChannels')
    .withIndex('by_user', (q) => q.eq('userId', a.userId))
    .collect()
  return {
    revision: a.configurationRevision ?? 0,
    current: await snapshot(ctx, a),
    channels: channels.map(({ channelId, name, service, usable }) => ({
      channelId,
      name,
      service,
      usable,
    })),
    sourcePolicy: { onlyTheseSources: a.setup.onlyTheseSources },
    capabilities,
  }
}

export const propose = mutation({
  args: {
    id: v.id('automations'),
    baseRevision: v.number(),
    changes: automationConfigChangesValidator,
    playbookText: v.optional(v.string()),
  },
  returns: v.id('automationEdits'),
  handler: async (ctx, { id, baseRevision, changes, playbookText }) =>
    await prepareAutomationEdit(
      ctx,
      await ownAutomation(ctx, id),
      baseRevision,
      changes,
      playbookText,
    ),
})

/** Bounded history includes complete reviewable snapshots, never other users' automations. */
export const history = query({
  args: { id: v.id('automations') },
  handler: async (ctx, { id }) => {
    await ownAutomation(ctx, id)
    return await ctx.db
      .query('automationEdits')
      .withIndex('by_automation', (q) => q.eq('automationId', id))
      .order('desc')
      .take(50)
  },
})

async function ownedEdit(ctx: QueryCtx | MutationCtx, id: Id<'automationEdits'>) {
  const edit = await ctx.db.get(id)
  if (!edit) throw new Error('Change proposal not found')
  const automation = await ownAutomation(ctx, edit.automationId)
  return { edit, automation }
}

export const get = query({
  args: { id: v.id('automationEdits') },
  handler: async (ctx, { id }) => (await ownedEdit(ctx, id)).edit,
})

/** One Convex transaction: all validation, playbook, configuration, scheduler and receipt writes. */
export const apply = mutation({
  args: { id: v.id('automationEdits') },
  returns: v.number(),
  handler: async (ctx, { id }) => {
    const { edit, automation: a } = await ownedEdit(ctx, id)
    // A retried submission returns its original receipt, even if later edits have happened.
    if (edit.status === 'applied') return edit.appliedRevision!
    if (edit.status !== 'proposed') throw new Error('This proposal was discarded.')
    checkRevision(a, edit.baseRevision)
    const current = await snapshot(ctx, a)
    if (summarize(current, edit.before).length || current.timezone !== edit.before.timezone)
      throw new Error('This automation changed. Reload it and review a new proposal.')
    const changes = changedConfig(edit.before, edit.after)
    await validateConfigChanges(ctx, a.userId, changes, a)
    if (edit.before.text !== edit.after.text) {
      const saved = await savePlaybookFor(ctx, a.userId, a._id, edit.after.text)
      if (!saved.ok) throw new Error(`Line ${saved.line}: ${saved.message}`)
    }
    if (Object.keys(changes).length) await updateConfigFor(ctx, a.userId, a._id, changes)
    // Treat the atomic proposal as one revision even when it changed both halves.
    const revision = edit.baseRevision + 1
    await ctx.db.patch(a._id, { configurationRevision: revision })
    await ctx.db.patch(id, {
      status: 'applied',
      appliedRevision: revision,
      appliedAt: Date.now(),
    })
    return revision
  },
})

export const discard = mutation({
  args: { id: v.id('automationEdits') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const { edit } = await ownedEdit(ctx, id)
    if (edit.status === 'applied')
      throw new Error('Applied changes must be undone with a proposal.')
    await ctx.db.patch(id, { status: 'discarded' })
    return null
  },
})

/** Restore is proposed against today's revision and requires the same review/apply flow. */
export const proposeUndo = mutation({
  args: { id: v.id('automationEdits'), baseRevision: v.number() },
  returns: v.id('automationEdits'),
  handler: async (ctx, { id, baseRevision }) => {
    const { edit, automation: a } = await ownedEdit(ctx, id)
    if (edit.status !== 'applied') throw new Error('Only applied changes can be undone.')
    if (a.timezone !== edit.before.timezone)
      throw new Error('The time zone changed. Create a new proposal in the current time zone.')
    const { text, timezone: _, ...changes } = edit.before
    return await prepareAutomationEdit(ctx, a, baseRevision, changes, text, id)
  },
})
