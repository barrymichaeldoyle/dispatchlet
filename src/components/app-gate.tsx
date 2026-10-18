import { ConvexAuthProvider, useAuthActions } from '@convex-dev/auth/react'
import { ConvexReactClient, useConvexAuth, useQuery } from 'convex/react'
import { useState } from 'react'
import { api } from '../../convex/_generated/api'
import { BufferMark } from './brand-icons'
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
  if (isLoading || (isAuthenticated && viewer === undefined))
    return <Screen title="Signing you in." />
  if (!isAuthenticated || !viewer) return <SignIn />
  if (!viewer.allowed) return <Waitlisted email={viewer.email} />
  return <SignedIn name={viewer.name ?? viewer.email ?? 'you'} />
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
  return (
    <button type="button" className="app-gate-secondary" onClick={() => void signOut()}>
      Sign out
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
        <a href="/#run" className="app-gate-primary">
          Watch the demo
        </a>
        <SignOut />
      </div>
    </Screen>
  )
}

function SignedIn({ name }: { name: string }) {
  return (
    <Screen title={`Signed in as ${name}.`}>
      <p>
        Your Buffer account is on the allowlist, so you see the app here while it is built. Everyone
        else sees the launch list until it opens to the public.
      </p>
      <div className="app-gate-actions">
        <SignOut />
      </div>
    </Screen>
  )
}
