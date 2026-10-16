import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type MouseEventHandler,
} from 'react'
import { isValidEmail } from '../../convex/lib/email'
import { track } from '../integrations/posthog/track'
import { WAITLIST_ACTION } from '../lib/waitlist'

type State =
  | { kind: 'open'; error?: string }
  | { kind: 'submitting' }
  | { kind: 'done'; position?: number }

const INVALID = 'That email does not look right.'
const RATE_LIMITED = 'Too many tries, wait a minute.'
const FAILED = 'Something went wrong. Try again in a minute.'

function readAttribution() {
  const params = new URLSearchParams(window.location.search)
  let referrer = ''
  try {
    const host = document.referrer ? new URL(document.referrer).host : ''
    referrer = host && host !== window.location.host ? host : ''
  } catch {
    referrer = ''
  }
  return {
    source: params.get('utm_source') ?? referrer,
    campaign: params.get('utm_campaign') ?? '',
  }
}

const subscribe = () => () => {}

export function WaitlistForm({
  onWatchDemo,
}: {
  onWatchDemo?: MouseEventHandler<HTMLAnchorElement>
}) {
  const enhanced = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
  const [state, setState] = useState<State>({ kind: 'open' })
  const inputRef = useRef<HTMLInputElement>(null)
  const confirmationRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (state.kind === 'done') confirmationRef.current?.focus({ preventScroll: true })
  }, [state.kind])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (state.kind !== 'open') return

    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '')
    if (!isValidEmail(email)) {
      setState({ kind: 'open', error: INVALID })
      inputRef.current?.focus()
      return
    }

    setState({ kind: 'submitting' })
    const attribution = readAttribution()
    try {
      const res = await fetch(WAITLIST_ACTION, {
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          email,
          website: form.get('website') ?? '',
          source: attribution.source,
          campaign: attribution.campaign,
        }),
      })
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean
        position?: number
      } | null
      if (res.ok && body?.ok) {
        setState({ kind: 'done', position: body.position })
        track('waitlist_submitted', {
          position: body.position,
          source: attribution.source || 'direct',
          campaign: attribution.campaign || undefined,
        })
        return
      }
      setState({
        kind: 'open',
        error: res.status === 429 ? RATE_LIMITED : res.status === 400 ? INVALID : FAILED,
      })
    } catch {
      setState({ kind: 'open', error: FAILED })
    }
  }

  return (
    <div className="waitlist-slot">
      {state.kind === 'done' ? (
        <p ref={confirmationRef} tabIndex={-1} className="waitlist-confirmation" role="status">
          {state.position
            ? `You are number ${state.position}. Check your email to confirm.`
            : 'Thanks. Check your email to confirm.'}
        </p>
      ) : (
        <form
          method="post"
          action={WAITLIST_ACTION}
          noValidate={enhanced}
          data-enhanced={enhanced}
          onSubmit={onSubmit}
          aria-label="Join the waiting list"
          aria-busy={state.kind === 'submitting'}
        >
          <label htmlFor="waitlist-email" className="waitlist-label">
            Email
          </label>
          <div className="waitlist-fields">
            <input
              ref={inputRef}
              id="waitlist-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@example.com"
              required
              disabled={state.kind === 'submitting'}
              aria-invalid={state.kind === 'open' && state.error === INVALID ? true : undefined}
              aria-describedby={state.kind === 'open' && state.error ? 'waitlist-error' : undefined}
            />
            <button type="submit" disabled={state.kind === 'submitting'}>
              {state.kind === 'submitting' ? 'Joining…' : 'Join the waiting list'}
            </button>
          </div>
          <p id="waitlist-error" className="waitlist-error" aria-live="polite" aria-atomic="true">
            {state.kind === 'open' && state.error ? state.error : ''}
          </p>
          <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true">
            <label htmlFor="waitlist-website">Website</label>
            <input
              id="waitlist-website"
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
            />
          </div>
        </form>
      )}
      <a href="#run" className="waitlist-demo-link" onClick={onWatchDemo}>
        Watch the demo<span aria-hidden="true"> →</span>
      </a>
    </div>
  )
}
