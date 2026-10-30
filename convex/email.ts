import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction } from './_generated/server'

const FROM = 'Barry at Dispatchlet <barry@dispatchlet.com>'
const RESEND = 'https://api.resend.com'

function links(token: string) {
  const site = process.env.CONVEX_SITE_URL
  return {
    confirm: `${site}/waitlist/confirm?token=${token}`,
    unsubscribe: `${site}/waitlist/unsubscribe?token=${token}`,
  }
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

const MUTED = 'color:#6a6a66'
const PRIVACY = `<a href="https://dispatchlet.com/privacy" style="${MUTED}">privacy policy</a>`

/** The footer for list emails: why it was sent (if given), unsubscribe and the privacy policy. */
function listFooter(unsubscribe: string, reason?: string): string {
  const why = reason ? `${escapeHtml(reason)} ` : ''
  return `${why}<a href="${unsubscribe}" style="${MUTED}">Unsubscribe</a> or read the ${PRIVACY}.`
}

function html(paragraphs: string[], footer: string): string {
  const body = paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font:15px/1.55 system-ui,sans-serif;color:#1a1a1a">${p}</p>`,
    )
    .join('')
  return `<div style="max-width:560px;padding:24px">${body}<p style="margin:24px 0 0;font:13px/1.5 system-ui,sans-serif;${MUTED}">${footer}</p></div>`
}

type Message = {
  from: string
  to: string
  subject: string
  text: string
  html: string
  headers: Record<string, string>
}

function confirmMessage(email: string, token: string): Message {
  const l = links(token)
  return {
    from: FROM,
    to: email,
    subject: 'Confirm your place on the Dispatchlet list',
    text: `You asked to hear when Dispatchlet opens. Confirm here: ${l.confirm}\n\nIf this was not you, ignore this email.\n\nUnsubscribe: ${l.unsubscribe}\nPrivacy policy: https://dispatchlet.com/privacy\n`,
    html: html(
      [
        `You asked to hear when Dispatchlet opens. Confirm here: <a href="${l.confirm}" style="color:#0f6e56">${escapeHtml(l.confirm)}</a>`,
        'If this was not you, ignore this email.',
      ],
      listFooter(l.unsubscribe),
    ),
    headers: { 'List-Unsubscribe': `<${l.unsubscribe}>` },
  }
}

const LAUNCH_REASON = 'You got this because you joined the Dispatchlet waiting list.'

export function launchMessage(email: string, token: string): Message {
  const l = links(token)
  const link = '<a href="https://dispatchlet.com" style="color:#0f6e56">dispatchlet.com</a>'
  return {
    from: FROM,
    to: email,
    subject: 'Dispatchlet is open',
    text: `Dispatchlet is open. Sign in with your Buffer account at https://dispatchlet.com, answer a few questions about your topic, and it finds the news and writes posts into Buffer for you, as drafts to approve or straight into your queue.\n\nYour first 10 runs are on me. If you try it, reply and tell me what broke.\n\nBarry\n\n${LAUNCH_REASON}\nUnsubscribe: ${l.unsubscribe}\nPrivacy policy: https://dispatchlet.com/privacy\n`,
    html: html(
      [
        `Dispatchlet is open. Sign in with your Buffer account at ${link}, answer a few questions about your topic, and it finds the news and writes posts into Buffer for you, as drafts to approve or straight into your queue.`,
        'Your first 10 runs are on me. If you try it, reply and tell me what broke.',
        'Barry',
      ],
      listFooter(l.unsubscribe, LAUNCH_REASON),
    ),
    headers: {
      'List-Unsubscribe': `<${l.unsubscribe}>`,
    },
  }
}

export function reauthMessage(email: string): Message {
  const reconnect = 'https://dispatchlet.com/app'
  const reason = 'You got this because you use Dispatchlet with your Buffer account.'
  return {
    from: FROM,
    to: email,
    subject: 'Dispatchlet lost access to Buffer',
    text: `Buffer stopped accepting Dispatchlet's access to your account, so Dispatchlet can't post for you until you reconnect.\n\nReconnect here: ${reconnect}\n\nBarry\n\n${reason}\nPrivacy policy: https://dispatchlet.com/privacy\n`,
    html: html(
      [
        'Buffer stopped accepting Dispatchlet’s access to your account, so Dispatchlet can’t post for you until you reconnect.',
        `<a href="${reconnect}" style="color:#0f6e56">Reconnect Buffer</a>`,
        'Barry',
      ],
      `${escapeHtml(reason)} Read the ${PRIVACY}.`,
    ),
    headers: {},
  }
}

const ERROR_TRACKING = 'https://eu.posthog.com/project/307692/error_tracking'

/** To the owner when PostHog reports a new or reopened error. Says nothing from the request. */
export function errorAlertMessage(to: string): Message {
  return {
    from: FROM,
    to,
    subject: 'New error on Dispatchlet',
    text: `PostHog reported a new or reopened error on dispatchlet.com.\n\nOpen error tracking: ${ERROR_TRACKING}\n`,
    html: html(
      [
        'PostHog reported a new or reopened error on dispatchlet.com.',
        `<a href="${ERROR_TRACKING}" style="color:#0f6e56">Open error tracking</a>`,
      ],
      'Sent at most once every 10 minutes.',
    ),
    headers: {},
  }
}

const APP = 'https://dispatchlet.com/app'
const LINK = 'color:#0f6e56'

type DigestPost = {
  channelName: string
  text: string
  status: string
  approveToken: string | null
  externalLink: string | null
}

/** After a run with posts: what went where, with a one-click approve for each draft. */
export function digestMessage(
  to: string,
  run: { automationName: string; automationId: string; note: string },
  posts: DigestPost[],
): Message {
  const site = process.env.CONVEX_SITE_URL
  const runUrl = `${APP}/a/${run.automationId}`
  const drafts = posts.filter((p) => p.approveToken)
  const subject = drafts.length
    ? `${drafts.length} ${drafts.length === 1 ? 'draft' : 'drafts'} to approve from ${run.automationName}`
    : `${posts.length} ${posts.length === 1 ? 'post' : 'posts'} from ${run.automationName}`
  const textPosts = posts
    .map((p) => {
      const line = `${p.channelName}, ${p.status}:\n${p.text}`
      return p.approveToken ? `${line}\nApprove: ${site}/approve?token=${p.approveToken}` : line
    })
    .join('\n\n')
  const htmlPosts = posts.map((p) => {
    const body = `<strong>${escapeHtml(p.channelName)}</strong>, ${escapeHtml(p.status)}.<br>${escapeHtml(p.text).replaceAll('\n', '<br>')}`
    return p.approveToken
      ? `${body}<br><a href="${site}/approve?token=${p.approveToken}" style="${LINK}">Approve and add to the queue</a>`
      : body
  })
  return {
    from: FROM,
    to,
    subject,
    text: `${run.note}\n\n${textPosts}\n\nSee the run: ${runUrl}\n\nBarry\n\nPrivacy policy: https://dispatchlet.com/privacy\n`,
    html: html(
      [
        escapeHtml(run.note),
        ...htmlPosts,
        `<a href="${runUrl}" style="${LINK}">See the run</a>`,
        'Barry',
      ],
      `You get this after each run that creates posts. Read the ${PRIVACY}.`,
    ),
    headers: {},
  }
}

export function pausedMessage(to: string, automationName: string, automationId: string): Message {
  const url = `${APP}/a/${automationId}`
  return {
    from: FROM,
    to,
    subject: `${automationName} is paused after 3 failed runs`,
    text: `${automationName} failed three runs in a row, so Dispatchlet paused it. The run log says what went wrong.\n\n${url}\n\nBarry\n`,
    html: html(
      [
        `${escapeHtml(automationName)} failed three runs in a row, so Dispatchlet paused it. The run log says what went wrong.`,
        `<a href="${url}" style="${LINK}">Open the automation</a>`,
        'Barry',
      ],
      `Read the ${PRIVACY}.`,
    ),
    headers: {},
  }
}

export function runFailedMessage(
  to: string,
  automationName: string,
  automationId: string,
  reason: string,
): Message {
  const url = `${APP}/a/${automationId}`
  return {
    from: FROM,
    to,
    subject: `A run of ${automationName} failed`,
    text: `A run of ${automationName} failed: ${reason}\n\nThe next run is still booked. Two more failures in a row would pause it.\n\n${url}\n\nBarry\n`,
    html: html(
      [
        `A run of ${escapeHtml(automationName)} failed: ${escapeHtml(reason)}`,
        'The next run is still booked. Two more failures in a row would pause it.',
        `<a href="${url}" style="${LINK}">Open the run log</a>`,
        'Barry',
      ],
      `Sent on the first failure only. Read the ${PRIVACY}.`,
    ),
    headers: {},
  }
}

export function runsUsedUpMessage(to: string): Message {
  return {
    from: FROM,
    to,
    subject: 'Your free runs are used up',
    text: `Your 10 free runs on Dispatchlet are used up, so scheduled runs are skipped from now on. Add your own Anthropic key in settings to keep going.\n\n${APP}/settings\n\nBarry\n`,
    html: html(
      [
        'Your 10 free runs on Dispatchlet are used up, so scheduled runs are skipped from now on. Add your own Anthropic key in settings to keep going.',
        `<a href="${APP}/settings" style="${LINK}">Open settings</a>`,
        'Barry',
      ],
      `Sent once. Read the ${PRIVACY}.`,
    ),
    headers: {},
  }
}

/** A deployment whose site runs on this machine, such as the dev backend behind localhost:3131. */
function isLocalSite(): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(process.env.SITE_URL ?? '')
}

/**
 * Sends through Resend and returns whether it did. Without a key it throws, so a missing key on
 * the live site is an error people see; a local dev backend logs and skips instead, since e2e
 * runs there send confirmation emails nobody needs.
 */
async function resend(path: string, body: unknown): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    if (isLocalSite()) {
      console.log(`No RESEND_API_KEY on this local deployment; skipped ${path}.`)
      return false
    }
    throw new Error('RESEND_API_KEY is not set; no email was sent')
  }
  const res = await fetch(`${RESEND}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`Resend ${path} failed: ${res.status} ${await res.text()}`)
  }
  return true
}

export const sendConfirm = internalAction({
  args: { email: v.string(), token: v.string() },
  returns: v.null(),
  handler: async (_ctx, { email, token }) => {
    await resend('/emails', confirmMessage(email, token))
    return null
  },
})

/** The owner's error alert. `ALERT_EMAIL` overrides the default inbox. */
export const sendErrorAlert = internalAction({
  args: {},
  returns: v.null(),
  handler: async () => {
    await resend('/emails', errorAlertMessage(process.env.ALERT_EMAIL ?? 'barry@dispatchlet.com'))
    return null
  },
})

/** Sent once when Buffer stops accepting a user's grant (buffer.releaseRefresh). */
export const sendReauth = internalAction({
  args: { userId: v.id('users') },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const email = await ctx.runQuery(internal.users.emailFor, { userId })
    if (!email) return null
    await resend('/emails', reauthMessage(email))
    return null
  },
})

/**
 * Sends one copy of the launch email to an address on the list, so it can be checked in a real
 * inbox. Nobody is marked as sent. `npx convex run email:sendLaunchTest '{"email":"..."}' --prod`
 */
export const sendLaunchTest = internalAction({
  args: { email: v.string() },
  returns: v.null(),
  handler: async (ctx, { email }) => {
    const row = await ctx.runQuery(internal.waitlist.byEmail, { email })
    if (!row) throw new Error(`${email} is not on the waiting list`)
    await resend('/emails', launchMessage(row.email, row.token))
    return null
  },
})

/** Run once on launch day. Safe to run again: rows already sent are skipped. */
export const sendLaunch = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    let sent = 0
    for (;;) {
      const batch = await ctx.runQuery(internal.waitlist.nextLaunchBatch, { limit: 50 })
      if (batch.length === 0) break
      // Never mark people as sent when nothing went out, even on a local deployment.
      const delivered = await resend(
        '/emails/batch',
        batch.map((r) => launchMessage(r.email, r.token)),
      )
      if (!delivered) throw new Error('RESEND_API_KEY is not set; the launch email was not sent')
      await ctx.runMutation(internal.waitlist.markLaunchSent, { ids: batch.map((r) => r._id) })
      sent += batch.length
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    return sent
  },
})

export const sendDigest = internalAction({
  args: { runId: v.id('runs') },
  returns: v.null(),
  handler: async (ctx, { runId }) => {
    const digest = await ctx.runQuery(internal.approvals.digestFor, { runId })
    if (!digest?.email || !digest.posts.length) return null
    await resend('/emails', digestMessage(digest.email, digest.run, digest.posts))
    return null
  },
})

export const sendRunFailed = internalAction({
  args: { runId: v.id('runs') },
  returns: v.null(),
  handler: async (ctx, { runId }) => {
    const digest = await ctx.runQuery(internal.approvals.digestFor, { runId })
    if (!digest?.email) return null
    await resend(
      '/emails',
      runFailedMessage(
        digest.email,
        digest.run.automationName,
        digest.run.automationId,
        digest.run.note,
      ),
    )
    return null
  },
})

export function webhookDisabledMessage(to: string, url: string): Message {
  const settings = `${APP}/settings`
  return {
    from: FROM,
    to,
    subject: 'A Dispatchlet webhook was switched off',
    text: `Deliveries to ${url} failed ten times in a row, so Dispatchlet switched that webhook off. Turn it back on in settings once the receiver is fixed.\n\n${settings}\n\nBarry\n`,
    html: html(
      [
        `Deliveries to ${escapeHtml(url)} failed ten times in a row, so Dispatchlet switched that webhook off. Turn it back on in settings once the receiver is fixed.`,
        `<a href="${settings}" style="${LINK}">Open settings</a>`,
        'Barry',
      ],
      `Read the ${PRIVACY}.`,
    ),
    headers: {},
  }
}

export const sendWebhookDisabled = internalAction({
  args: { userId: v.id('users'), url: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, url }) => {
    const email = await ctx.runQuery(internal.users.emailFor, { userId })
    if (!email) return null
    await resend('/emails', webhookDisabledMessage(email, url))
    return null
  },
})

export const sendPaused = internalAction({
  args: { userId: v.id('users'), automationId: v.id('automations') },
  returns: v.null(),
  handler: async (ctx, { userId, automationId }) => {
    const email = await ctx.runQuery(internal.users.emailFor, { userId })
    const name = await ctx.runQuery(internal.approvals.automationName, { automationId })
    if (!email) return null
    await resend('/emails', pausedMessage(email, name, automationId))
    return null
  },
})

/** Once per account, when a scheduled run is first skipped for lack of free runs. */
export const sendRunsUsedUp = internalAction({
  args: { userId: v.id('users') },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    if (!(await ctx.runMutation(internal.alerts.claimOnce, { kind: `runs-used-up:${userId}` })))
      return null
    const email = await ctx.runQuery(internal.users.emailFor, { userId })
    if (!email) return null
    await resend('/emails', runsUsedUpMessage(email))
    return null
  },
})

/** To the owner, for things that need a person: the spend cap, mostly. */
export const sendOwnerNote = internalAction({
  args: { subject: v.string(), body: v.string() },
  returns: v.null(),
  handler: async (_ctx, { subject, body }) => {
    const to = process.env.ALERT_EMAIL ?? 'barry@dispatchlet.com'
    await resend('/emails', {
      from: FROM,
      to,
      subject,
      text: `${body}\n`,
      html: html([escapeHtml(body)], 'From Dispatchlet.'),
      headers: {},
    })
    return null
  },
})
