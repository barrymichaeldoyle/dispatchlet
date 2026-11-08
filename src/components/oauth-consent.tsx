import { ConvexAuthProvider, useAuthActions } from '@convex-dev/auth/react'
import { ConvexReactClient, useConvexAuth, useMutation, useQuery } from 'convex/react'
import { useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { errorText } from '../lib/format'
import { requestedWrite } from '../lib/oauth'
import { Wordmark } from './wordmark'
import { BusyLabel } from './busy-label'

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string | undefined
const convex = CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null

export function OAuthConsent() {
  if (!convex) return <Frame title="Sign-in is not set up here" />
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
  // What the client asked for. The grant never exceeds it, so the write choice only exists when
  // the client wants to write; a request naming no scopes is a request to read.
  const askedWrite = requestedWrite(params.get('scope'))
  const { isLoading, isAuthenticated } = useConvexAuth()
  const viewer = useQuery(api.users.viewer, isAuthenticated ? {} : 'skip')
  const { signIn } = useAuthActions()
  const createToken = useMutation(api.tokens.createForOAuth)
  const revokeToken = useMutation(api.tokens.revoke)
  const [write, setWrite] = useState(askedWrite)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!handle)
    return (
      <Frame title="This link is not complete">
        <p>Start connecting again from the app that sent you here.</p>
      </Frame>
    )
  if (isLoading || (isAuthenticated && viewer === undefined)) return <Frame title="One moment" />
  if (!isAuthenticated || !viewer)
    return (
      <Frame title={`Sign in to connect ${client}`}>
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
      <Frame title="Dispatchlet is not open yet">
        <p>You are on the launch list. Connecting an assistant works once your account is in.</p>
      </Frame>
    )

  const decide = async (decision: 'approve' | 'deny') => {
    setBusy(true)
    setError(null)
    // The token is made before the provider finishes the grant. If anything after that fails the
    // token would be live with no grant behind it, so it is revoked on the way out.
    let made: { _id: Id<'apiTokens'>; token: string } | undefined
    try {
      if (decision === 'approve')
        made = await createToken({ clientName: client, write: write && askedWrite })
      const response = await fetch('/oauth/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, decision, token: made?.token }),
      })
      const body = (await response.json()) as { redirectTo?: string; error?: string }
      if (!response.ok || !body.redirectTo) throw new Error(body.error ?? 'That did not work.')
      window.location.assign(body.redirectTo)
    } catch (reason) {
      if (made) await revokeToken({ id: made._id }).catch(() => undefined)
      setError(errorText(reason, 'That did not work. Start again from the app.'))
      setBusy(false)
    }
  }

  return (
    <Frame title={`Connect ${client} to Dispatchlet`}>
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
      {askedWrite ? (
        <ul className="app-choices">
          <li data-checked={write}>
            <label>
              <input type="checkbox" checked={write} onChange={(e) => setWrite(e.target.checked)} />
              <span>Also start runs, change playbooks and approve drafts, as it asked to</span>
              <span className="app-muted">Runs count against your allowance like any other.</span>
            </label>
          </li>
        </ul>
      ) : (
        <p className="app-muted">It asked to read only: it cannot start runs or change anything.</p>
      )}
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
          <BusyLabel busy={busy} idle="Allow" working="Connecting" />
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
