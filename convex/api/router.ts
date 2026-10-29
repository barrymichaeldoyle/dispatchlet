/**
 * The REST API (SPEC §44.3): `/v1/*` on the Convex site, reached through dispatchlet.com/api/v1.
 * Each route authenticates, checks scope, validates, calls one internal function and answers.
 */
import type { HttpRouter } from 'convex/server'
import { z } from 'zod'
import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import { httpAction, type ActionCtx } from '../_generated/server'
import { syncChannelsFor } from '../buffer'
import { SetupAnswers } from '../lib/ai/setup'
import { authenticate, requireWrite, type Caller } from './auth'
import {
  ApiError,
  CORS,
  errorResponse,
  fromAppError,
  jsonResponse,
  matchPath,
  readJson,
  textResponse,
  type Params,
} from './http'
import { openApiDocument } from './openapi'
import { HookBody, mapHookBody } from '../lib/hookPayload'
import { hashSecret, HOOK_PREFIX, looksLikeSecret } from '../lib/apiToken'
import { WEBHOOK_EVENTS, webhookUrlProblem } from '../lib/standardWebhooks'

type Handler = (ctx: ActionCtx, caller: Caller, params: Params, req: Request) => Promise<Response>
type Route = { method: string; pattern: string; scope: 'read' | 'write'; handler: Handler }

const routes: Route[] = []
const route = (method: string, pattern: string, scope: 'read' | 'write', handler: Handler) =>
  routes.push({ method, pattern, scope, handler })

function siteUrl(): string {
  return process.env.SITE_URL ?? 'https://dispatchlet.com'
}

function idOf<T extends 'automations' | 'runs' | 'posts' | 'webhooks' | 'inboundHooks'>(
  raw: string,
  table: T,
): Id<T> {
  // Convex ids are base32-ish strings; a malformed one is a 404 like any other unknown id.
  if (!/^[a-z0-9]{20,40}$/.test(raw))
    throw new ApiError(404, 'not_found', `No such ${table.replace(/s$/, '')}.`)
  return raw as Id<T>
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const field = issue?.path.map(String).join('.') || undefined
  throw new ApiError(
    400,
    'invalid',
    issue ? `${field ? `${field}: ` : ''}${issue.message}` : 'Invalid body',
    field,
  )
}

const Cadence = SetupAnswers.shape.cadence

// --- account

route('GET', '/me', 'read', async (ctx, caller) => {
  const me = await ctx.runQuery(internal.api.fns.me, { userId: caller.userId })
  if (!me) throw new ApiError(404, 'not_found', 'Account not found.')
  return jsonResponse(200, me, { rate: caller.rate })
})

route('GET', '/channels', 'read', async (ctx, caller) =>
  jsonResponse(
    200,
    { channels: await ctx.runQuery(internal.api.fns.channels, { userId: caller.userId }) },
    { rate: caller.rate },
  ),
)

route('POST', '/channels/sync', 'write', async (ctx, caller) => {
  const result = await syncChannelsFor(ctx, caller.userId)
  return jsonResponse(
    200,
    {
      synced: result.channels,
      channels: await ctx.runQuery(internal.api.fns.channels, { userId: caller.userId }),
    },
    { rate: caller.rate },
  )
})

// --- automations

route('GET', '/automations', 'read', async (ctx, caller) =>
  jsonResponse(
    200,
    { automations: await ctx.runQuery(internal.api.fns.automations, { userId: caller.userId }) },
    { rate: caller.rate },
  ),
)

const CreateBody = z.object({
  setup: SetupAnswers.omit({ services: true }).extend({
    services: z.array(SetupAnswers.shape.services.element).optional(),
  }),
  channelIds: z.array(z.string().min(1)).min(1),
})

route('POST', '/automations', 'write', async (ctx, caller, _p, req) => {
  const body = parse(CreateBody, await readJson(req))
  const id = await ctx.runMutation(internal.api.fns.createAutomation, {
    userId: caller.userId,
    // Services are derived from the chosen channels inside createFor; the placeholder satisfies the validator.
    setup: { ...body.setup, services: body.setup.services ?? ['twitter'] },
    channelIds: body.channelIds,
  })
  const automation = await ctx.runQuery(internal.api.fns.automation, { userId: caller.userId, id })
  return jsonResponse(202, { automation }, { rate: caller.rate })
})

route('GET', '/automations/:id', 'read', async (ctx, caller, { id }) => {
  const automation = await ctx.runQuery(internal.api.fns.automation, {
    userId: caller.userId,
    id: idOf(id!, 'automations'),
  })
  if (!automation) throw new ApiError(404, 'not_found', 'No such automation.')
  return jsonResponse(200, { automation }, { rate: caller.rate })
})

const PatchBody = z
  .object({
    cadence: Cadence.optional(),
    channelIds: z.array(z.string().min(1)).min(1).optional(),
    postingMode: z.enum(['draft', 'queue', 'spread']).optional(),
    maxPostsPerRun: z.number().int().min(1).max(3).optional(),
    status: z.enum(['active', 'paused']).optional(),
  })
  .strict()

route('PATCH', '/automations/:id', 'write', async (ctx, caller, { id }, req) => {
  const body = parse(PatchBody, await readJson(req))
  if (!Object.values(body).some((x) => x !== undefined))
    throw new ApiError(400, 'invalid', 'Nothing to change.')
  const automationId = idOf(id!, 'automations')
  await ctx.runMutation(internal.api.fns.updateAutomation, {
    userId: caller.userId,
    id: automationId,
    ...body,
  })
  const automation = await ctx.runQuery(internal.api.fns.automation, {
    userId: caller.userId,
    id: automationId,
  })
  return jsonResponse(200, { automation }, { rate: caller.rate })
})

route('DELETE', '/automations/:id', 'write', async (ctx, caller, { id }) => {
  await ctx.runMutation(internal.api.fns.deleteAutomation, {
    userId: caller.userId,
    id: idOf(id!, 'automations'),
  })
  return jsonResponse(200, { deleted: true }, { rate: caller.rate })
})

// --- playbook

route('GET', '/automations/:id/playbook', 'read', async (ctx, caller, { id }, req) => {
  const playbook = await ctx.runQuery(internal.api.fns.playbook, {
    userId: caller.userId,
    id: idOf(id!, 'automations'),
  })
  if (!playbook) throw new ApiError(404, 'not_found', 'The playbook is not ready yet.')
  if ((req.headers.get('accept') ?? '').includes('text/markdown'))
    return textResponse(200, playbook.text, 'text/markdown; charset=utf-8', { rate: caller.rate })
  return jsonResponse(200, playbook, { rate: caller.rate })
})

route('PUT', '/automations/:id/playbook', 'write', async (ctx, caller, { id }, req) => {
  const type = req.headers.get('content-type') ?? ''
  const text = type.includes('text/')
    ? await req.text()
    : parse(z.object({ text: z.string().min(1) }), await readJson(req)).text
  const result = await ctx.runMutation(internal.api.fns.savePlaybook, {
    userId: caller.userId,
    id: idOf(id!, 'automations'),
    text,
  })
  if (!result.ok)
    return errorResponse(400, 'invalid', result.message, { rate: caller.rate, line: result.line })
  const playbook = await ctx.runQuery(internal.api.fns.playbook, {
    userId: caller.userId,
    id: idOf(id!, 'automations'),
  })
  return jsonResponse(200, playbook, { rate: caller.rate })
})

route('POST', '/automations/:id/rules', 'write', async (ctx, caller, { id }, req) => {
  const { rule } = parse(z.object({ rule: z.string().min(3).max(200) }), await readJson(req))
  const version = await ctx.runMutation(internal.api.fns.addRule, {
    userId: caller.userId,
    id: idOf(id!, 'automations'),
    rule,
  })
  return jsonResponse(200, { version }, { rate: caller.rate })
})

// --- runs

const Hint = z.object({
  title: z.string().trim().min(1).max(200),
  url: z.string().url().max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
})

route('POST', '/automations/:id/runs', 'write', async (ctx, caller, { id }, req) => {
  const body = parse(
    z.object({ dry: z.boolean().default(false), hint: Hint.optional() }),
    await readJson(req),
  )
  const runId = await ctx.runMutation(internal.api.fns.startRun, {
    userId: caller.userId,
    automationId: idOf(id!, 'automations'),
    dry: body.dry,
    hint: body.hint,
    startedBy: 'api',
  })
  const run = await ctx.runQuery(internal.api.fns.run, { userId: caller.userId, runId })
  return jsonResponse(202, { run }, { rate: caller.rate })
})

route('GET', '/automations/:id/runs', 'read', async (ctx, caller, { id }, req) => {
  const url = new URL(req.url)
  const limit = Number(url.searchParams.get('limit') ?? 20)
  const before = url.searchParams.get('before')
  const runs = await ctx.runQuery(internal.api.fns.runs, {
    userId: caller.userId,
    automationId: idOf(id!, 'automations'),
    limit: Number.isFinite(limit) ? limit : 20,
    before: before ? Number(before) : undefined,
  })
  return jsonResponse(200, { runs }, { rate: caller.rate })
})

route('GET', '/runs/:id', 'read', async (ctx, caller, { id }) => {
  const run = await ctx.runQuery(internal.api.fns.run, {
    userId: caller.userId,
    runId: idOf(id!, 'runs'),
  })
  if (!run) throw new ApiError(404, 'not_found', 'No such run.')
  return jsonResponse(200, { run }, { rate: caller.rate })
})

route('POST', '/runs/:id/share', 'write', async (ctx, caller, { id }) => {
  const token = await ctx.runMutation(internal.api.fns.shareRun, {
    userId: caller.userId,
    runId: idOf(id!, 'runs'),
  })
  return jsonResponse(200, { url: `${siteUrl()}/r/${token}` }, { rate: caller.rate })
})

// --- posts

route('GET', '/posts', 'read', async (ctx, caller, _p, req) => {
  const url = new URL(req.url)
  const q = parse(
    z.object({
      status: z
        .enum(['dry', 'rejected', 'held', 'draft', 'queued', 'scheduled', 'sent', 'failed'])
        .optional(),
      automation: z.string().optional(),
      since: z.coerce.number().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
    Object.fromEntries(url.searchParams),
  )
  const posts = await ctx.runQuery(internal.api.fns.posts, {
    userId: caller.userId,
    status: q.status,
    automationId: q.automation ? idOf(q.automation, 'automations') : undefined,
    since: q.since,
    limit: q.limit,
  })
  return jsonResponse(200, { posts }, { rate: caller.rate })
})

route('GET', '/posts/:id', 'read', async (ctx, caller, { id }) => {
  const post = await ctx.runQuery(internal.api.fns.post, {
    userId: caller.userId,
    postId: idOf(id!, 'posts'),
  })
  if (!post) throw new ApiError(404, 'not_found', 'No such post.')
  return jsonResponse(200, { post }, { rate: caller.rate })
})

route('POST', '/posts/:id/approve', 'write', async (ctx, caller, { id }) => {
  const postId = idOf(id!, 'posts')
  const message = await ctx.runAction(internal.approvals.approveForUser, {
    userId: caller.userId,
    postId,
    from: 'api',
  })
  const post = await ctx.runQuery(internal.api.fns.post, { userId: caller.userId, postId })
  return jsonResponse(200, { post, message }, { rate: caller.rate })
})

// --- webhooks (SPEC §44.4)

route('GET', '/webhooks', 'read', async (ctx, caller) =>
  jsonResponse(
    200,
    { webhooks: await ctx.runQuery(internal.webhooks.listFor, { userId: caller.userId }) },
    { rate: caller.rate },
  ),
)

const WebhookBody = z.object({
  url: z.string().url().max(2000),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  automationId: z.string().optional(),
})

route('POST', '/webhooks', 'write', async (ctx, caller, _p, req) => {
  const body = parse(WebhookBody, await readJson(req))
  const problem = webhookUrlProblem(body.url)
  if (problem) throw new ApiError(400, 'invalid', problem, 'url')
  const made = await ctx.runMutation(internal.webhooks.createFor, {
    userId: caller.userId,
    url: body.url,
    events: body.events,
    automationId: body.automationId ? idOf(body.automationId, 'automations') : undefined,
  })
  return jsonResponse(201, made, { rate: caller.rate })
})

route('DELETE', '/webhooks/:id', 'write', async (ctx, caller, { id }) => {
  await ctx.runMutation(internal.webhooks.removeFor, {
    userId: caller.userId,
    id: idOf(id!, 'webhooks'),
  })
  return jsonResponse(200, { deleted: true }, { rate: caller.rate })
})

route('POST', '/webhooks/:id/test', 'write', async (ctx, caller, { id }) => {
  const deliveryId = await ctx.runMutation(internal.webhooks.sendTestFor, {
    userId: caller.userId,
    id: idOf(id!, 'webhooks'),
  })
  return jsonResponse(202, { deliveryId }, { rate: caller.rate })
})

route('GET', '/webhooks/:id/deliveries', 'read', async (ctx, caller, { id }) =>
  jsonResponse(
    200,
    {
      deliveries: await ctx.runQuery(internal.webhooks.deliveriesFor, {
        userId: caller.userId,
        id: idOf(id!, 'webhooks'),
      }),
    },
    { rate: caller.rate },
  ),
)

// --- inbound hooks (SPEC §44.5)

route('GET', '/hooks', 'read', async (ctx, caller) =>
  jsonResponse(
    200,
    { hooks: await ctx.runQuery(internal.hooks.listFor, { userId: caller.userId }) },
    { rate: caller.rate },
  ),
)

route('POST', '/hooks', 'write', async (ctx, caller, _p, req) => {
  const body = parse(
    z.object({ automationId: z.string(), name: z.string().trim().min(1).max(40) }),
    await readJson(req),
  )
  const made = await ctx.runMutation(internal.hooks.createFor, {
    userId: caller.userId,
    automationId: idOf(body.automationId, 'automations'),
    name: body.name,
  })
  return jsonResponse(
    201,
    { ...made, url: `${siteUrl()}/api/v1/hooks/${made.token}` },
    { rate: caller.rate },
  )
})

route('DELETE', '/hooks/:id', 'write', async (ctx, caller, { id }) => {
  await ctx.runMutation(internal.hooks.removeFor, {
    userId: caller.userId,
    id: idOf(id!, 'inboundHooks'),
  })
  return jsonResponse(200, { deleted: true }, { rate: caller.rate })
})

// --- dispatch

async function dispatch(ctx: ActionCtx, req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/v1/, '') || '/'
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (path === '/openapi.json' && req.method === 'GET')
    return jsonResponse(200, openApiDocument(siteUrl()))
  // The inbound hook: the token is the credential, so no bearer check.
  const hook = matchPath('/hooks/:token', path)
  if (hook && req.method === 'POST') return await inboundHook(ctx, hook.token!, req)

  let matched: { route: Route; params: Params } | null = null
  let pathKnown = false
  for (const r of routes) {
    const params = matchPath(r.pattern, path)
    if (!params) continue
    pathKnown = true
    if (r.method === req.method) {
      matched = { route: r, params }
      break
    }
  }
  if (!matched)
    return errorResponse(
      pathKnown ? 405 : 404,
      'not_found',
      pathKnown ? 'That method is not allowed here.' : 'No such route. See /api/v1/openapi.json.',
    )
  const caller = await authenticate(ctx, req)
  if (caller instanceof Response) return caller
  if (matched.route.scope === 'write') {
    const denied = requireWrite(caller)
    if (denied) return denied
  }
  try {
    return await matched.route.handler(ctx, caller, matched.params, req)
  } catch (error) {
    const api = fromAppError(error)
    if (api.status >= 500) console.error('API route failed', req.method, path, error)
    return errorResponse(api.status, api.code, api.message, { rate: caller.rate, field: api.field })
  }
}

async function inboundHook(ctx: ActionCtx, token: string, req: Request): Promise<Response> {
  if (!looksLikeSecret(token, HOOK_PREFIX)) return errorResponse(404, 'not_found', 'No such hook.')
  const hook = await ctx.runQuery(internal.hooks.byHash, { hash: await hashSecret(token) })
  if (!hook) return errorResponse(404, 'not_found', 'No such hook.')
  const rate = await ctx.runMutation(internal.api.rate.check, {
    tokenKey: `hook:${hook._id}`,
    userKey: hook.userId,
  })
  if (!rate.ok) return errorResponse(429, 'rate_limited', 'Too many requests to this hook.')
  let body: unknown
  try {
    body = await readJson(req)
  } catch (error) {
    const api = fromAppError(error)
    return errorResponse(api.status, api.code, api.message)
  }
  const mapped = mapHookBody(req.headers.get('x-github-event'), body)
  if (!mapped.ok) return errorResponse(400, 'invalid', mapped.message)
  const parsed = HookBody.safeParse(mapped.body)
  if (!parsed.success)
    return errorResponse(400, 'invalid', parsed.error.issues[0]?.message ?? 'Invalid body')
  try {
    const runId = await ctx.runMutation(internal.api.fns.startRun, {
      userId: hook.userId,
      automationId: hook.automationId,
      dry: parsed.data.dry ?? false,
      hint: parsed.data.hint,
      startedBy: 'hook',
    })
    await ctx.runMutation(internal.hooks.touch, { id: hook._id })
    return jsonResponse(202, {
      run: { id: runId, url: `${siteUrl()}/app/a/${hook.automationId}/runs/${runId}` },
    })
  } catch (error) {
    const api = fromAppError(error)
    return errorResponse(api.status, api.code, api.message)
  }
}

export function registerApi(http: HttpRouter) {
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const)
    http.route({ pathPrefix: '/v1/', method, handler: httpAction(dispatch) })
}
