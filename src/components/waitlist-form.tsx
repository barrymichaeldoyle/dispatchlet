import { useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import { isValidEmail } from '../../convex/lib/email'
import { track } from '../integrations/posthog/track'
import { WAITLIST_ACTION } from '../lib/waitlist'

type State =
  | { kind: 'idle' }
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

export function WaitlistForm() {
  const enhanced = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
  const [state, setState] = useState<State>({ kind: 'idle' })
  const inputRef = useRef<HTMLInputElement>(null)

  const open = state.kind === 'open' || state.kind === 'submitting'

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (state.kind === 'idle') {
      setState({ kind: 'open' })
      requestAnimationFrame(() => inputRef.current?.focus())
      return
    }
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

  if (state.kind === 'done') {
    return (
      <p className="m-0 flex min-h-43 items-start pt-2 text-[15px] sm:min-h-30" role="status">
        {state.position
          ? `You are number ${state.position}. Check your email to confirm.`
          : 'Thanks. Check your email to confirm.'}
      </p>
    )
  }

  return (
    <form
      method="post"
      action={WAITLIST_ACTION}
      noValidate={enhanced}
      data-enhanced={enhanced}
      onSubmit={onSubmit}
      className="flex flex-col gap-2"
    >
      <div className="flex min-h-36 content-start flex-col gap-3 sm:min-h-23 sm:flex-row sm:flex-wrap">
        <label htmlFor="waitlist-email" className="sr-only">
          Email
        </label>
        <input
          ref={inputRef}
          id="waitlist-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="Your email"
          required
          hidden={enhanced && !open}
          disabled={state.kind === 'submitting'}
          aria-invalid={state.kind === 'open' && state.error ? true : undefined}
          aria-describedby={state.kind === 'open' && state.error ? 'waitlist-error' : undefined}
          className="h-10 w-full border border-ink bg-paper px-3 text-base text-ink placeholder:text-muted sm:w-72 sm:text-[15px]"
        />
        <button
          type="submit"
          disabled={state.kind === 'submitting'}
          className="h-10 w-full bg-pine px-5 text-[15px] font-medium text-paper disabled:cursor-default sm:w-auto"
        >
          {state.kind === 'submitting' ? 'Joining' : 'Join the waiting list'}
        </button>
        <a
          href="#run"
          className="inline-flex h-10 w-full items-center justify-center border border-ink px-4 text-[15px] font-medium text-ink no-underline sm:w-auto"
        >
          See an example run
        </a>
      </div>
      <p id="waitlist-error" className="m-0 min-h-5 text-sm" aria-live="polite">
        {state.kind === 'open' && state.error ? state.error : ''}
      </p>
      <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor="waitlist-website">Website</label>
        <input id="waitlist-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
    </form>
  )
}
