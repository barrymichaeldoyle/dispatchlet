import { createFileRoute } from '@tanstack/react-router'
import { WEBHOOK_EVENT_DOCS } from '../../convex/api/reference'
import { LegalPage, legalHead } from '../components/legal-page'

export const Route = createFileRoute('/docs_/webhooks')({
  component: WebhookDocs,
  head: () =>
    legalHead(
      'Dispatchlet webhooks',
      'Signed events when runs finish, posts reach Buffer, drafts are approved and posts go out.',
      '/docs/webhooks',
    ),
})

function WebhookDocs() {
  return (
    <LegalPage title="Webhooks" updated="29 Oct 2026">
      <p>
        A webhook is a URL of yours that Dispatchlet POSTs to when something happens. Buffer has no
        webhooks of its own, so this is also the simplest way to know when a Buffer post went out.
        Add one under Settings → Webhooks, or with <code>POST /api/v1/webhooks</code>. Pick the
        events, and optionally one automation; the signing secret is shown once.
      </p>

      <h2>Events</h2>
      <ul>
        {Object.entries(WEBHOOK_EVENT_DOCS).map(([name, doc]) => (
          <li key={name}>
            <code>{name}</code>: {doc}
          </li>
        ))}
      </ul>

      <h2>The delivery</h2>
      <p>
        One JSON body per event, with the same shapes the API returns (a run as{' '}
        <code>GET /runs/:id</code> gives it, a post as <code>GET /posts/:id</code> gives it):
      </p>
      <pre tabIndex={0}>{`POST https://your.example/hook
Content-Type: application/json
User-Agent: Dispatchlet-Webhooks/1
webhook-id: <delivery id>
webhook-timestamp: 1761740000
webhook-signature: v1,<base64 HMAC>

{
  "id": "<delivery id>",
  "type": "post.sent",
  "createdAt": 1761740000123,
  "data": {
    "post": { "_id": "…", "text": "…", "status": "sent", "externalLink": "https://x.com/…", … },
    "automation": { "id": "…", "name": "F1 news" }
  }
}`}</pre>
      <p>
        Answer with any 2xx within ten seconds. Anything else is retried after 1 minute, 10 minutes
        and 1 hour, then marked failed. Ten failed deliveries in a row switch the webhook off and
        you get an email. Settings lists the last 50 deliveries of each webhook, with a Retry
        button.
      </p>

      <h2>Verifying the signature</h2>
      <p>
        Deliveries follow the <a href="https://www.standardwebhooks.com/">Standard Webhooks</a>{' '}
        format, so any of its libraries verify them, and Zapier, Make and n8n have built-ins. By
        hand: HMAC-SHA256 the string <code>{'`${webhook-id}.${webhook-timestamp}.${body}`'}</code>{' '}
        with the secret’s bytes (base64-decode what follows <code>whsec_</code>), base64 the result,
        and compare with the part after <code>v1,</code>. Refuse timestamps more than five minutes
        old.
      </p>
      <pre tabIndex={0}>{`import { createHmac, timingSafeEqual } from 'node:crypto'

export function verify(secret, headers, rawBody) {
  const id = headers['webhook-id']
  const ts = headers['webhook-timestamp']
  const given = (headers['webhook-signature'] ?? '').split(' ')
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = 'v1,' + createHmac('sha256', key).update(\`\${id}.\${ts}.\${rawBody}\`).digest('base64')
  return given.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)))
}`}</pre>
      <p>Use the raw request body, not a re-serialised copy, or the signature will not match.</p>

      <h2>Recipes</h2>
      <p>
        <strong>Slack:</strong> a Zapier Zap with “Webhooks by Zapier → Catch Hook” as the trigger
        and “Slack → Send Channel Message” as the action; use <code>data.post.text</code> and{' '}
        <code>data.post.externalLink</code>. <strong>n8n:</strong> a Webhook node, then whatever you
        like; the body is already JSON. <strong>A spreadsheet of what went out:</strong> subscribe
        to <code>post.sent</code> only and append a row per delivery.
      </p>
      <p>Webhook URLs must be https and public. Deliveries never contain tokens or keys.</p>
    </LegalPage>
  )
}
