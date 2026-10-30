import { useMutation, useQuery } from 'convex/react'
import { useId, useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { WEBHOOK_EVENTS } from '../../convex/lib/standardWebhooks'
import { errorText, whenIn } from '../lib/format'
import { BusyLabel } from './busy-label'

/**
 * Settings → Automate Dispatchlet (SPEC §44): API tokens, webhooks, inbound hooks and the MCP
 * connection card. Secrets are shown once, in a reveal box with a copy button, and never again.
 */

const SITE = 'https://dispatchlet.com'
const MCP_URL = `${SITE}/mcp`

const EVENT_LABELS: Record<string, string> = {
  'run.finished': 'A run finished',
  'post.created': 'A post reached Buffer',
  'post.approved': 'A draft was approved',
  'post.sent': 'Buffer published a post',
  'automation.paused': 'An automation was paused',
  'buffer.reauth_needed': 'Buffer access ended',
  ping: 'Test pings',
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="app-link"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        })
      }}
    >
      <BusyLabel busy={done} idle={label} working="Copied" />
    </button>
  )
}

/** A secret shown once. The copy button is the point; the text is selectable too. */
function Reveal({
  title,
  secret,
  note,
  children,
}: {
  title: string
  secret: string
  note: string
  children?: React.ReactNode
}) {
  return (
    <div className="app-reveal" role="status">
      <p className="app-reveal-title">{title}</p>
      <p className="app-reveal-secret">
        <code>{secret}</code> <CopyButton text={secret} />
      </p>
      <p className="app-muted">{note}</p>
      {children}
    </div>
  )
}

function useBusy() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>, fallback = 'That did not work.') => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (reason) {
      setError(errorText(reason, fallback))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run, setError }
}

export function Automate({ timezone }: { timezone: string }) {
  const [latestToken, setLatestToken] = useState<string | null>(null)
  return (
    <>
      <div id="api" className="settings-anchor">
        <ApiTokens timezone={timezone} onCreated={setLatestToken} />
      </div>
      <div id="assistant" className="settings-anchor">
        <AssistantConnect token={latestToken} />
      </div>
      <div id="webhooks" className="settings-anchor">
        <Webhooks timezone={timezone} />
      </div>
      <div id="hooks" className="settings-anchor">
        <InboundHooks timezone={timezone} />
      </div>
    </>
  )
}

function ApiTokens({
  timezone,
  onCreated,
}: {
  timezone: string
  onCreated: (token: string) => void
}) {
  const id = useId()
  const tokens = useQuery(api.tokens.list)
  const create = useMutation(api.tokens.create)
  const revoke = useMutation(api.tokens.revoke)
  const [name, setName] = useState('')
  const [scope, setScope] = useState<'read' | 'write'>('write')
  const [made, setMade] = useState<{ token: string; name: string } | null>(null)
  const { busy, error, run } = useBusy()
  const live = (tokens ?? []).filter((t) => !t.revokedAt)
  const revoked = (tokens ?? []).filter((t) => t.revokedAt)
  return (
    <section className="app-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>API tokens</h2>
      <p>
        A token lets a script, a tool or an AI assistant do what you can do here: list automations,
        start runs, read the log, approve drafts. <a href="/docs/api">The API reference</a> has
        every route. A <strong>read</strong> token only reads; <strong>write</strong> can start runs
        and approve posts. Runs started by a token count like any other.
      </p>
      <form
        className="app-field"
        onSubmit={(e) => {
          e.preventDefault()
          void run(async () => {
            const result = await create({ name, scope })
            setMade({ token: result.token, name })
            onCreated(result.token)
            setName('')
          })
        }}
      >
        <input
          className="app-select"
          placeholder="What is it for? e.g. Zapier"
          aria-label="Token name"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className="app-select"
          aria-label="Scope"
          value={scope}
          onChange={(e) => setScope(e.target.value as 'read' | 'write')}
        >
          <option value="write">Read and write</option>
          <option value="read">Read only</option>
        </select>
        <button type="submit" className="app-gate-secondary" disabled={busy || !name.trim()}>
          <BusyLabel busy={busy} idle="Create token" working="Making" />
        </button>
      </form>
      {error ? (
        <p className="app-connection-error" role="alert">
          {error}
        </p>
      ) : null}
      {made ? (
        <Reveal
          title={`Your token for ${made.name}. Copy it now; it is not shown again.`}
          secret={made.token}
          note="Send it as a Bearer token. Revoke it below if it ever leaks."
        >
          <pre
            className="app-snippet"
            tabIndex={0}
          >{`curl ${SITE}/api/v1/me -H "Authorization: Bearer ${made.token}"`}</pre>
        </Reveal>
      ) : null}
      {tokens === undefined ? null : live.length || revoked.length ? (
        <table className="app-table app-tokens">
          <thead>
            <tr>
              <th>Name</th>
              <th>Token</th>
              <th>Scope</th>
              <th>Last used</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[...live, ...revoked].map((t) => (
              <tr key={t._id} data-revoked={Boolean(t.revokedAt)}>
                <td>
                  {t.name}
                  {t.source === 'oauth' ? (
                    <span className="app-muted"> via {t.oauthClientName ?? 'an assistant'}</span>
                  ) : null}
                </td>
                <td className="tabular">
                  <code>{t.prefix}…</code>
                </td>
                <td>{t.scope === 'write' ? 'Read and write' : 'Read'}</td>
                <td className="tabular">
                  {t.revokedAt
                    ? `Revoked ${whenIn(t.revokedAt, timezone)}`
                    : t.lastUsedAt
                      ? whenIn(t.lastUsedAt, timezone)
                      : 'Never'}
                </td>
                <td>
                  {t.revokedAt ? null : (
                    <ConfirmLink
                      label="Revoke"
                      confirm="Revoke now"
                      onConfirm={() => run(() => revoke({ id: t._id }))}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="app-muted">No tokens yet.</p>
      )}
    </section>
  )
}

/** A link that asks once before doing something that cannot be undone. */
function ConfirmLink({
  label,
  confirm,
  onConfirm,
}: {
  label: string
  confirm: string
  onConfirm: () => void
}) {
  const [asking, setAsking] = useState(false)
  if (!asking)
    return (
      <button type="button" className="app-link" onClick={() => setAsking(true)}>
        {label}
      </button>
    )
  return (
    <span className="app-confirm">
      <button
        type="button"
        className="app-link"
        onClick={() => {
          setAsking(false)
          onConfirm()
        }}
      >
        {confirm}
      </button>
      <button type="button" className="app-link" onClick={() => setAsking(false)}>
        Keep
      </button>
    </span>
  )
}

function AssistantConnect({ token }: { token: string | null }) {
  const id = useId()
  const [host, setHost] = useState<
    'claude-ai' | 'claude-code' | 'claude-desktop' | 'cursor' | 'stdio'
  >('claude-ai')
  const bearer = token ?? '<your token>'
  const snippets: Record<typeof host, string> = {
    'claude-ai': MCP_URL,
    'claude-code': `claude mcp add --transport http dispatchlet ${MCP_URL} --header "Authorization: Bearer ${bearer}"`,
    'claude-desktop': JSON.stringify(
      {
        mcpServers: {
          dispatchlet: { url: MCP_URL, headers: { Authorization: `Bearer ${bearer}` } },
        },
      },
      null,
      2,
    ),
    cursor: JSON.stringify(
      {
        mcpServers: {
          dispatchlet: { url: MCP_URL, headers: { Authorization: `Bearer ${bearer}` } },
        },
      },
      null,
      2,
    ),
    stdio: `npx -y mcp-remote ${MCP_URL} --header "Authorization: Bearer ${bearer}"`,
  }
  const where: Record<typeof host, string> = {
    'claude-ai':
      'In claude.ai: Settings → Connectors → Add custom connector, paste this URL, then Allow on the page that opens. No token needed.',
    'claude-code':
      'Run this in a terminal, then ask Claude Code what Dispatchlet posted this week.',
    'claude-desktop': 'Add this to claude_desktop_config.json under Settings → Developer.',
    cursor: 'Add this to .cursor/mcp.json in a project, or to the global MCP settings.',
    stdio: 'For hosts that only run local servers: mcp-remote bridges to the remote one.',
  }
  return (
    <section className="app-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Connect an AI assistant</h2>
      <p>
        Dispatchlet is an MCP server at <code>{MCP_URL}</code>. Connect it to claude.ai, Claude
        Code, Claude Desktop or Cursor and an assistant can list your automations, run research,
        read what a run found and approve drafts, beside Buffer’s own MCP for the queue.{' '}
        <a href="/docs/mcp">What each tool does.</a>
        {token ? '' : ' For the others, create a token above and the snippets fill in.'}
      </p>
      <nav className="app-tabs is-small" aria-label="Host">
        {(
          [
            ['claude-ai', 'claude.ai'],
            ['claude-code', 'Claude Code'],
            ['claude-desktop', 'Claude Desktop'],
            ['cursor', 'Cursor'],
            ['stdio', 'Other'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-current={host === key ? 'page' : undefined}
            onClick={() => setHost(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      <pre className="app-snippet" tabIndex={0}>
        {snippets[host]}
      </pre>
      <p className="app-share">
        <CopyButton text={snippets[host]} label="Copy the snippet" />
        <span className="app-muted">{where[host]}</span>
      </p>
    </section>
  )
}

function Webhooks({ timezone }: { timezone: string }) {
  const id = useId()
  const hooks = useQuery(api.webhooks.list)
  const automations = useQuery(api.automations.list)
  const create = useMutation(api.webhooks.create)
  const remove = useMutation(api.webhooks.remove)
  const setActive = useMutation(api.webhooks.setActive)
  const sendTest = useMutation(api.webhooks.sendTest)
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<string[]>(['post.created', 'post.sent'])
  const [automationId, setAutomationId] = useState('')
  const [made, setMade] = useState<{ url: string; secret: string } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const { busy, error, run } = useBusy()
  const names = new Map((automations ?? []).map((a) => [a._id as string, a.name]))
  return (
    <section className="app-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Webhooks</h2>
      <p>
        Dispatchlet posts a signed JSON event to a URL of yours when something happens: a run
        finishes, a post reaches Buffer, a draft is approved, Buffer publishes a post. Zapier, Make,
        n8n and Slack all take these.{' '}
        <a href="/docs/webhooks">Events and how to verify the signature.</a>
      </p>
      <form
        className="app-webhook-form"
        onSubmit={(e) => {
          e.preventDefault()
          void run(async () => {
            const result = await create({
              url: url.trim(),
              events: events as (typeof WEBHOOK_EVENTS)[number][],
              automationId: automationId ? (automationId as Id<'automations'>) : undefined,
            })
            setMade({ url: result.webhook.url, secret: result.secret })
            setUrl('')
          })
        }}
      >
        <div className="app-field">
          <input
            className="app-select app-key"
            type="url"
            placeholder="https://hooks.zapier.com/hooks/catch/…"
            aria-label="Webhook URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <select
            className="app-select"
            aria-label="Which automation"
            value={automationId}
            onChange={(e) => setAutomationId(e.target.value)}
          >
            <option value="">Every automation</option>
            {(automations ?? []).map((a) => (
              <option key={a._id} value={a._id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <ul className="app-choices app-choices-compact">
          {WEBHOOK_EVENTS.map((ev) => (
            <li key={ev} data-checked={events.includes(ev)}>
              <label>
                <input
                  type="checkbox"
                  checked={events.includes(ev)}
                  onChange={(e) =>
                    setEvents(e.target.checked ? [...events, ev] : events.filter((x) => x !== ev))
                  }
                />
                <span>{EVENT_LABELS[ev]}</span>
                <span className="app-muted tabular">{ev}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="app-field">
          <button
            type="submit"
            className="app-gate-secondary"
            disabled={busy || !url.trim() || !events.length}
          >
            <BusyLabel busy={busy} idle="Add webhook" working="Adding" />
          </button>
          {error ? (
            <span className="app-connection-error" role="alert">
              {error}
            </span>
          ) : null}
        </div>
      </form>
      {made ? (
        <Reveal
          title={`The signing secret for ${made.url}. Copy it now; it is not shown again.`}
          secret={made.secret}
          note="Verify each delivery with it (webhook-id, webhook-timestamp and webhook-signature headers, Standard Webhooks format)."
        />
      ) : null}
      {note ? <p className="app-muted">{note}</p> : null}
      {hooks === undefined ? null : hooks.length ? (
        <ul className="app-hooks">
          {hooks.map((w) => (
            <li key={w._id} data-active={w.active}>
              <p className="app-hooks-url">
                <code>{w.url}</code>
                {w.automationId ? (
                  <span className="app-muted">
                    {' '}
                    only {names.get(w.automationId) ?? 'one automation'}
                  </span>
                ) : null}
              </p>
              <p className="app-events">{w.events.join(', ')}</p>
              <p className="app-muted">
                {!w.active
                  ? 'Off.'
                  : w.lastDeliveryAt
                    ? `Last delivery ${w.lastStatus === 'ok' ? 'arrived' : 'failed'} ${whenIn(w.lastDeliveryAt, timezone)}.`
                    : 'Nothing sent yet.'}
                {w.failedInARow ? ` ${w.failedInARow} failed in a row.` : ''}
              </p>
              <p className="app-share">
                <button
                  type="button"
                  className="app-link"
                  onClick={() =>
                    void run(async () => {
                      await sendTest({ id: w._id })
                      setNote('A ping is on its way. Deliveries below say how it went.')
                    })
                  }
                >
                  Send a test
                </button>
                <button
                  type="button"
                  className="app-link"
                  onClick={() => void run(() => setActive({ id: w._id, active: !w.active }))}
                >
                  <BusyLabel busy={w.active} idle="Turn on" working="Turn off" />
                </button>
                <ConfirmLink
                  label="Delete"
                  confirm="Delete the webhook"
                  onConfirm={() => void run(() => remove({ id: w._id }))}
                />
              </p>
              <Deliveries webhookId={w._id} timezone={timezone} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="app-muted">No webhooks yet.</p>
      )}
    </section>
  )
}

function Deliveries({ webhookId, timezone }: { webhookId: Id<'webhooks'>; timezone: string }) {
  const [open, setOpen] = useState(false)
  return (
    <details
      className="app-deliveries"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>Recent deliveries</summary>
      {open ? <DeliveryRows webhookId={webhookId} timezone={timezone} /> : null}
    </details>
  )
}

function DeliveryRows({ webhookId, timezone }: { webhookId: Id<'webhooks'>; timezone: string }) {
  const rows = useQuery(api.webhooks.deliveries, { id: webhookId })
  const retry = useMutation(api.webhooks.retry)
  if (!rows) return null
  if (!rows.length) return <p className="app-muted">None yet.</p>
  return (
    <table className="app-table">
      <thead>
        <tr>
          <th>Event</th>
          <th>When</th>
          <th>Result</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => (
          <tr key={d._id} data-status={d.status}>
            <td className="tabular">{d.event}</td>
            <td className="tabular">{whenIn(d.createdAt, timezone)}</td>
            <td>
              {d.status === 'ok'
                ? `Arrived (${d.responseStatus})`
                : d.status === 'pending'
                  ? d.attempt
                    ? `Failed, trying again ${d.nextAttemptAt ? whenIn(d.nextAttemptAt, timezone) : 'soon'}`
                    : 'Sending'
                  : `Failed after ${d.attempt} ${d.attempt === 1 ? 'try' : 'tries'}${d.error ? `: ${d.error}` : ''}`}
            </td>
            <td>
              {d.status === 'failed' ? (
                <button
                  type="button"
                  className="app-link"
                  onClick={() => void retry({ deliveryId: d._id })}
                >
                  Retry
                </button>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function InboundHooks({ timezone }: { timezone: string }) {
  const id = useId()
  const hooks = useQuery(api.hooks.list)
  const automations = useQuery(api.automations.list)
  const create = useMutation(api.hooks.create)
  const remove = useMutation(api.hooks.remove)
  const [automationId, setAutomationId] = useState('')
  const [name, setName] = useState('')
  const [made, setMade] = useState<{ url: string; name: string } | null>(null)
  const { busy, error, run } = useBusy()
  const names = new Map((automations ?? []).map((a) => [a._id as string, a.name]))
  const chosen = automationId || (automations?.[0]?._id ?? '')
  return (
    <section className="app-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Inbound hooks</h2>
      <p>
        A hook URL starts a run of one automation when anything POSTs to it: a cron, a Zap, a GitHub
        release. Send a title and a link and the run covers that story first.{' '}
        <a href="/docs/hooks">The body it takes, and the GitHub recipe.</a>
      </p>
      <form
        className="app-field"
        onSubmit={(e) => {
          e.preventDefault()
          void run(async () => {
            const result = await create({ automationId: chosen as Id<'automations'>, name })
            setMade({ url: `${SITE}/api/v1/hooks/${result.token}`, name })
            setName('')
          })
        }}
      >
        <select
          className="app-select"
          aria-label="Automation"
          value={chosen}
          onChange={(e) => setAutomationId(e.target.value)}
        >
          {(automations ?? []).map((a) => (
            <option key={a._id} value={a._id}>
              {a.name}
            </option>
          ))}
        </select>
        <input
          className="app-select"
          placeholder="Name, e.g. GitHub releases"
          aria-label="Hook name"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="submit"
          className="app-gate-secondary"
          disabled={busy || !name.trim() || !chosen}
        >
          <BusyLabel busy={busy} idle="Create hook URL" working="Making" />
        </button>
        {error ? (
          <span className="app-connection-error" role="alert">
            {error}
          </span>
        ) : null}
      </form>
      {made ? (
        <Reveal
          title={`The URL for ${made.name}. Copy it now; it is not shown again.`}
          secret={made.url}
          note={
            'POST to it with an empty body to run now, or with {"title","url"} to cover a story. Anyone with the URL can start runs, so treat it like a password.'
          }
        />
      ) : null}
      {hooks === undefined ? null : hooks.length ? (
        <table className="app-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Automation</th>
              <th>URL</th>
              <th>Used</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {hooks.map((h) => (
              <tr key={h._id}>
                <td>{h.name}</td>
                <td>{names.get(h.automationId) ?? 'Deleted'}</td>
                <td className="tabular">
                  <code>…/hooks/{h.prefix}…</code>
                </td>
                <td className="tabular">
                  {h.uses
                    ? `${h.uses} ${h.uses === 1 ? 'time' : 'times'}, last ${whenIn(h.lastUsedAt!, timezone)}`
                    : 'Never'}
                </td>
                <td>
                  <ConfirmLink
                    label="Delete"
                    confirm="Delete it"
                    onConfirm={() => void run(() => remove({ id: h._id }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="app-muted">No hooks yet.</p>
      )}
    </section>
  )
}
