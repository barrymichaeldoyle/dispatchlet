import { httpRouter } from 'convex/server'
import { internal } from './_generated/api'
import { httpAction } from './_generated/server'
import { registerApi } from './api/router'
import { auth } from './auth'
import { isSignupOpen } from './lib/allowlist'
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

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * `text` is trusted HTML; `extra` is more trusted HTML placed after it, such as a form. A function
 * gets a nonce for its own `<script nonce>`: inline handlers are not allowed by the policy.
 */
function page(
  status: number,
  text: string,
  extra: string | ((nonce: string) => string) = '',
): Response {
  const site = siteUrl()
  const nonce = crypto.randomUUID()
  const more = typeof extra === 'function' ? extra(nonce) : extra
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Dispatchlet</title><link rel="icon" href="${site}/favicon.svg"><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f4f4f1;color:#1a1a1a;font:15px/1.55 system-ui,sans-serif}main{max-width:48ch;padding:32px}blockquote{margin:0 0 16px;padding:12px 16px;border-left:3px solid #0f6e56;background:#fff;white-space:pre-wrap}button{font:inherit;min-width:16em;font-weight:500;min-height:44px;padding:0 20px;border:0;border-radius:8px;background:#0f6e56;color:#f4f4f1;cursor:pointer}button:disabled{opacity:.7;cursor:progress}form{margin:0 0 16px}@media(prefers-color-scheme:dark){blockquote{background:#1f1f1e;border-color:#5cc9a8}button{background:#5cc9a8;color:#161616}}p{margin:0 0 16px}a{color:#0f6e56}@media(prefers-color-scheme:dark){body{background:#161616;color:#ededea}a{color:#5cc9a8}}</style></head><body><main><p>${text}</p>${more}<p><a href="${site}/">Back to dispatchlet.com</a></p></main></body></html>`
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...pageHeaders(site, nonce) },
  })
}

/** These pages hold tokens in their URLs and a form that approves a post, so they are locked down. */
function pageHeaders(site: string, nonce: string): Record<string, string> {
  return {
    'Content-Security-Policy': [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      `img-src ${site}`,
      `script-src 'nonce-${nonce}'`,
      "form-action 'self'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  }
}

/**
 * IPs are stored hashed with a secret salt, so the list cannot be joined to anything by address.
 * Without the salt the hash would be reversible by trying every address, so it is refused.
 */
async function hashIp(ip: string): Promise<string> {
  const salt = process.env.IP_HASH_SALT
  if (!salt)
    throw new Error(
      'IP_HASH_SALT is not set on this deployment. Set a long random value: npx convex env set IP_HASH_SALT <value>',
    )
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
    // The list closes when sign-up opens: an old page or a bot gets told where to go instead.
    if (isSignupOpen()) {
      return asJson
        ? json(410, { ok: false, error: 'closed' })
        : page(410, 'Dispatchlet is open. Sign in with Buffer at dispatchlet.com/app.')
    }
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
    // The IP comes from headers a direct caller can forge, so `add` also caps confirmation emails
    // per address and in total before it stores a new row.
    const result = await ctx.runMutation(internal.waitlist.add, { email, source, campaign, ip })
    if (result.limited) {
      return asJson
        ? json(429, { ok: false, error: 'rate_limited' })
        : page(429, 'Too many sign-ups right now, try again in an hour.')
    }
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

/** Same length and bytes, in time that does not depend on where they first differ. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!
  return diff === 0
}

/**
 * PostHog's error tracking webhook (new or reopened issue). The request body is ignored: the
 * email is the same every time and only links to PostHog. With `ALERTS_SECRET` set, the call must
 * carry it in `X-Alerts-Secret`; without it anyone can ring the bell, so the 10-minute dedupe in
 * `claimErrorAlert` is all that stops a flood.
 */
http.route({
  path: '/alerts/errors',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.ALERTS_SECRET
    if (secret && !sameSecret(req.headers.get('x-alerts-secret') ?? '', secret))
      return new Response(null, { status: 401 })
    if (await ctx.runMutation(internal.alerts.claimErrorAlert, {})) {
      await ctx.scheduler.runAfter(0, internal.email.sendErrorAlert, {})
    }
    return new Response(null, { status: 202 })
  }),
})

/**
 * Whether the recurring jobs and the run scheduler are keeping up (alerts.health). 503 when not,
 * so an outside probe such as the health workflow fails and says so. The body names jobs only.
 */
http.route({
  path: '/health',
  method: 'GET',
  handler: httpAction(async (ctx) => {
    const report = await ctx.runQuery(internal.alerts.health, {})
    return new Response(JSON.stringify(report), {
      status: report.ok ? 200 : 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  }),
})

/**
 * The approve link from the digest email. Opening it only shows the draft and a button: email
 * security scanners open every link in a message, so a link that approved on sight could put a
 * draft in someone's queue without them. Pressing the button sends the POST below.
 */
http.route({
  path: '/approve',
  method: 'GET',
  handler: httpAction(async (ctx, req) => {
    const token = new URL(req.url).searchParams.get('token') ?? ''
    const post = token ? await ctx.runQuery(internal.approvals.postByToken, { token }) : null
    if (!post) return page(404, 'This link is not valid, or the post was already approved.')
    return page(
      200,
      'Approve this draft and add it to your Buffer queue?',
      (nonce) =>
        `<blockquote>${escapeHtml(post.text)}</blockquote><form id="approve" method="post" action="?token=${encodeURIComponent(token)}"><button type="submit">Approve and add to the queue</button></form><script nonce="${nonce}">document.getElementById('approve').addEventListener('submit',function(){var b=this.querySelector('button');b.disabled=true;b.textContent='Approving'})</script>`,
    )
  }),
})

http.route({
  path: '/approve',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const token = new URL(req.url).searchParams.get('token') ?? ''
    if (!token) return page(404, 'This link is not valid.')
    const result = await ctx.runAction(internal.approvals.approveByToken, { token })
    return page(result.ok ? 200 : result.status, escapeHtml(result.message))
  }),
})

export default http
