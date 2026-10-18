import { ConvexAuthProvider, useAuthActions } from '@convex-dev/auth/react'
import { ConvexReactClient, useAction, useConvexAuth, useQuery } from 'convex/react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { BufferMark, ChannelMark } from './brand-icons'
import { Wordmark } from './wordmark'

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string | undefined
const convex = CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null

export function AppGate() {
  if (!convex) return <Screen title="Sign-in is not set up here." />
  return (
    <ConvexAuthProvider client={convex}>
      <Gate />
    </ConvexAuthProvider>
  )
}

function Gate() {
  const { isLoading, isAuthenticated } = useConvexAuth()
  const viewer = useQuery(api.users.viewer, isAuthenticated ? {} : 'skip')
  if (isLoading || (isAuthenticated && viewer === undefined)) return <SigningIn />
  if (!isAuthenticated || !viewer) return <SignIn />
  if (!viewer.allowed) return <Waitlisted email={viewer.email} />
  return <SignedIn name={viewer.name} email={viewer.email} />
}

function Screen({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <main className="app-gate">
      <div className="app-gate-inner">
        <a href="/" className="app-gate-home" aria-label="Dispatchlet home">
          <Wordmark size="md" />
        </a>
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  )
}

const STEPS = ['Checking with Buffer.', 'Reading your account.', 'Opening Dispatchlet.']

/**
 * The mark dispatches small arrows while sign-in finishes, and the line under it says which part
 * is running. Clicking the mark sends one more. With reduced motion the arrows stay put.
 */
function SigningIn() {
  const [step, setStep] = useState(0)
  const [shots, setShots] = useState<number[]>([])
  const nextShot = useRef(0)
  useEffect(() => {
    const timer = window.setInterval(
      () => setStep((value) => Math.min(value + 1, STEPS.length - 1)),
      1100,
    )
    return () => window.clearInterval(timer)
  }, [])
  const dispatch = () => {
    const id = nextShot.current++
    setShots((value) => [...value, id])
  }
  return (
    <Screen title="Signing you in.">
      <div className="signin-dispatch" aria-hidden="true" onPointerDown={dispatch}>
        <svg className="signin-mark" width="56" height="56" viewBox="0 0 24 24">
          <path d="M3 3h11l7 9-7 9H3z" fill="var(--color-pine)" />
          <path d="M6.5 6.5h5.8l4.3 5.5-4.3 5.5H6.5z" fill="#fff" />
        </svg>
        <div className="signin-lane">
          {[0, 1, 2].map((index) => (
            <Arrow key={index} className="is-loop" delay={index * 0.5} />
          ))}
          {shots.map((id) => (
            <Arrow
              key={`shot-${id}`}
              className="is-shot"
              onDone={() => setShots((value) => value.filter((shot) => shot !== id))}
            />
          ))}
        </div>
        <span className="signin-buffer">
          <BufferMark size={22} />
        </span>
      </div>
      <p className="signin-steps" aria-live="polite">
        {STEPS.map((text, index) => (
          <span key={text} data-active={index === step} aria-hidden={index !== step}>
            {text}
          </span>
        ))}
      </p>
    </Screen>
  )
}

function Arrow({
  className,
  delay = 0,
  onDone,
}: {
  className: string
  delay?: number
  onDone?: () => void
}) {
  return (
    <svg
      className={`signin-arrow ${className}`}
      width="14"
      height="16"
      viewBox="0 0 14 16"
      style={{ animationDelay: `${delay}s` }}
      onAnimationEnd={onDone}
    >
      <path d="M1 1h6l5 7-5 7H1z" fill="var(--color-pine)" />
    </svg>
  )
}

function SignIn() {
  const { signIn } = useAuthActions()
  const [pending, setPending] = useState(false)
  return (
    <Screen title="Sign in to Dispatchlet.">
      <p>Use your Buffer account. There is no separate password.</p>
      <button
        type="button"
        className="app-gate-primary"
        disabled={pending}
        onClick={() => {
          setPending(true)
          void signIn('buffer', { redirectTo: '/app' }).catch(() => setPending(false))
        }}
      >
        <BufferMark size={16} />
        {pending ? 'Opening Buffer' : 'Sign in with Buffer'}
      </button>
      <p className="app-gate-note">
        Dispatchlet opens on 7 November. If you sign in before then, your Buffer email goes on the
        launch list.
      </p>
    </Screen>
  )
}

function SignOut() {
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

function Waitlisted({ email }: { email: string | null }) {
  return (
    <Screen title="You’re on the launch list.">
      {email ? (
        <p>
          Thanks for signing in. Dispatchlet isn’t open yet. We’ll email <strong>{email}</strong>{' '}
          when sign-up opens on 7 November.
        </p>
      ) : (
        <p>
          Thanks for signing in. Dispatchlet isn’t open yet. Buffer didn’t share an email address,
          so add yours on <a href="/">dispatchlet.com</a> to hear when it opens on 7 November.
        </p>
      )}
      <div className="app-gate-actions">
        <a href="/?demo" className="app-gate-primary">
          Watch the demo
        </a>
        <SignOut />
      </div>
    </Screen>
  )
}

function SignedIn({ name, email }: { name: string | null; email: string | null }) {
  // The heading greets by first name, so a long full name never breaks across lines in it.
  const firstName = name?.trim().split(/\s+/)[0]
  const account = name && email ? `${name} (${email})` : (name ?? email)
  return (
    <Screen title={firstName ? `Welcome back, ${firstName}.` : 'Welcome back.'}>
      {account ? (
        <p className="app-gate-account">
          Signed in with Buffer as <strong>{account}</strong>.
        </p>
      ) : null}
      <p>
        Your Buffer account is on the allowlist, so you see the app here while it is built. Everyone
        else sees the launch list until it opens to the public.
      </p>
      <BufferConnection />
      <div className="app-gate-actions">
        <SignOut />
      </div>
    </Screen>
  )
}

const SERVICE_NAMES: Record<string, string> = {
  twitter: 'X',
  linkedin: 'LinkedIn',
  threads: 'Threads',
  bluesky: 'Bluesky',
  mastodon: 'Mastodon',
}

/** The owner's check that the Buffer grant works: posting access, refresh, and synced channels. */
function BufferConnection() {
  const connection = useQuery(api.buffer.myConnection)
  const sync = useAction(api.buffer.syncChannels)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (connection === undefined) return null
  const canPost = connection?.scope.includes('posts:write') ?? false
  const status = !connection
    ? 'Not connected. Sign out and sign in with Buffer again to connect.'
    : connection.needsReauth
      ? 'Buffer access has ended. Sign out and sign in with Buffer again.'
      : !canPost
        ? 'Connected without posting access. Sign out and sign in again to grant it.'
        : connection.canRefresh
          ? 'Connected with posting access. The token renews itself.'
          : 'Connected with posting access, but Buffer did not issue a refresh token, so it lasts about an hour.'
  return (
    <section className="app-connection" aria-labelledby="connection-title">
      <h2 id="connection-title">Buffer connection</h2>
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
        <p className="app-connection-note">No channels synced yet.</p>
      ) : null}
      {connection && !connection.needsReauth ? (
        <button
          type="button"
          className="app-gate-secondary"
          disabled={syncing}
          onClick={() => {
            setSyncing(true)
            setError(null)
            sync()
              .catch((reason: unknown) =>
                setError(reason instanceof Error ? reason.message : 'Sync failed.'),
              )
              .finally(() => setSyncing(false))
          }}
        >
          {syncing ? 'Syncing channels' : 'Sync channels'}
        </button>
      ) : null}
      {error ? (
        <p className="app-connection-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
