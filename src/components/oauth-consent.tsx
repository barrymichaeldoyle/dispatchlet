import { ConvexAuthProvider, useAuthActions } from '@convex-dev/auth/react'
import { ConvexReactClient, useConvexAuth, useMutation, useQuery } from 'convex/react'
import { useState } from 'react'
import { api } from '../../convex/_generated/api'
import { errorText } from '../lib/format'
import { Wordmark } from './wordmark'

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string | undefined
const convex = CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null

export function OAuthConsent() {
  if (!convex) return <Frame title="Sign-in is not set up here." />
  return (
    <ConvexAuthProvider client={convex}>
      <Consent />
    </ConvexAuthProvider>
  )
}

function Frame({ title, children }: { title: string; children?: React.ReactNode }) {
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

function Consent() {
  const params = new URLSearchParams(window.location.search)
  const handle = params.get('handle') ?? ''
  const client = params.get('client') ?? 'An app'
  const domain = params.get('domain')
  const redirect = params.get('redirect') ?? ''
  const loopback = params.has('loopback')
  const { isLoading, isAuthenticated } = useConvexAuth()
  const viewer = useQuery(api.users.viewer, isAuthenticated ? {} : 'skip')
  const { signIn } = useAuthActions()
  const createToken = useMutation(api.tokens.createForOAuth)
  const [write, setWrite] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!handle)
    return (
      <Frame title="This link is not complete.">
        <p>Start connecting again from the app that sent you here.</p>
      </Frame>
    )
  if (isLoading || (isAuthenticated && viewer === undefined)) return <Frame title="One moment." />
  if (!isAuthenticated || !viewer)
    return (
      <Frame title={`Sign in to connect ${client}.`}>
        <p>Use your Buffer account. You will come back here to say yes or no.</p>
        <button
          type="button"
          className="app-gate-primary"
          onClick={() =>
            void signIn('buffer', {
              redirectTo: `${window.location.pathname}${window.location.search}`,
            })
          }
        >
          Sign in with Buffer
        </button>
      </Frame>
    )
  if (!viewer.allowed)
    return (
      <Frame title="Dispatchlet is not open yet.">
        <p>You are on the launch list. Connecting an assistant works once your account is in.</p>
      </Frame>
    )

  const decide = async (decision: 'approve' | 'deny') => {
    setBusy(true)
    setError(null)
    try {
      const token =
        decision === 'approve'
          ? (await createToken({ clientName: client, write })).token
          : undefined
      const response = await fetch('/oauth/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, decision, token, write }),
      })
      const body = (await response.json()) as { redirectTo?: string; error?: string }
      if (!response.ok || !body.redirectTo) throw new Error(body.error ?? 'That did not work.')
      window.location.assign(body.redirectTo)
    } catch (reason) {
      setError(errorText(reason, 'That did not work. Start again from the app.'))
      setBusy(false)
    }
  }

  return (
    <Frame title={`Let ${client} use your Dispatchlet?`}>
      <p>
        {domain ? (
          <>
            Published by <strong>{domain}</strong>.{' '}
          </>
        ) : (
          'This app named itself; the name is not checked. '
        )}
        Access goes to <strong>{redirect}</strong>.
      </p>
      {loopback ? (
        <p className="app-connection-error">
          This sends access to an app on your own computer. Continue only if you just started
          connecting from it.
        </p>
      ) : null}
      <p>
        It will be able to see your automations, playbooks, runs and posts
        {viewer.email ? ` for ${viewer.email}` : ''}.
      </p>
      <ul className="app-choices">
        <li data-checked={write}>
          <label>
            <input type="checkbox" checked={write} onChange={(e) => setWrite(e.target.checked)} />
            <span>Also start runs, change playbooks and approve drafts</span>
            <span className="app-muted">Runs count against your allowance like any other.</span>
          </label>
        </li>
      </ul>
      <p className="app-muted">
        It appears under Settings → API tokens as {client.slice(0, 40)}. Revoke it there at any
        time.
      </p>
      <div className="app-gate-actions">
        <button
          type="button"
          className="app-gate-primary"
          disabled={busy}
          onClick={() => void decide('approve')}
        >
          {busy ? 'Connecting' : 'Allow'}
        </button>
        <button
          type="button"
          className="app-gate-secondary"
          disabled={busy}
          onClick={() => void decide('deny')}
        >
          Deny
        </button>
      </div>
      {error ? (
        <p className="app-connection-error" role="alert">
          {error}
        </p>
      ) : null}
    </Frame>
  )
}
