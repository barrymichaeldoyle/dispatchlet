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

function html(paragraphs: string[], unsubscribe: string): string {
  const body = paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font:15px/1.55 system-ui,sans-serif;color:#1a1a1a">${p}</p>`,
    )
    .join('')
  return `<div style="max-width:560px;padding:24px">${body}<p style="margin:24px 0 0;font:13px/1.5 system-ui,sans-serif;color:#6a6a66"><a href="${unsubscribe}" style="color:#6a6a66">Unsubscribe</a> or read the <a href="https://dispatchlet.com/privacy" style="color:#6a6a66">privacy policy</a>.</p></div>`
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
      l.unsubscribe,
    ),
    headers: { 'List-Unsubscribe': `<${l.unsubscribe}>` },
  }
}

function launchMessage(email: string, token: string): Message {
  const l = links(token)
  return {
    from: FROM,
    to: email,
    subject: 'Dispatchlet is open',
    text: `You can connect your Buffer account now at https://dispatchlet.com. The first 10 runs are on me. If you try it, reply and tell me what broke.\n\nUnsubscribe: ${l.unsubscribe}\nPrivacy policy: https://dispatchlet.com/privacy\n`,
    html: html(
      [
        'You can connect your Buffer account now at <a href="https://dispatchlet.com" style="color:#0f6e56">dispatchlet.com</a>. The first 10 runs are on me. If you try it, reply and tell me what broke.',
      ],
      l.unsubscribe,
    ),
    headers: { 'List-Unsubscribe': `<${l.unsubscribe}>` },
  }
}

async function resend(path: string, body: unknown): Promise<void> {
  const key = process.env.RESEND_API_KEY
  if (!key) {
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
}

export const sendConfirm = internalAction({
  args: { email: v.string(), token: v.string() },
  returns: v.null(),
  handler: async (_ctx, { email, token }) => {
    await resend('/emails', confirmMessage(email, token))
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
      await resend(
        '/emails/batch',
        batch.map((r) => launchMessage(r.email, r.token)),
      )
      await ctx.runMutation(internal.waitlist.markLaunchSent, { ids: batch.map((r) => r._id) })
      sent += batch.length
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    return sent
  },
})
