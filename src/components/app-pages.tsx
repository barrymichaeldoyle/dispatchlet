import { useAuthActions } from '@convex-dev/auth/react'
import { useAction, useMutation, useQuery } from 'convex/react'
import { useId, useMemo, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { BufferMark, ChannelMark } from './brand-icons'

function message(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message.replace(/^.*Uncaught Error: /s, '') : fallback
}

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

export function AppHome() {
  const viewer = useQuery(api.users.viewer)
  if (!viewer) return null
  // The heading greets by first name, so a long full name never breaks across lines in it.
  const firstName = viewer.name?.trim().split(/\s+/)[0]
  const account =
    viewer.name && viewer.email ? `${viewer.name} (${viewer.email})` : (viewer.name ?? viewer.email)
  return (
    <>
      <h1>{firstName ? `Welcome back, ${firstName}.` : 'Welcome back.'}</h1>
      {account ? (
        <p className="app-gate-account">
          Signed in with Buffer as <strong>{account}</strong>.
        </p>
      ) : null}
      <p>
        Your Buffer account is on the allowlist, so you see the app here while it is built. Everyone
        else sees the launch list until it opens to the public.
      </p>
      <div className="app-gate-actions">
        <SignOut />
      </div>
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
