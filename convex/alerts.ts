import { v } from 'convex/values'
import { internal } from './_generated/api'
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
/** At most one error email every 10 minutes, and 20 a day. */
export const ERROR_ALERT_GAP = 10 * MINUTE
export const ERROR_ALERTS_PER_DAY = 20

/**
 * Whether an error alert email may go out now; records it if so. The alert endpoint has no
 * secret, so this cap is what stops anyone from using it to flood the inbox.
 */
export const claimErrorAlert = internalMutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const now = Date.now()
    const recent = await ctx.db
      .query('alertsSent')
      .withIndex('by_kind_sentAt', (q) =>
        q.eq('kind', 'error').gt('sentAt', now - 24 * 60 * MINUTE),
      )
      .collect()
    const old = await ctx.db
      .query('alertsSent')
      .withIndex('by_kind_sentAt', (q) =>
        q.eq('kind', 'error').lte('sentAt', now - 24 * 60 * MINUTE),
      )
      .take(50)
    for (const row of old) await ctx.db.delete(row._id)
    if (recent.length >= ERROR_ALERTS_PER_DAY) return false
    if (recent.some((row) => row.sentAt > now - ERROR_ALERT_GAP)) return false
    await ctx.db.insert('alertsSent', { kind: 'error', sentAt: now })
    return true
  },
})

/** Whether something keyed by `kind` has been sent before; records it the first time. */
export const claimOnce = internalMutation({
  args: { kind: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { kind }) => {
    const sent = await ctx.db
      .query('alertsSent')
      .withIndex('by_kind_sentAt', (q) => q.eq('kind', kind))
      .first()
    if (sent) return false
    await ctx.db.insert('alertsSent', { kind, sentAt: Date.now() })
    return true
  },
})

/** An owner email for a condition worth a look, at most once an hour per kind. */
export async function noteOwner(ctx: MutationCtx, kind: string, detail: string): Promise<void> {
  const now = Date.now()
  const recent = await ctx.db
    .query('alertsSent')
    .withIndex('by_kind_sentAt', (q) => q.eq('kind', `owner:${kind}`).gt('sentAt', now - HOUR))
    .first()
  if (recent) return
  await ctx.db.insert('alertsSent', { kind: `owner:${kind}`, sentAt: now })
  await ctx.scheduler.runAfter(0, internal.email.sendOwnerNote, {
    subject: `Dispatchlet: ${kind}`,
    body: detail,
  })
}

export const notifyOwner = internalMutation({
  args: { kind: v.string(), detail: v.string() },
  returns: v.null(),
  handler: async (ctx, { kind, detail }) => {
    await noteOwner(ctx, kind, detail)
    return null
  },
})

/**
 * The recurring jobs that must keep running, and how long each may go quiet before that is a
 * problem. Each records a heartbeat when it completes; `health` compares those with the clock.
 * Error tracking only sees what throws, so this is what notices the scheduler going silent.
 */
export const HEARTBEATS: ReadonlyArray<{ kind: string; within: number }> = [
  { kind: 'poll-statuses', within: 2 * HOUR },
  { kind: 'sweep-abandoned', within: 2 * HOUR },
  { kind: 'poll-metrics', within: 36 * HOUR },
]

/** A scheduled run this far past its booked time never started: its scheduled function is gone. */
export const RUN_OVERDUE_MS = 2 * HOUR

/** Records that the job named `kind` just completed. */
export const beat = internalMutation({
  args: { kind: v.string() },
  returns: v.null(),
  handler: async (ctx, { kind }) => {
    const row = await ctx.db
      .query('heartbeats')
      .withIndex('by_kind', (q) => q.eq('kind', kind))
      .first()
    if (row) await ctx.db.patch(row._id, { at: Date.now() })
    else await ctx.db.insert('heartbeats', { kind, at: Date.now() })
    return null
  },
})

export type Health = {
  ok: boolean
  /** Jobs that have not completed within their allowed gap, with how long since they last did. */
  stale: Array<{ kind: string; sinceMs: number | null }>
  /** Active automations whose booked run is well past due and never started. */
  overdueRuns: number
}

export async function healthFor(ctx: Pick<QueryCtx, 'db'>, now = Date.now()): Promise<Health> {
  const stale: Health['stale'] = []
  for (const { kind, within } of HEARTBEATS) {
    const row = await ctx.db
      .query('heartbeats')
      .withIndex('by_kind', (q) => q.eq('kind', kind))
      .first()
    if (!row) stale.push({ kind, sinceMs: null })
    else if (row.at < now - within) stale.push({ kind, sinceMs: now - row.at })
  }
  const overdue = await ctx.db
    .query('automations')
    .withIndex('by_nextRunAt', (q) => q.gt('nextRunAt', 0).lt('nextRunAt', now - RUN_OVERDUE_MS))
    .collect()
  const overdueRuns = overdue.filter((a) => a.status === 'active' && !a.deletedAt).length
  return { ok: stale.length === 0 && overdueRuns === 0, stale, overdueRuns }
}

/** The health report, for the /health route and the check below. */
export const health = internalQuery({
  args: {},
  handler: async (ctx): Promise<Health> => healthFor(ctx),
})

function describe(report: Health): string {
  const lines = report.stale.map(
    ({ kind, sinceMs }) =>
      `${kind} has not completed ${sinceMs === null ? 'yet' : `for ${Math.round(sinceMs / HOUR)} hours`}.`,
  )
  if (report.overdueRuns)
    lines.push(
      `${report.overdueRuns} scheduled run${report.overdueRuns === 1 ? ' is' : 's are'} more than two hours overdue and never started.`,
    )
  return lines.join('\n')
}

/** Every few hours: emails the owner when a recurring job or the run scheduler has gone quiet. */
export const checkHealth = internalMutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const report = await healthFor(ctx)
    if (!report.ok) await noteOwner(ctx, 'health', describe(report))
    return report.ok
  },
})
