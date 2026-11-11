import { ConvexAuthProvider, useAuthActions } from '@convex-dev/auth/react'
import { Link, Outlet } from '@tanstack/react-router'
import { ConvexReactClient, useConvexAuth, useMutation, useQuery } from 'convex/react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { ConnectionBanner, SignOut } from './app-pages'
import { BufferMark, ChannelMark } from './brand-icons'
import { Avatar, NavIcon } from './nav-icons'
import { Wordmark } from './wordmark'
import { channelProblem, serviceName } from '../lib/format'
import { registerServiceWorker } from '../lib/service-worker'
import { BusyLabel } from './busy-label'
import { setLeaving, useLeaving } from '../lib/leaving'
import { FeedbackProvider, SendFeedbackButton } from './feedback'

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string | undefined
const convex = CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null

export function AppGate() {
  useEffect(() => registerServiceWorker(), [])
  if (!convex) return <Screen title="Sign-in is not set up here" />
  return (
    <ConvexAuthProvider client={convex}>
      <Gate />
    </ConvexAuthProvider>
  )
}

/** Where Convex Auth keeps this deployment's session; the name is the library's own. */
const SESSION_KEY = `__convexAuthJWT_${(CONVEX_URL ?? '').replace(/[^a-zA-Z0-9]/g, '')}`

function hasStoredSession() {
  try {
    return window.localStorage.getItem(SESSION_KEY) !== null
  } catch {
    return false
  }
}

/**
 * How the visitor got here. `code` means Buffer has just sent them back, and `signin` means they
 * pressed one of the site's own start links, so they have already asked to sign in.
 */
function readArrival() {
  const params = new URLSearchParams(window.location.search)
  return { returning: params.has('code'), asked: params.has('signin') }
}

function Gate() {
  const { isLoading, isAuthenticated } = useConvexAuth()
  const viewer = useQuery(api.users.viewer, isAuthenticated ? {} : 'skip')
  const [arrival] = useState(readArrival)
  // `signin` is spent on arrival, so coming back from Buffer without signing in, or reloading,
  // shows the sign-in page rather than leaving for Buffer again.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('signin')) return
    url.searchParams.delete('signin')
    window.history.replaceState(window.history.state, '', url)
  }, [])
  // "Signing you in" is only for a session that is on its way. A visitor with none goes straight
  // to the sign-in page instead of seeing it flash past first.
  const expected = arrival.returning || hasStoredSession()
  const leaving = useLeaving()
  const signedOut = !isAuthenticated && !isLoading
  useEffect(() => {
    if (signedOut) setLeaving(false)
  }, [signedOut])
  if (leaving && !signedOut) return <Screen title="Signing you out" />
  if (isAuthenticated ? viewer === undefined : isLoading && expected) return <SigningIn />
  if (!isAuthenticated || !viewer) return <SignIn asked={arrival.asked} />
  if (!viewer.allowed) return <Waitlisted email={viewer.email} />
  return (
    <AppShell
      timezone={viewer.timezone}
      name={viewer.name}
      email={viewer.email}
      image={viewer.image}
    />
  )
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

const ARRIVING = ['Checking with Buffer.', 'Reading your account.', 'Opening Dispatchlet.']
const LEAVING = ['Opening Buffer.']

/**
 * The mark dispatches small arrows while sign-in finishes, and the line under it says which part
 * is running. Clicking the mark sends one more. With reduced motion the arrows stay put.
 */
function SigningIn({ steps = ARRIVING }: { steps?: string[] }) {
  const [step, setStep] = useState(0)
  const [shots, setShots] = useState<number[]>([])
  const nextShot = useRef(0)
  useEffect(() => {
    const timer = window.setInterval(
      () => setStep((value) => Math.min(value + 1, steps.length - 1)),
      1100,
    )
    return () => window.clearInterval(timer)
  }, [steps])
  const dispatch = () => {
    const id = nextShot.current++
    setShots((value) => [...value, id])
  }
  return (
    <Screen title="Signing you in">
      <div className="signin-dispatch" aria-hidden="true" onPointerDown={dispatch}>
        <svg className="signin-mark" width="56" height="56" viewBox="0 0 24 24">
          <path
            fillRule="evenodd"
            d="M3 3h11l7 9-7 9H3zM6.5 6.5v11h5.8l4.3-5.5-4.3-5.5z"
            fill="var(--color-pine)"
          />
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
        {steps.map((text, index) => (
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

/**
 * The sign-in page. A visitor who arrived from a start link has already asked to sign in, so they
 * go straight to Buffer and see the signing-in screen on the way. The page itself is for everyone
 * else: someone who opened the app directly, signed out, deleted their account, or came back
 * from Buffer without finishing. While sign-up is closed nobody is sent on without seeing the
 * launch-list note first.
 */
function SignIn({ asked }: { asked: boolean }) {
  const { signIn } = useAuthActions()
  const [pending, setPending] = useState(false)
  const [stopped, setStopped] = useState(false)
  const deleted = new URLSearchParams(window.location.search).has('deleted')
  const open = useQuery(api.users.signupOpen)
  const direct = asked && !deleted && !stopped && open !== false
  const start = () => {
    setPending(true)
    void signIn('buffer', { redirectTo: '/app' }).catch(() => {
      setPending(false)
      setStopped(true)
    })
  }
  const started = useRef(false)
  useEffect(() => {
    if (!direct || open === undefined || started.current) return
    started.current = true
    start()
  })
  // Going back from Buffer can restore this page as it was left, still waiting on a redirect.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      setPending(false)
      setStopped(true)
    }
    window.addEventListener('pageshow', restored)
    return () => window.removeEventListener('pageshow', restored)
  }, [])
  if (direct) return <SigningIn steps={LEAVING} />
  return (
    <Screen title={deleted ? 'Your account is deleted' : 'Sign in to Dispatchlet'}>
      {deleted ? (
        <p>
          Everything Dispatchlet held for it is gone, and its access to your Buffer account is
          removed. Signing in again starts a new account.
        </p>
      ) : (
        <p>Use your Buffer account. There is no separate password.</p>
      )}
      <button type="button" className="app-gate-primary" disabled={pending} onClick={start}>
        <BufferMark size={16} />
        <BusyLabel busy={pending} idle="Sign in with Buffer" working="Opening Buffer" />
      </button>
      {open === false ? (
        <p className="app-gate-note">
          Dispatchlet isn’t open yet. If you sign in before it is, your Buffer email goes on the
          launch list.
        </p>
      ) : null}
    </Screen>
  )
}

function Waitlisted({ email }: { email: string | null }) {
  return (
    <Screen title="You’re on the launch list">
      {email ? (
        <p>
          Thanks for signing in. Dispatchlet isn’t open yet. We’ll email <strong>{email}</strong>{' '}
          when sign-up opens.
        </p>
      ) : (
        <p>
          Thanks for signing in. Dispatchlet isn’t open yet. Buffer didn’t share an email address,
          so add yours on <a href="/">dispatchlet.com</a> to hear when it opens.
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
  image,
}: {
  timezone: string | null
  name: string | null
  email: string | null
  image: string | null
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
    <FeedbackProvider>
      <div className="app-frame">
        <aside className="app-side">
          <Link to="/app" className="app-gate-home" aria-label="Dispatchlet app home">
            <Wordmark size="md" />
          </Link>
          <nav aria-label="App" className="app-side-nav">
            <Link to="/app" activeOptions={{ exact: true }}>
              <NavIcon kind="home" />
              Home
            </Link>
            <Link to="/app/new">
              <NavIcon kind="new" />
              New automation
            </Link>
            <Link to="/app/settings">
              <NavIcon kind="settings" />
              Settings
            </Link>
            <SendFeedbackButton className="app-nav-button">
              <NavIcon kind="feedback" />
            </SendFeedbackButton>
          </nav>
          {automations && automations.length ? (
            <div className="app-side-group">
              <h2>Automations</h2>
              <ul>
                {automations.map((a) => (
                  <li key={a._id} data-status={a.status}>
                    <Link to="/app/a/$id" params={{ id: a._id }}>
                      <span className="app-side-name">{a.name}</span>
                      <span className="app-side-state">
                        <span className="app-side-dot" aria-hidden="true" />
                        {SIDE_STATES[a.status] ?? a.status}
                      </span>
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
                  <li
                    key={c.channelId}
                    data-usable={c.usable}
                    title={c.usable ? undefined : channelProblem(c.problem, c.service)}
                  >
                    <span className="app-side-channel">
                      <Avatar src={c.avatar} size={24} badge>
                        <ChannelMark channel={serviceName(c.service)} size={c.avatar ? 9 : 14} />
                      </Avatar>
                      <span className="app-side-channel-text">
                        <span className="app-side-name">{c.name}</span>
                        {c.usable ? null : (
                          <span className="app-side-problem">
                            {CHANNEL_PROBLEMS[c.problem ?? ''] ?? 'needs attention'}
                            <span className="visually-hidden">
                              {`: ${channelProblem(c.problem, c.service)}`}
                            </span>
                          </span>
                        )}
                      </span>
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
            <div className="app-side-who">
              <Avatar src={image} size={36}>
                <span className="app-avatar-initial" aria-hidden="true">
                  {(name ?? email ?? '?').trim().charAt(0).toUpperCase()}
                </span>
              </Avatar>
              <div className="app-side-who-text">
                <span className="app-side-name">{name ?? email ?? 'Signed in with Buffer'}</span>
                {name && email ? (
                  <span className="app-side-small" title={email}>
                    {email}
                  </span>
                ) : null}
              </div>
            </div>
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
                <SendFeedbackButton className="app-nav-button" />
              </nav>
            </header>
            <ConnectionBanner />
            <Outlet />
          </div>
        </main>
      </div>
    </FeedbackProvider>
  )
}

const SIDE_STATES: Record<string, string> = {
  generating: 'writing',
  ready: 'off',
  active: 'on',
  paused: 'paused',
  failed: 'failing',
}

/** Why a channel in the side list is greyed out, short enough to sit under its name. */
const CHANNEL_PROBLEMS: Record<string, string> = {
  unsupported: 'can’t post here yet',
  disconnected: 'disconnected in Buffer',
  locked: 'locked in Buffer',
}
