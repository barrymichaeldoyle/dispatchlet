import { ConvexAuthProvider, useAuthActions } from '@convex-dev/auth/react'
import { Link, Outlet } from '@tanstack/react-router'
import { ConvexReactClient, useConvexAuth, useMutation, useQuery } from 'convex/react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { ConnectionBanner, SignOut } from './app-pages'
import { BufferMark, ChannelMark } from './brand-icons'
import { Wordmark } from './wordmark'
import { registerServiceWorker } from '../lib/service-worker'
import { BusyLabel } from './busy-label'

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string | undefined
const convex = CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null

export function AppGate() {
  useEffect(() => registerServiceWorker(), [])
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
  return <AppShell timezone={viewer.timezone} name={viewer.name} email={viewer.email} />
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
  const deleted = new URLSearchParams(window.location.search).has('deleted')
  const open = useQuery(api.users.signupOpen)
  return (
    <Screen title={deleted ? 'Your account is deleted.' : 'Sign in to Dispatchlet.'}>
      {deleted ? (
        <p>
          Everything Dispatchlet held for it is gone, and its access to your Buffer account is
          removed. Signing in again starts a new account.
        </p>
      ) : (
        <p>Use your Buffer account. There is no separate password.</p>
      )}
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
        <BusyLabel busy={pending} idle="Sign in with Buffer" working="Opening Buffer" />
      </button>
      {open === false ? (
        <p className="app-gate-note">
          Dispatchlet opens on 7 November. If you sign in before then, your Buffer email goes on the
          launch list.
        </p>
      ) : null}
    </Screen>
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

/**
 * The app for allowlisted accounts: a header with the pages, the Buffer connection warning when
 * there is one, then the page. The time zone is filled in from the browser on the first visit.
 */
function AppShell({
  timezone,
  name,
  email,
}: {
  timezone: string | null
  name: string | null
  email: string | null
}) {
  const setTimezone = useMutation(api.users.setTimezone)
  const automations = useQuery(api.automations.list)
  const connection = useQuery(api.buffer.myConnection)
  useEffect(() => {
    if (timezone) return
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (detected) void setTimezone({ timezone: detected }).catch(() => {})
  }, [timezone, setTimezone])
  const channels = connection?.channels ?? []
  return (
    <div className="app-frame">
      <aside className="app-side">
        <Link to="/app" className="app-gate-home" aria-label="Dispatchlet app home">
          <Wordmark size="md" />
        </Link>
        <nav aria-label="App" className="app-side-nav">
          <Link to="/app" activeOptions={{ exact: true }}>
            Home
          </Link>
          <Link to="/app/new">New automation</Link>
          <Link to="/app/settings">Settings</Link>
        </nav>
        {automations && automations.length ? (
          <div className="app-side-group">
            <h2>Automations</h2>
            <ul>
              {automations.map((a) => (
                <li key={a._id} data-status={a.status}>
                  <Link to="/app/a/$id" params={{ id: a._id }}>
                    <span className="app-side-name">{a.name}</span>
                    <span className="app-side-state">{SIDE_STATES[a.status] ?? a.status}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {channels.length ? (
          <div className="app-side-group">
            <h2>Channels</h2>
            <ul>
              {channels.map((c) => (
                <li key={c.channelId} data-usable={c.usable}>
                  <span className="app-side-channel">
                    <ChannelMark channel={SERVICE_NAMES[c.service] ?? c.service} size={14} />
                    <span className="app-side-name">{c.name}</span>
                  </span>
                </li>
              ))}
            </ul>
            <Link to="/app/settings" className="app-side-small">
              Manage in settings
            </Link>
          </div>
        ) : null}
        <div className="app-side-account">
          <span className="app-side-name">{name ?? email ?? 'Signed in with Buffer'}</span>
          {name && email ? <span className="app-side-small">{email}</span> : null}
          <SignOut />
        </div>
      </aside>
      <main className="app-gate is-app">
        <div className="app-gate-inner">
          <header className="app-top">
            <Link to="/app" className="app-gate-home" aria-label="Dispatchlet app home">
              <Wordmark size="md" />
            </Link>
            <nav aria-label="App" className="app-nav">
              <Link to="/app" activeOptions={{ exact: true }}>
                Home
              </Link>
              <Link to="/app/settings">Settings</Link>
            </nav>
          </header>
          <ConnectionBanner />
          <Outlet />
        </div>
      </main>
    </div>
  )
}

const SIDE_STATES: Record<string, string> = {
  generating: 'writing',
  ready: 'not enabled',
  active: 'on',
  paused: 'paused',
  failed: 'paused',
}

const SERVICE_NAMES: Record<string, string> = {
  twitter: 'X',
  linkedin: 'LinkedIn',
  threads: 'Threads',
  bluesky: 'Bluesky',
  mastodon: 'Mastodon',
}
