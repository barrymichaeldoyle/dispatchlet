import { httpRouter } from 'convex/server'
import { internal } from './_generated/api'
import { httpAction } from './_generated/server'
import { registerApi } from './api/router'
import { auth } from './auth'
import { isValidEmail, normalizeEmail } from './lib/email'

const HOUR = 60 * 60 * 1000
const DEFAULT_RATE_LIMIT = 5

const http = httpRouter()
auth.addHttpRoutes(http)
registerApi(http)

function siteUrl(): string {
  return process.env.SITE_URL ?? 'https://dispatchlet.com'
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': siteUrl(),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  })
}

function page(status: number, text: string): Response {
  const site = siteUrl()
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Dispatchlet</title><link rel="icon" href="${site}/favicon.svg"><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f4f4f1;color:#1a1a1a;font:15px/1.55 system-ui,sans-serif}main{max-width:48ch;padding:32px}p{margin:0 0 16px}a{color:#0f6e56}@media(prefers-color-scheme:dark){body{background:#161616;color:#ededea}a{color:#5cc9a8}}</style></head><body><main><p>${text}</p><p><a href="${site}/">Back to dispatchlet.com</a></p></main></body></html>`
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

async function hashIp(ip: string): Promise<string> {
  const salt = process.env.IP_HASH_SALT ?? ''
  const data = new TextEncoder().encode(`${salt}:${ip}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function clientIp(req: Request): string | undefined {
  const cf = req.headers.get('cf-connecting-ip')
  if (cf) return cf
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]?.trim()
  return undefined
}

function rateLimit(): number {
  const n = Number(process.env.WAITLIST_RATE_LIMIT)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RATE_LIMIT
}

type Submission = { email: string; website: string; source: string; campaign: string }

async function readSubmission(req: Request): Promise<Submission> {
  const type = req.headers.get('content-type') ?? ''
  let raw: Record<string, unknown> = {}
  if (type.includes('application/json')) {
    const value: unknown = await req.json().catch(() => null)
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      raw = value as Record<string, unknown>
    }
  } else {
    const form = await req.formData().catch(() => null)
    if (form) raw = Object.fromEntries(form.entries())
  }
  const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : '')
  return {
    email: str('email'),
    website: str('website'),
    source: str('source'),
    campaign: str('campaign'),
  }
}

function wantsJson(req: Request): boolean {
  const accept = req.headers.get('accept') ?? ''
  const type = req.headers.get('content-type') ?? ''
  return accept.includes('application/json') || type.includes('application/json')
}

function referrerHost(req: Request): string | undefined {
  const ref = req.headers.get('referer')
  if (!ref) return undefined
  try {
    const host = new URL(ref).host
    const own = new URL(siteUrl()).host
    return host === own ? undefined : host
  } catch {
    return undefined
  }
}

http.route({
  path: '/waitlist',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders() })),
})

http.route({
  path: '/waitlist',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const asJson = wantsJson(req)
    const body = await readSubmission(req)

    // Honeypot: a filled "website" field means a bot. Say yes and store nothing.
    if (body.website.trim() !== '') {
      return asJson ? json(200, { ok: true }) : page(200, 'Thanks. Check your email to confirm.')
    }

    const email = normalizeEmail(body.email)
    if (!isValidEmail(email)) {
      return asJson
        ? json(400, { ok: false, error: 'invalid_email' })
        : page(400, 'That email does not look right.')
    }

    const rawIp = clientIp(req)
    const ip = rawIp ? await hashIp(rawIp) : undefined
    if (ip) {
      const recent = await ctx.runQuery(internal.waitlist.recentCountByIp, {
        ip,
        since: Date.now() - HOUR,
      })
      if (recent >= rateLimit()) {
        return asJson
          ? json(429, { ok: false, error: 'rate_limited' })
          : page(429, 'Too many tries, wait a minute.')
      }
    }

    const source = body.source.trim() || referrerHost(req) || 'direct'
    const campaign = body.campaign.trim() || undefined
    const result = await ctx.runMutation(internal.waitlist.add, { email, source, campaign, ip })
    if (result.isNew) {
      await ctx.scheduler.runAfter(0, internal.email.sendConfirm, { email, token: result.token })
    }
    return asJson
      ? json(200, { ok: true, position: result.position })
      : page(200, `You are number ${result.position} on the list. Check your email to confirm.`)
  }),
})

http.route({
  path: '/waitlist/confirm',
  method: 'GET',
  handler: httpAction(async (ctx, req) => {
    const token = new URL(req.url).searchParams.get('token') ?? ''
    const ok = token !== '' && (await ctx.runMutation(internal.waitlist.confirm, { token }))
    if (!ok) return page(404, 'This link is not valid.')
    return Response.redirect(`${siteUrl()}/?confirmed=1`, 302)
  }),
})

http.route({
  path: '/waitlist/unsubscribe',
  method: 'GET',
  handler: httpAction(async (ctx, req) => {
    const token = new URL(req.url).searchParams.get('token') ?? ''
    const ok = token !== '' && (await ctx.runMutation(internal.waitlist.unsubscribe, { token }))
    if (!ok) return page(404, 'This link is not valid.')
    return Response.redirect(`${siteUrl()}/?unsubscribed=1`, 302)
  }),
})

/**
 * PostHog's error tracking webhook (new or reopened issue). The request body is ignored: the
 * email is the same every time and only links to PostHog, so the endpoint needs no secret.
 */
http.route({
  path: '/alerts/errors',
  method: 'POST',
  handler: httpAction(async (ctx) => {
    if (await ctx.runMutation(internal.alerts.claimErrorAlert, {})) {
      await ctx.scheduler.runAfter(0, internal.email.sendErrorAlert, {})
    }
    return new Response(null, { status: 202 })
  }),
})

/** The one-click approve link from the digest email: moves the draft into the queue. */
http.route({
  path: '/approve',
  method: 'GET',
  handler: httpAction(async (ctx, req) => {
    const token = new URL(req.url).searchParams.get('token') ?? ''
    if (!token) return page(404, 'This link is not valid.')
    const result = await ctx.runAction(internal.approvals.approveByToken, { token })
    if (!result.ok) return page(result.status, result.message)
    return page(200, result.message)
  }),
})

export default http
