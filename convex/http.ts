import { httpRouter } from 'convex/server'
import { internal } from './_generated/api'
import { httpAction } from './_generated/server'
import { registerApi } from './api/router'
import { auth } from './auth'

const http = httpRouter()
auth.addHttpRoutes(http)
registerApi(http)

function siteUrl(): string {
  return process.env.SITE_URL ?? 'https://dispatchlet.com'
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

// The waiting list was deleted after launch. The launch email's unsubscribe link still lands
// here, so it gets a page rather than a 404.
http.route({
  path: '/waitlist/unsubscribe',
  method: 'GET',
  handler: httpAction(async () =>
    page(200, 'The waiting list has been deleted, so you will not get any more emails from it.'),
  ),
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
 * email is the same every time and only links to PostHog. The call must carry `ALERTS_SECRET` in
 * `X-Alerts-Secret`; with no secret set the endpoint is closed rather than open to anyone.
 */
http.route({
  path: '/alerts/errors',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.ALERTS_SECRET
    if (!secret || !sameSecret(req.headers.get('x-alerts-secret') ?? '', secret))
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
