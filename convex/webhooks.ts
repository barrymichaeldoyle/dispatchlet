import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server'
import { automationOf } from './automations'
import { decryptSecret, encryptSecret } from './lib/crypto'
import { take } from './api/rate'
import {
  envelope,
  generateWebhookSecret,
  isPrivateIPv4,
  isPrivateIPv6,
  signWebhook,
  WEBHOOK_EVENTS,
  webhookUrlProblem,
  type WebhookEvent,
} from './lib/standardWebhooks'

/** Test pings and retries per webhook per hour, so a person cannot aim a flood through us. */
const MANUAL_SENDS_PER_HOUR = 20

/**
 * Resolves a host over DNS-over-HTTPS and says whether any answer is private. A name that does
 * not resolve counts as private: there is nowhere safe to send it.
 */
async function resolvesPrivate(host: string): Promise<boolean> {
  const name = host.replace(/\.+$/, '')
  if (name.includes(':') || /^[\d.]+$/.test(name)) return false
  const answers: string[] = []
  for (const type of ['A', 'AAAA']) {
    const response = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
      { headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(5000) },
    )
    if (!response.ok) return true
    const body = (await response.json()) as { Answer?: { type: number; data: string }[] }
    for (const a of body.Answer ?? []) if (a.type === 1 || a.type === 28) answers.push(a.data)
  }
  if (!answers.length) return true
  return answers.some((ip) => (ip.includes(':') ? isPrivateIPv6(ip) : isPrivateIPv4(ip)))
}

/**
 * Outbound webhooks (SPEC §44.4). `emit` is called inside the mutations where things happen; it
 * writes a delivery per matching webhook and schedules `deliver`, which signs and sends it.
 */

/** Minutes after a failure before the next try: three retries after the first attempt. */
const RETRY_AFTER_MS = [60_000, 10 * 60_000, 60 * 60_000]
/** After this many failures in a row the webhook is switched off and the person emailed. */
const DISABLE_AFTER = 10
const KEEP_DELIVERIES_MS = 30 * 86_400_000
const DELIVERY_TIMEOUT_MS = Number(process.env.WEBHOOK_TIMEOUT_MS) || 10_000

const eventValidator = v.union(...WEBHOOK_EVENTS.map((e) => v.literal(e)))

const webhookView = v.object({
  _id: v.id('webhooks'),
  url: v.string(),
  events: v.array(v.string()),
  automationId: v.union(v.id('automations'), v.null()),
  active: v.boolean(),
  createdAt: v.number(),
  lastDeliveryAt: v.union(v.number(), v.null()),
  lastStatus: v.union(v.string(), v.null()),
  failedInARow: v.number(),
})

function view(w: Doc<'webhooks'>) {
  return {
    _id: w._id,
    url: w.url,
    events: w.events,
    automationId: w.automationId ?? null,
    active: w.active,
    createdAt: w.createdAt,
    lastDeliveryAt: w.lastDeliveryAt ?? null,
    lastStatus: w.lastStatus ?? null,
    failedInARow: w.failedInARow,
  }
}

const deliveryView = v.object({
  _id: v.id('webhookDeliveries'),
  event: v.string(),
  attempt: v.number(),
  status: v.string(),
  responseStatus: v.union(v.number(), v.null()),
  error: v.union(v.string(), v.null()),
  nextAttemptAt: v.union(v.number(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
})

function deliveryOf(d: Doc<'webhookDeliveries'>) {
  return {
    _id: d._id,
    event: d.event,
    attempt: d.attempt,
    status: d.status,
    responseStatus: d.responseStatus ?? null,
    error: d.error ?? null,
    nextAttemptAt: d.nextAttemptAt ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }
}

async function own(ctx: QueryCtx | MutationCtx, userId: Id<'users'>, id: Id<'webhooks'>) {
  const w = await ctx.db.get(id)
  if (!w || w.userId !== userId) throw new Error('Webhook not found')
  return w
}

async function listOf(ctx: QueryCtx | MutationCtx, userId: Id<'users'>) {
  return (
    await ctx.db
      .query('webhooks')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .order('desc')
      .collect()
  ).map(view)
}

async function createOf(
  ctx: MutationCtx,
  userId: Id<'users'>,
  args: { url: string; events: WebhookEvent[]; automationId?: Id<'automations'> },
) {
  const problem = webhookUrlProblem(args.url)
  if (problem) throw new Error(problem)
  if (!args.events.length) throw new Error('Pick at least one event')
  if (args.automationId) await automationOf(ctx, userId, args.automationId)
  const existing = await ctx.db
    .query('webhooks')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect()
  if (existing.length >= 20) throw new Error('Twenty webhooks is the limit. Delete one first.')
  const secret = generateWebhookSecret()
  const _id = await ctx.db.insert('webhooks', {
    userId,
    url: args.url,
    secretEnc: await encryptSecret(secret),
    events: [...new Set(args.events)],
    automationId: args.automationId,
    active: true,
    createdAt: Date.now(),
    failedInARow: 0,
  })
  const row = await ctx.db.get(_id)
  return { webhook: view(row!), secret }
}

async function removeOf(ctx: MutationCtx, userId: Id<'users'>, id: Id<'webhooks'>) {
  await own(ctx, userId, id)
  const deliveries = await ctx.db
    .query('webhookDeliveries')
    .withIndex('by_webhook_createdAt', (q) => q.eq('webhookId', id))
    .collect()
  for (const d of deliveries) await ctx.db.delete(d._id)
  await ctx.db.delete(id)
  return null
}

async function deliveriesOf(ctx: QueryCtx | MutationCtx, userId: Id<'users'>, id: Id<'webhooks'>) {
  await own(ctx, userId, id)
  return (
    await ctx.db
      .query('webhookDeliveries')
      .withIndex('by_webhook_createdAt', (q) => q.eq('webhookId', id))
      .order('desc')
      .take(50)
  ).map(deliveryOf)
}

/** Writes one delivery for a webhook and schedules it. */
async function enqueue(
  ctx: MutationCtx,
  webhook: Doc<'webhooks'>,
  type: WebhookEvent,
  data: unknown,
): Promise<Id<'webhookDeliveries'>> {
  const now = Date.now()
  const id = await ctx.db.insert('webhookDeliveries', {
    webhookId: webhook._id,
    userId: webhook.userId,
    event: type,
    payload: '',
    attempt: 0,
    status: 'pending',
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  })
  await ctx.db.patch(id, { payload: envelope(id, type, now, data) })
  await ctx.scheduler.runAfter(0, internal.webhooks.deliver, { deliveryId: id })
  return id
}

/**
 * Fires an event to every active webhook of the person that wants it (and, for events on an
 * automation, is not limited to a different one). Call from inside a mutation.
 */
export async function emit(
  ctx: MutationCtx,
  userId: Id<'users'>,
  type: WebhookEvent,
  data: unknown,
  automationId?: Id<'automations'>,
): Promise<void> {
  const hooks = await ctx.db
    .query('webhooks')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect()
  for (const w of hooks) {
    if (!w.active || !w.events.includes(type)) continue
    if (w.automationId && automationId && w.automationId !== automationId) continue
    await enqueue(ctx, w, type, data)
  }
}

async function testOf(ctx: MutationCtx, userId: Id<'users'>, id: Id<'webhooks'>) {
  const w = await own(ctx, userId, id)
  if (!(await take(ctx, `whsend:${id}`, 3_600_000, MANUAL_SENDS_PER_HOUR)).ok)
    throw new Error('Too many test sends for this webhook. Try again in an hour.')
  return await enqueue(ctx, w, 'ping', { at: Date.now() })
}

// --- signed-in app

export const list = query({
  args: {},
  returns: v.array(webhookView),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    return userId ? await listOf(ctx, userId) : []
  },
})

export const create = mutation({
  args: {
    url: v.string(),
    events: v.array(eventValidator),
    automationId: v.optional(v.id('automations')),
  },
  returns: v.object({ webhook: webhookView, secret: v.string() }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not signed in')
    return await createOf(ctx, userId, args)
  },
})

export const remove = mutation({
  args: { id: v.id('webhooks') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not signed in')
    return await removeOf(ctx, userId, id)
  },
})

export const setActive = mutation({
  args: { id: v.id('webhooks'), active: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { id, active }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not signed in')
    await own(ctx, userId, id)
    await ctx.db.patch(id, { active, ...(active ? { failedInARow: 0 } : {}) })
    return null
  },
})

export const sendTest = mutation({
  args: { id: v.id('webhooks') },
  returns: v.id('webhookDeliveries'),
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not signed in')
    return await testOf(ctx, userId, id)
  },
})

export const deliveries = query({
  args: { id: v.id('webhooks') },
  returns: v.array(deliveryView),
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx)
    return userId ? await deliveriesOf(ctx, userId, id) : []
  },
})

export const retry = mutation({
  args: { deliveryId: v.id('webhookDeliveries') },
  returns: v.null(),
  handler: async (ctx, { deliveryId }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not signed in')
    const d = await ctx.db.get(deliveryId)
    if (!d || d.userId !== userId) throw new Error('Delivery not found')
    if (d.status !== 'failed') throw new Error('Only a failed delivery can be retried.')
    if (!(await take(ctx, `whsend:${d.webhookId}`, 3_600_000, MANUAL_SENDS_PER_HOUR)).ok)
      throw new Error('Too many retries for this webhook. Try again in an hour.')
    await ctx.db.patch(deliveryId, {
      status: 'pending',
      nextAttemptAt: Date.now(),
      updatedAt: Date.now(),
    })
    await ctx.scheduler.runAfter(0, internal.webhooks.deliver, { deliveryId })
    return null
  },
})

// --- the API

export const listFor = internalQuery({
  args: { userId: v.id('users') },
  returns: v.array(webhookView),
  handler: async (ctx, { userId }) => await listOf(ctx, userId),
})

export const createFor = internalMutation({
  args: {
    userId: v.id('users'),
    url: v.string(),
    events: v.array(eventValidator),
    automationId: v.optional(v.id('automations')),
  },
  returns: v.object({ webhook: webhookView, secret: v.string() }),
  handler: async (ctx, { userId, ...args }) => await createOf(ctx, userId, args),
})

export const removeFor = internalMutation({
  args: { userId: v.id('users'), id: v.id('webhooks') },
  returns: v.null(),
  handler: async (ctx, { userId, id }) => await removeOf(ctx, userId, id),
})

export const sendTestFor = internalMutation({
  args: { userId: v.id('users'), id: v.id('webhooks') },
  returns: v.id('webhookDeliveries'),
  handler: async (ctx, { userId, id }) => await testOf(ctx, userId, id),
})

export const deliveriesFor = internalQuery({
  args: { userId: v.id('users'), id: v.id('webhooks') },
  returns: v.array(deliveryView),
  handler: async (ctx, { userId, id }) => await deliveriesOf(ctx, userId, id),
})

// --- delivery

export const loadDelivery = internalQuery({
  args: { deliveryId: v.id('webhookDeliveries') },
  handler: async (ctx, { deliveryId }) => {
    const delivery = await ctx.db.get(deliveryId)
    if (!delivery) return null
    const webhook = await ctx.db.get(delivery.webhookId)
    if (!webhook) return null
    return { delivery, webhook }
  },
})

export const recordAttempt = internalMutation({
  args: {
    deliveryId: v.id('webhookDeliveries'),
    ok: v.boolean(),
    responseStatus: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { deliveryId, ok, responseStatus, error }) => {
    const d = await ctx.db.get(deliveryId)
    if (!d) return null
    const w = await ctx.db.get(d.webhookId)
    const now = Date.now()
    const attempt = d.attempt + 1
    const wait = RETRY_AFTER_MS[attempt - 1]
    const willRetry = !ok && wait !== undefined
    await ctx.db.patch(deliveryId, {
      attempt,
      status: ok ? 'ok' : willRetry ? 'pending' : 'failed',
      responseStatus,
      error: ok ? undefined : error,
      nextAttemptAt: willRetry ? now + wait : undefined,
      updatedAt: now,
    })
    if (willRetry) await ctx.scheduler.runAfter(wait, internal.webhooks.deliver, { deliveryId })
    if (!w) return null
    const failedInARow = ok ? 0 : willRetry ? w.failedInARow : w.failedInARow + 1
    const disable = !ok && !willRetry && failedInARow >= DISABLE_AFTER && w.active
    await ctx.db.patch(w._id, {
      lastDeliveryAt: now,
      lastStatus: ok ? 'ok' : 'failed',
      failedInARow,
      ...(disable ? { active: false } : {}),
    })
    if (disable)
      await ctx.scheduler.runAfter(0, internal.email.sendWebhookDisabled, {
        userId: w.userId,
        url: w.url,
      })
    return null
  },
})

/** Signs and sends one delivery; the outcome and any retry are recorded by `recordAttempt`. */
export const deliver = internalAction({
  args: { deliveryId: v.id('webhookDeliveries') },
  returns: v.null(),
  handler: async (ctx, { deliveryId }) => {
    const loaded = await ctx.runQuery(internal.webhooks.loadDelivery, { deliveryId })
    if (!loaded || loaded.delivery.status !== 'pending') return null
    if (!loaded.webhook.active) {
      await ctx.runMutation(internal.webhooks.recordAttempt, {
        deliveryId,
        ok: false,
        error: 'The webhook is off.',
      })
      return null
    }
    const { delivery, webhook } = loaded
    // Checked again at send time: the rules may be stricter than when it was saved, and the name
    // may now point somewhere private.
    const refused =
      webhookUrlProblem(webhook.url) ??
      ((await resolvesPrivate(new URL(webhook.url).hostname).catch(() => true))
        ? 'The host resolves to a private address, or does not resolve.'
        : null)
    if (refused) {
      await ctx.runMutation(internal.webhooks.recordAttempt, {
        deliveryId,
        ok: false,
        error: refused,
      })
      return null
    }
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = await signWebhook(
      await decryptSecret(webhook.secretEnc),
      delivery._id,
      timestamp,
      delivery.payload,
    )
    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Dispatchlet-Webhooks/1',
          'webhook-id': delivery._id,
          'webhook-timestamp': String(timestamp),
          'webhook-signature': signature,
        },
        body: delivery.payload,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        redirect: 'manual',
      })
      const ok = response.status >= 200 && response.status < 300
      await ctx.runMutation(internal.webhooks.recordAttempt, {
        deliveryId,
        ok,
        responseStatus: response.status,
        error: ok ? undefined : `The receiver answered ${response.status}.`,
      })
    } catch (error) {
      await ctx.runMutation(internal.webhooks.recordAttempt, {
        deliveryId,
        ok: false,
        error:
          error instanceof Error && error.name === 'TimeoutError'
            ? 'No answer within 10 seconds.'
            : 'Could not connect to the receiver.',
      })
    }
    return null
  },
})

/** Daily: deliveries older than a month go. */
export const purge = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - KEEP_DELIVERIES_MS
    const old = await ctx.db
      .query('webhookDeliveries')
      .withIndex('by_createdAt', (q) => q.lt('createdAt', cutoff))
      .take(500)
    for (const d of old) await ctx.db.delete(d._id)
    return null
  },
})
