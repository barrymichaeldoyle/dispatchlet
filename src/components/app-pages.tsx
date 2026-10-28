import { useAuthActions } from '@convex-dev/auth/react'
import { Link } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import { useId, useMemo, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { describeCadence } from '../../convex/lib/schedule'
import { BufferMark, ChannelMark } from './brand-icons'
import { errorText as message, whenIn } from '../lib/format'

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
      {pending ? 'Signing out' : 'Sign out'}
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
        {pending ? 'Opening Buffer' : connection ? 'Reconnect Buffer' : 'Connect Buffer'}
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

/** The home page: each automation in words, and the drafts waiting for a yes (SPEC §17). */
export function AppHome() {
  const viewer = useQuery(api.users.viewer)
  const data = useQuery(api.automations.dashboard)
  if (!viewer || data === undefined) return null
  const firstName = viewer.name?.trim().split(/\s+/)[0]
  const { automations, drafts } = data ?? { automations: [], drafts: [] }
  return (
    <>
      <h1>{firstName ? `Welcome back, ${firstName}.` : 'Welcome back.'}</h1>
      {drafts.length ? (
        <section className="app-section">
          <h2>Waiting for you</h2>
          <p className="app-muted">
            {drafts.length} {drafts.length === 1 ? 'draft is' : 'drafts are'} in Buffer until you
            approve {drafts.length === 1 ? 'it' : 'them'}.
          </p>
          <ul className="app-posts">
            {drafts.slice(0, 5).map((d) => (
              <li key={d._id}>
                <p className="app-post-head">
                  <ChannelMark channel={SERVICE_NAMES[d.service] ?? d.service} size={14} />
                  <strong>{d.channelName}</strong>
                  <Link to="/app/a/$id/runs/$runId" params={{ id: d.automationId, runId: d.runId }}>
                    Open the run to approve
                  </Link>
                </p>
                <p className="app-post-text">{d.text.split('\n')[0]}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="app-section">
        <div className="app-section-head">
          <h2>Automations</h2>
          <Link to="/app/new" className="app-gate-primary">
            New automation
          </Link>
        </div>
        {automations.length ? (
          <ul className="app-automations">
            {automations.map((a) => (
              <li key={a._id}>
                <p className="app-automation-head">
                  <Link to="/app/a/$id" params={{ id: a._id }}>
                    {a.name}
                  </Link>
                  <span className="app-muted">
                    {describeCadence(a.cadence)}. {STATUS_WORDS[a.status] ?? a.status}
                    {a.status === 'active' && a.nextRunAt
                      ? `, next ${whenIn(a.nextRunAt, a.timezone)}`
                      : ''}
                    .
                  </span>
                </p>
                <p>
                  {a.lastRun ? (
                    <>
                      <Link
                        to="/app/a/$id/runs/$runId"
                        params={{ id: a._id, runId: a.lastRun._id }}
                      >
                        {RUN_KINDS[a.lastRun.kind] ?? 'Run'}{' '}
                        {whenIn(a.lastRun.startedAt, a.timezone)}
                      </Link>
                      {a.lastRun.finished ? `: ${a.lastRun.note}` : ': running.'}
                    </>
                  ) : (
                    'No runs yet. Try a dry run.'
                  )}
                </p>
                <p className="app-muted tabular">
                  {a.postsThisWeek} {a.postsThisWeek === 1 ? 'post' : 'posts'} in Buffer this week.
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <ol className="app-steps">
            <li>
              <p>
                <strong>Answer seven questions.</strong>What to research, where to post, what to
                avoid, which sources, when, how many stories, drafts or queue.
              </p>
            </li>
            <li>
              <p>
                <strong>Dispatchlet writes the playbook.</strong>It reads your sources first, then
                writes the rules it follows on every run. You can edit any of it.
              </p>
            </li>
            <li>
              <p>
                <strong>Try a dry run, then enable it.</strong>A dry run finds the stories and
                writes the posts without sending anything to Buffer. Enable it and it runs on your
                schedule.
              </p>
            </li>
          </ol>
        )}
      </section>
      {!viewer.ownKey ? (
        <p className="app-muted">
          {viewer.runsLeft} free {viewer.runsLeft === 1 ? 'run' : 'runs'} and {viewer.dryRunsLeft}{' '}
          dry {viewer.dryRunsLeft === 1 ? 'run' : 'runs'} left on this account.{' '}
          <Link to="/app/settings">Add your own key</Link> to lift the limit.
        </p>
      ) : null}
    </>
  )
}

export function AppSettings() {
  const viewer = useQuery(api.users.viewer)
  if (!viewer) return null
  return (
    <>
      <h1>Settings.</h1>
      <section className="app-section" aria-labelledby="account-title">
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
      <BufferConnection />
      <Usage />
      <EmailPrefs />
      <AnthropicKey
        ownKey={viewer.ownKey}
        invalid={viewer.keyInvalid}
        runsLeft={viewer.runsLeft}
        dryRunsLeft={viewer.dryRunsLeft}
      />
      <TimezoneSetting value={viewer.timezone} />
      <DeleteAccount />
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
              {syncing ? 'Syncing channels' : 'Sync channels'}
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
            {disconnecting ? 'Disconnecting' : 'Disconnect Buffer'}
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
  return (
    <section className="app-section" aria-labelledby="email-title">
      <h2 id="email-title">Email</h2>
      <ul className="app-choices">
        {PREFS.map(([value, title, detail]) => (
          <li key={value} data-checked={usage.emailPrefs === value}>
            <label>
              <input
                type="radio"
                name="emailPrefs"
                checked={usage.emailPrefs === value}
                onChange={() => {
                  setState('saving')
                  save({ prefs: value })
                    .then(() => setState('saved'))
                    .catch(() => setState('failed'))
                }}
              />
              <span>{title}</span>
              <span className="app-muted">{detail}</span>
            </label>
          </li>
        ))}
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
          and runs are not counted; you pay Anthropic for what they use, about $0.15 a run.
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
          {state === 'saving' ? 'Saving' : 'Save key'}
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
            {pending ? 'Deleting' : 'Delete my account'}
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
