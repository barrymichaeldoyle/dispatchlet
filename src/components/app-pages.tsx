import { useAuthActions } from '@convex-dev/auth/react'
import { Link } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import { useEffect, useId, useMemo, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { describeCadence } from '../../convex/lib/schedule'
import { BufferMark, ChannelMark } from './brand-icons'
import { PostText } from './post-text'
import {
  currentSubscription,
  needsInstallForPush,
  pushState,
  subscribeToPush,
  unsubscribeFromPush,
} from '../lib/push'
import { Automate } from './app-api'
import { StepArt } from './step-art'
import { bufferChannelUrl, errorText as message, whenIn } from '../lib/format'
import { BusyLabel } from './busy-label'

export function SignOut() {
  const { signOut } = useAuthActions()
  const [pending, setPending] = useState(false)
  return (
    <button
      type="button"
      className="app-gate-secondary"
      disabled={pending}
      onClick={() => {
        setPending(true)
        void signOut().catch(() => setPending(false))
      }}
    >
      <BusyLabel busy={pending} idle="Sign out" working="Signing out" />
    </button>
  )
}

/** Signs in with Buffer again from inside the app, which replaces the stored grant. */
function useReconnect() {
  const { signIn } = useAuthActions()
  const [pending, setPending] = useState(false)
  const reconnect = () => {
    setPending(true)
    void signIn('buffer', { redirectTo: window.location.pathname }).catch(() => setPending(false))
  }
  return { pending, reconnect }
}

/** Shown on every app page while Dispatchlet cannot reach the person's Buffer account. */
export function ConnectionBanner() {
  const connection = useQuery(api.buffer.myConnection)
  const { pending, reconnect } = useReconnect()
  if (connection === undefined) return null
  if (connection && !connection.needsReauth) return null
  return (
    <section className="app-banner" role="status">
      <p>
        {connection
          ? 'Dispatchlet lost access to your Buffer account. Reconnect it to keep posting.'
          : 'Buffer isn’t connected. Connect it so Dispatchlet can post for you.'}
      </p>
      <button type="button" className="app-gate-primary" disabled={pending} onClick={reconnect}>
        <BufferMark size={16} />
        <BusyLabel
          busy={pending}
          idle={connection ? 'Reconnect Buffer' : 'Connect Buffer'}
          working="Opening Buffer"
        />
      </button>
    </section>
  )
}

const STATUS_WORDS: Record<string, string> = {
  generating: 'writing the playbook',
  ready: 'not enabled yet',
  active: 'enabled',
  paused: 'paused',
  failed: 'paused after failures',
}

const RUN_KINDS: Record<string, string> = { scheduled: 'Scheduled run', now: 'Run', dry: 'Dry run' }

type Dashboard = NonNullable<
  NonNullable<ReturnType<typeof useQuery<typeof api.automations.dashboard>>>
>

/** The home page: numbers first, then what needs a yes, then each automation as a row. */
export function AppHome() {
  const viewer = useQuery(api.users.viewer)
  const data = useQuery(api.automations.dashboard)
  if (!viewer || data === undefined) return null
  const firstName = viewer.name?.trim().split(/\s+/)[0]
  // `?preview-empty` shows the first-visit screen on an account that has automations, for design work.
  const previewEmpty = new URLSearchParams(window.location.search).has('preview-empty')
  if (!data || !data.automations.length || previewEmpty)
    return <EmptyHome firstName={firstName} viewer={viewer} />
  const { automations, drafts, timezone } = data
  return (
    <>
      <div className="app-home-head">
        <h1>{firstName ? `Welcome back, ${firstName}.` : 'Welcome back.'}</h1>
        <Link to="/app/new" className="app-gate-primary">
          New automation
        </Link>
      </div>
      <dl className="app-stats">
        <div>
          <dt>Posts this week</dt>
          <dd className="tabular">{data.postsThisWeek}</dd>
        </div>
        <div data-attention={drafts.length > 0}>
          <dt>Waiting for a yes</dt>
          <dd className="tabular">{drafts.length}</dd>
        </div>
        <div>
          <dt>Next run</dt>
          <dd className="tabular" data-text={!data.nextRunAt}>
            {data.nextRunAt ? whenIn(data.nextRunAt, timezone) : 'None yet'}
          </dd>
        </div>
        <div>
          <dt>{viewer.ownKey ? 'Runs' : 'Free runs left'}</dt>
          <dd className="tabular" data-text={viewer.ownKey}>
            {viewer.ownKey ? 'On your key' : viewer.runsLeft}
          </dd>
        </div>
      </dl>
      {drafts.length ? (
        <section className="app-section">
          <h2>Waiting for a yes</h2>
          <ul className="app-drafts">
            {drafts.slice(0, 6).map((d) => (
              <DraftCard key={d._id} draft={d} />
            ))}
          </ul>
        </section>
      ) : null}
      <section className="app-section">
        <h2>Automations</h2>
        <ul className="app-rows">
          {automations.map((a) => (
            <AutomationRow key={a._id} a={a} timezone={timezone} />
          ))}
        </ul>
      </section>
    </>
  )
}

/** A draft as it will look on its channel, with Approve right there. */
function DraftCard({ draft }: { draft: Dashboard['drafts'][number] }) {
  const approve = useAction(api.runs.approve)
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'failed'>('idle')
  const [note, setNote] = useState('')
  return (
    <li className="app-draft">
      <p className="app-draft-head">
        <span className="app-draft-avatar" aria-hidden="true">
          <ChannelMark channel={SERVICE_NAMES[draft.service] ?? draft.service} size={14} />
        </span>
        <strong>{draft.channelName}</strong>
        <span className="app-muted">draft</span>
      </p>
      <PostText text={draft.text} />
      <div className="app-gate-actions">
        {state === 'done' ? (
          <span className="app-draft-done">{note}</span>
        ) : (
          <button
            type="button"
            className="app-gate-primary"
            disabled={state === 'working'}
            onClick={() => {
              setState('working')
              approve({ postId: draft._id })
                .then((message) => {
                  setState('done')
                  setNote(message)
                })
                .catch((reason: unknown) => {
                  setState('failed')
                  setNote(message(reason, 'Not approved.'))
                })
            }}
          >
            <BusyLabel busy={state === 'working'} idle="Approve" working="Approving" />
          </button>
        )}
        <a
          href={bufferChannelUrl(draft.channelId, 'draft')}
          target="_blank"
          rel="noreferrer"
          className="app-gate-secondary app-buffer-link"
        >
          <BufferMark size={14} />
          Open in Buffer
        </a>
        <Link
          to="/app/a/$id/runs/$runId"
          params={{ id: draft.automationId, runId: draft.runId }}
          className="app-link"
        >
          See the run
        </Link>
        {state === 'failed' ? <span className="app-connection-error">{note}</span> : null}
      </div>
    </li>
  )
}

const DAY = 86_400_000

/** The last seven days as cells: posts as a count in pine, a run with no post as a dot, today outlined. */
function WeekStrip({
  postTimes,
  runTimes,
  timezone,
}: {
  postTimes: number[]
  runTimes: number[]
  timezone: string
}) {
  const [now] = useState(() => Date.now())
  const dayKey = (at: number) =>
    new Date(at).toLocaleDateString('en-GB', { timeZone: timezone, day: 'numeric', month: 'short' })
  const days = Array.from({ length: 7 }, (_, i) => {
    const at = now - (6 - i) * DAY
    const key = dayKey(at)
    return {
      key,
      label: new Date(at).toLocaleDateString('en-GB', { timeZone: timezone, weekday: 'narrow' }),
      posts: postTimes.filter((t) => dayKey(t) === key).length,
      ran: runTimes.some((t) => dayKey(t) === key),
      today: i === 6,
    }
  })
  return (
    <ol className="app-week" aria-label="Posts in the last seven days">
      {days.map((d) => (
        <li
          key={d.key}
          data-today={d.today}
          data-posts={d.posts > 0}
          data-ran={d.ran}
          title={`${d.key}: ${d.posts} ${d.posts === 1 ? 'post' : 'posts'}`}
        >
          <span className="app-week-day" aria-hidden="true">
            {d.label}
          </span>
          <span className="app-week-count tabular">{d.posts > 0 ? d.posts : d.ran ? '·' : ''}</span>
        </li>
      ))}
    </ol>
  )
}

function AutomationRow({ a, timezone }: { a: Dashboard['automations'][number]; timezone: string }) {
  return (
    <li className="app-row" data-status={a.status}>
      <div className="app-row-name">
        <Link to="/app/a/$id" params={{ id: a._id }}>
          {a.name}
        </Link>
        <span className="app-muted">{describeCadence(a.cadence)}</span>
      </div>
      <div className="app-row-last">
        {a.lastRun ? (
          <>
            <Link to="/app/a/$id/runs/$runId" params={{ id: a._id, runId: a.lastRun._id }}>
              {RUN_KINDS[a.lastRun.kind] ?? 'Run'} {whenIn(a.lastRun.startedAt, a.timezone)}
            </Link>
            <span>{a.lastRun.finished ? a.lastRun.note : 'Running.'}</span>
          </>
        ) : (
          <span className="app-muted">No runs yet. Try a dry run.</span>
        )}
      </div>
      <WeekStrip postTimes={a.postTimes} runTimes={a.runTimes} timezone={timezone} />
      <div className="app-row-next">
        {a.status === 'active' && a.nextRunAt ? (
          <>
            <span className="app-muted">Next run</span>
            <strong className="tabular">{whenIn(a.nextRunAt, a.timezone)}</strong>
          </>
        ) : (
          <>
            <span className="app-muted">Status</span>
            <strong>{STATUS_WORDS[a.status] ?? a.status}</strong>
          </>
        )}
      </div>
    </li>
  )
}

type Viewer = NonNullable<ReturnType<typeof useQuery<typeof api.users.viewer>>>

/** The first visit: what happens next, as three drawings and one button, not a wall of text. */
function EmptyHome({ firstName, viewer }: { firstName: string | undefined; viewer: Viewer }) {
  return (
    <div className="app-empty">
      <h1>{firstName ? `Welcome, ${firstName}.` : 'Welcome.'}</h1>
      <p className="app-empty-lead">Your first automation takes about three minutes.</p>
      <ol className="app-empty-steps">
        <li>
          <StepArt kind="brief" />
          <h2>Answer seven questions</h2>
          <p>What to research, where to post, when.</p>
        </li>
        <li>
          <StepArt kind="playbook" />
          <h2>Get a playbook</h2>
          <p>Written from your sources. Edit anything.</p>
        </li>
        <li>
          <StepArt kind="repeat" />
          <h2>Dry run, then enable</h2>
          <p>See what it would post before it posts.</p>
        </li>
      </ol>
      <div className="app-gate-actions">
        <Link to="/app/new" className="app-gate-primary">
          Create your first automation
        </Link>
      </div>
      {!viewer.ownKey ? (
        <p className="app-muted app-empty-note">
          {viewer.runsLeft} free runs and {viewer.dryRunsLeft} dry runs are on the house.
        </p>
      ) : null}
    </div>
  )
}

const SETTINGS_SECTIONS = [
  ['account', 'Account'],
  ['buffer', 'Buffer'],
  ['usage', 'Usage'],
  ['notifications', 'Notifications'],
  ['anthropic', 'Anthropic key'],
  ['timezone', 'Time zone'],
  ['api', 'API tokens'],
  ['assistant', 'AI assistants'],
  ['webhooks', 'Webhooks'],
  ['hooks', 'Inbound hooks'],
  ['delete', 'Delete account'],
] as const

/** Which settings section is at the top of the screen, for the index beside them. */
function useCurrentSection(ids: readonly string[]): string {
  const [current, setCurrent] = useState<string>(ids[0] ?? '')
  useEffect(() => {
    const seen = new Map<string, boolean>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting)
        const first = ids.find((id) => seen.get(id))
        if (first) setCurrent(first)
      },
      { rootMargin: '0px 0px -70% 0px' },
    )
    for (const id of ids) {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [ids])
  return current
}

/**
 * A link such as /app/settings#webhooks arrives before the sections exist (they appear once
 * sign-in finishes), so the browser's own jump finds nothing. Scroll once they are there, and
 * hold the section in place while rows above it load, until the person scrolls themselves.
 */
function useScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (!id) return
    let timer = 0
    let stopped = false
    const started = performance.now()
    // Every 100ms, for a few seconds: if the section is not at the top, put it there. This
    // outlasts the router's own scroll reset and rows loading above the section.
    const tick = () => {
      if (stopped) return
      const target = document.getElementById(id)
      const page = document.scrollingElement ?? document.documentElement
      const atBottom = window.scrollY + window.innerHeight >= page.scrollHeight - 1
      const offset = target ? target.getBoundingClientRect().top : 0
      // A section near the end cannot reach the top; at the bottom of the page it is as close as it gets.
      if (target && Math.abs(offset) > 30 && !(atBottom && offset > 0))
        // Instant: arriving at a link should land, not animate, and the site's smooth scrolling
        // does not run at all in a background tab.
        target.scrollIntoView({ block: 'start', behavior: 'instant' })
      if (performance.now() - started < 8000) timer = window.setTimeout(tick, 100)
    }
    const stop = () => {
      stopped = true
      window.clearTimeout(timer)
      for (const e of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const)
        window.removeEventListener(e, stop)
    }
    for (const e of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const)
      window.addEventListener(e, stop, { passive: true })
    tick()
    return stop
  }, [])
}

function SettingsIndex() {
  useScrollToHash()
  const ids = useMemo(() => SETTINGS_SECTIONS.map(([id]) => id), [])
  const current = useCurrentSection(ids)
  return (
    <nav className="settings-index" aria-label="Settings sections">
      <ol>
        {SETTINGS_SECTIONS.map(([id, label]) => (
          <li key={id}>
            <a href={`#${id}`} aria-current={current === id ? 'true' : undefined}>
              {label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}

/** A named stop in settings, for the index and for links into it (such as #api). */
function Anchor({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div id={id} className="settings-anchor">
      {children}
    </div>
  )
}

export function AppSettings() {
  const viewer = useQuery(api.users.viewer)
  if (!viewer) return null
  return (
    <>
      <h1>Settings.</h1>
      <div className="settings-layout">
        <SettingsIndex />
        <div className="settings-main">
          <Anchor id="account">
            <section className="app-section app-settings-account" aria-labelledby="account-title">
              <h2 id="account-title">Account</h2>
              <p>
                {viewer.name ?? 'Your Buffer account'}
                {viewer.email ? (
                  <>
                    <br />
                    <span className="app-muted">{viewer.email}</span>
                  </>
                ) : null}
              </p>
              <p className="app-muted">Your name and email come from Buffer.</p>
              <SignOut />
            </section>
          </Anchor>
          <Anchor id="buffer">
            <BufferConnection />
          </Anchor>
          <Anchor id="usage">
            <Usage />
            <OwnerTotals />
          </Anchor>
          <Anchor id="notifications">
            <EmailPrefs />
          </Anchor>
          <Anchor id="anthropic">
            <AnthropicKey
              ownKey={viewer.ownKey}
              invalid={viewer.keyInvalid}
              runsLeft={viewer.runsLeft}
              dryRunsLeft={viewer.dryRunsLeft}
            />
          </Anchor>
          <Anchor id="timezone">
            <TimezoneSetting value={viewer.timezone} />
          </Anchor>
          <Automate timezone={viewer.timezone ?? 'UTC'} />
          <Anchor id="delete">
            <DeleteAccount />
          </Anchor>
        </div>
      </div>
    </>
  )
}

const SERVICE_NAMES: Record<string, string> = {
  twitter: 'X',
  linkedin: 'LinkedIn',
  threads: 'Threads',
  bluesky: 'Bluesky',
  mastodon: 'Mastodon',
}

const WINDOW_NAMES: Record<string, string> = {
  '15min': '15 minutes',
  '1day': 'day',
  '30days': '30 days',
}

/** The connected Buffer account: channels, sync, disconnect, and the API calls left. */
function BufferConnection() {
  const connection = useQuery(api.buffer.myConnection)
  const sync = useAction(api.buffer.syncChannels)
  const disconnect = useAction(api.buffer.disconnect)
  const [syncing, setSyncing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (connection === undefined) return null
  const canPost = connection?.scope.includes('posts:write') ?? false
  const status = !connection
    ? 'Not connected.'
    : connection.needsReauth
      ? 'Buffer stopped accepting Dispatchlet’s access. Reconnect it above.'
      : !canPost
        ? 'Connected without posting access. Reconnect to grant it.'
        : connection.canRefresh
          ? 'Connected with posting access. The access renews itself.'
          : 'Connected with posting access, but Buffer did not issue a refresh token, so it lasts about an hour.'
  const budget = connection?.budget
  return (
    <section className="app-section app-connection" aria-labelledby="connection-title">
      <h2 id="connection-title">Buffer</h2>
      <p>{status}</p>
      {connection && connection.channels.length > 0 ? (
        <ul>
          {connection.channels.map((channel) => (
            <li key={channel.channelId} data-usable={channel.usable}>
              <ChannelMark channel={SERVICE_NAMES[channel.service] ?? channel.service} size={14} />
              <span>{channel.name}</span>
              {channel.usable ? null : (
                <span className="app-connection-note">Needs attention in Buffer</span>
              )}
            </li>
          ))}
        </ul>
      ) : connection ? (
        <p className="app-muted">No channels synced yet.</p>
      ) : null}
      {connection ? (
        <div className="app-gate-actions">
          {connection.needsReauth ? null : (
            <button
              type="button"
              className="app-gate-secondary"
              disabled={syncing}
              onClick={() => {
                setSyncing(true)
                setError(null)
                sync()
                  .catch((reason: unknown) => setError(message(reason, 'Sync failed.')))
                  .finally(() => setSyncing(false))
              }}
            >
              <BusyLabel busy={syncing} idle="Sync channels" working="Syncing channels" />
            </button>
          )}
          <button
            type="button"
            className="app-gate-secondary"
            disabled={disconnecting}
            onClick={() => {
              setDisconnecting(true)
              setError(null)
              disconnect()
                .catch((reason: unknown) => setError(message(reason, 'Disconnect failed.')))
                .finally(() => setDisconnecting(false))
            }}
          >
            <BusyLabel busy={disconnecting} idle="Disconnect Buffer" working="Disconnecting" />
          </button>
        </div>
      ) : null}
      {budget && budget.length > 0 ? (
        <p className="app-muted app-budget">
          Buffer API calls left:{' '}
          {budget
            .map(
              (window) =>
                `${Math.max(window.remaining, 0)} of ${window.limit} per ${WINDOW_NAMES[window.name] ?? window.name}`,
            )
            .join(', ')}
          .
        </p>
      ) : null}
      {error ? (
        <p className="app-connection-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

/** This month in numbers: runs, what the AI cost, posts by channel. */
function Usage() {
  const usage = useQuery(api.users.usage)
  if (!usage) return null
  return (
    <section className="app-section" aria-labelledby="usage-title">
      <h2 id="usage-title">Usage in {usage.month}</h2>
      <table className="app-table app-usage">
        <tbody>
          <tr>
            <th>Runs</th>
            <td className="tabular">{usage.runs}</td>
          </tr>
          <tr>
            <th>Dry runs</th>
            <td className="tabular">{usage.dryRuns}</td>
          </tr>
          <tr>
            <th>AI cost</th>
            <td className="tabular">
              {usage.costUsd < 0.01 && usage.costUsd > 0
                ? 'under $0.01'
                : `$${usage.costUsd.toFixed(2)}`}
            </td>
          </tr>
          {usage.posts.map((p) => (
            <tr key={p.channel}>
              <th>Posts on {p.channel}</th>
              <td className="tabular">{p.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="app-muted">
        {usage.ownKey
          ? 'The AI cost is billed to your own Anthropic key.'
          : `On Dispatchlet’s key: ${usage.runsLeft} free ${usage.runsLeft === 1 ? 'run' : 'runs'} and ${usage.dryRunsLeft} dry ${usage.dryRunsLeft === 1 ? 'run' : 'runs'} left.`}
      </p>
    </section>
  )
}

/** Only the owner sees this: this month across every account. */
function OwnerTotals() {
  const t = useQuery(api.users.ownerTotals)
  if (!t) return null
  return (
    <section className="app-section" aria-labelledby="owner-title">
      <h2 id="owner-title">Every account, this month</h2>
      <table className="app-table app-usage">
        <tbody>
          <tr>
            <th>Accounts</th>
            <td className="tabular">
              {t.accounts}
              {t.withKey ? ` (${t.withKey} with their own key)` : ''}
            </td>
          </tr>
          <tr>
            <th>Automations</th>
            <td className="tabular">
              {t.automations}
              {t.active ? ` (${t.active} enabled)` : ''}
            </td>
          </tr>
          <tr>
            <th>Runs</th>
            <td className="tabular">
              {t.runs}
              {t.failed ? ` (${t.failed} failed)` : ''}
            </td>
          </tr>
          <tr>
            <th>AI cost</th>
            <td className="tabular">${t.costUsd.toFixed(2)}</td>
          </tr>
          <tr>
            <th>Cost per finished run</th>
            <td className="tabular">${t.costPerRunUsd.toFixed(3)}</td>
          </tr>
          <tr>
            <th>Posts in Buffer</th>
            <td className="tabular">
              {t.posts}
              {t.sent ? ` (${t.sent} sent)` : ''}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="app-muted">Only you see this. It is what pricing will be worked out from.</p>
    </section>
  )
}

const PREFS: [string, string, string][] = [
  [
    'every',
    'After every run that creates posts',
    'What was posted or saved, with approve links for drafts.',
  ],
  ['drafts', 'Only when drafts are waiting', 'Nothing for runs that went straight into the queue.'],
  [
    'problems',
    'Only when something goes wrong',
    'A failed run, a paused automation, lost Buffer access.',
  ],
  ['never', 'Never', 'You check the run log yourself.'],
]

function EmailPrefs() {
  const usage = useQuery(api.users.usage)
  const save = useMutation(api.users.setEmailPrefs)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  if (!usage) return null
  const run = (change: Parameters<typeof save>[0]) => {
    setState('saving')
    save(change)
      .then(() => setState('saved'))
      .catch(() => setState('failed'))
  }
  return (
    <section className="app-section" aria-labelledby="notify-title">
      <h2 id="notify-title">Notifications</h2>
      <p className="app-muted">When to be told.</p>
      <ul className="app-choices">
        {PREFS.map(([value, title, detail]) => (
          <li key={value} data-checked={usage.emailPrefs === value}>
            <label>
              <input
                type="radio"
                name="emailPrefs"
                checked={usage.emailPrefs === value}
                onChange={() => run({ prefs: value })}
              />
              <span>{title}</span>
              <span className="app-muted">{detail}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="app-muted">How.</p>
      <ul className="app-choices">
        <li data-checked={usage.emailEnabled}>
          <label>
            <input
              type="checkbox"
              checked={usage.emailEnabled}
              onChange={(e) => run({ emailEnabled: e.target.checked })}
            />
            <span>Email</span>
            <span className="app-muted">With approve links for drafts.</span>
          </label>
        </li>
        <PushChoice />
      </ul>
      <p className="app-muted" role="status">
        {state === 'saving'
          ? 'Saving'
          : state === 'saved'
            ? 'Saved'
            : state === 'failed'
              ? 'Not saved. Try again.'
              : ''}
      </p>
    </section>
  )
}

/** Push on this device: a checkbox that asks the browser, then hands the subscription to Convex. */
function PushChoice() {
  const config = useQuery(api.push.config)
  const devices = useQuery(api.push.mine)
  const subscribe = useMutation(api.push.subscribe)
  const unsubscribe = useMutation(api.push.unsubscribe)
  const sendTest = useMutation(api.push.sendTest)
  const [here, setHere] = useState<boolean | null>(null)
  const [support, setSupport] = useState<ReturnType<typeof pushState>>(() => pushState())
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    void currentSubscription().then((s) => setHere(Boolean(s)))
  }, [])
  const others = (devices ?? []).length - (here ? 1 : 0)
  const disabled =
    support === 'unsupported' || support === 'blocked' || !config?.publicKey || here === null
  const detail =
    support === 'unsupported'
      ? 'This browser cannot receive push.'
      : support === 'blocked'
        ? 'Notifications are blocked for this site in the browser settings.'
        : needsInstallForPush()
          ? 'On iPhone and iPad, add Dispatchlet to the home screen first, then turn this on from there.'
          : (note ??
            (others > 0
              ? `${others} other ${others === 1 ? 'device gets' : 'devices get'} push.`
              : 'Also arrives when the app is closed.'))
  return (
    <li data-checked={Boolean(here)}>
      <label>
        <input
          type="checkbox"
          checked={Boolean(here)}
          disabled={disabled}
          onChange={async (e) => {
            setNote(null)
            try {
              if (e.target.checked) {
                const json = await subscribeToPush(config!.publicKey!)
                if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth)
                  throw new Error('The browser gave no subscription.')
                await subscribe({
                  endpoint: json.endpoint,
                  keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
                  userAgent: navigator.userAgent.slice(0, 200),
                })
                setHere(true)
                setNote('On. A test is not sent; the next run that needs you will.')
              } else {
                const endpoint = await unsubscribeFromPush()
                if (endpoint) await unsubscribe({ endpoint })
                setHere(false)
                setNote('Off on this device.')
              }
            } catch (error) {
              setNote(message(error, 'That did not work.'))
              setSupport(pushState())
            }
          }}
        />
        <span>Push on this device</span>
        <span className="app-muted">{detail}</span>
      </label>
      {here ? (
        <button
          type="button"
          className="app-link app-choice-action"
          onClick={() =>
            sendTest()
              .then(() => setNote('Sent. It should show in a moment.'))
              .catch(() => setNote('Not sent.'))
          }
        >
          Send a test
        </button>
      ) : null}
    </li>
  )
}

/** The person's own Anthropic key. With one, runs are not counted; without, the free allowance applies. */
function AnthropicKey({
  ownKey,
  invalid,
  runsLeft,
  dryRunsLeft,
}: {
  ownKey: boolean
  invalid: boolean
  runsLeft: number | null
  dryRunsLeft: number | null
}) {
  const id = useId()
  const setKey = useAction(api.users.setAnthropicKey)
  const [value, setValue] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const [error, setError] = useState<string | null>(null)
  const submit = (key: string) => {
    setState('saving')
    setError(null)
    setKey({ key })
      .then(() => {
        setState('saved')
        setValue('')
      })
      .catch((reason: unknown) => {
        setState('failed')
        setError(message(reason, 'Not saved.'))
      })
  }
  return (
    <section className="app-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Anthropic key</h2>
      {ownKey ? (
        <p>
          Runs use your own Anthropic key, so they are not counted.
          {invalid
            ? ' Anthropic rejected it on the last run, so runs are paused until you replace it.'
            : ''}
        </p>
      ) : (
        <p>
          Every account gets {runsLeft} more free {runsLeft === 1 ? 'run' : 'runs'} and{' '}
          {dryRunsLeft} dry {dryRunsLeft === 1 ? 'run' : 'runs'} on Dispatchlet’s key. Add your own
          key from{' '}
          <a href="https://platform.claude.com/" target="_blank" rel="noreferrer">
            platform.claude.com
          </a>{' '}
          and runs are not counted; you pay Anthropic for what they use, about 6 cents a run.
        </p>
      )}
      <div className="app-field">
        <input
          id={id}
          className="app-select app-key"
          type="password"
          autoComplete="off"
          placeholder={ownKey ? 'Replace the key' : 'sk-ant-…'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Anthropic API key"
        />
        <button
          type="button"
          className="app-gate-secondary"
          disabled={state === 'saving' || !value.trim()}
          onClick={() => submit(value)}
        >
          <BusyLabel busy={state === 'saving'} idle="Save key" working="Saving" />
        </button>
        {ownKey ? (
          <button
            type="button"
            className="app-gate-secondary"
            disabled={state === 'saving'}
            onClick={() => submit('')}
          >
            Remove key
          </button>
        ) : null}
        <span className="app-muted" role="status">
          {state === 'saved' ? 'Saved. It is stored encrypted.' : ''}
        </span>
      </div>
      {error ? (
        <p className="app-connection-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

/** Runs are scheduled in this time zone. Saved as soon as it changes. */
function TimezoneSetting({ value }: { value: string | null }) {
  const id = useId()
  const save = useMutation(api.users.setTimezone)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const zones = useMemo(() => {
    const all = Intl.supportedValuesOf('timeZone')
    return value && !all.includes(value) ? [value, ...all] : all
  }, [value])
  return (
    <section className="app-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Time zone</h2>
      <label htmlFor={id} className="app-muted app-label">
        Runs happen at the time you pick, in this time zone.
      </label>
      <div className="app-field">
        <select
          id={id}
          className="app-select"
          value={value ?? ''}
          onChange={(event) => {
            setState('saving')
            save({ timezone: event.target.value })
              .then(() => setState('saved'))
              .catch(() => setState('failed'))
          }}
        >
          {value ? null : <option value="">Choose a time zone</option>}
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
        <span className="app-muted" role="status">
          {state === 'saving'
            ? 'Saving'
            : state === 'saved'
              ? 'Saved'
              : state === 'failed'
                ? 'Not saved. Try again.'
                : ''}
        </span>
      </div>
    </section>
  )
}

/** Deletes the account after a second, explicit click. No browser dialog. */
function DeleteAccount() {
  const remove = useAction(api.users.deleteAccount)
  const { signOut } = useAuthActions()
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <section className="app-section" aria-labelledby="delete-title">
      <h2 id="delete-title">Delete account</h2>
      <p>
        Deletes your Dispatchlet account and everything it holds, and removes Dispatchlet’s access
        to your Buffer account. Posts already in Buffer stay there.
      </p>
      {confirming ? (
        <div className="app-gate-actions">
          <button
            type="button"
            className="app-gate-danger"
            disabled={pending}
            onClick={() => {
              setPending(true)
              setError(null)
              remove()
                .then(() => signOut().catch(() => {}))
                .then(() => window.location.replace('/app?deleted'))
                .catch((reason: unknown) => {
                  setPending(false)
                  setError(message(reason, 'Your account was not deleted. Try again.'))
                })
            }}
          >
            <BusyLabel busy={pending} idle="Delete my account" working="Deleting" />
          </button>
          <button
            type="button"
            className="app-gate-secondary"
            disabled={pending}
            onClick={() => setConfirming(false)}
          >
            Keep it
          </button>
        </div>
      ) : (
        <button type="button" className="app-gate-secondary" onClick={() => setConfirming(true)}>
          Delete account
        </button>
      )}
      {error ? (
        <p className="app-connection-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
