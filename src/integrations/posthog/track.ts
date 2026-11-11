import type { PostHog } from 'posthog-js/dist/module.slim'
import { isStaleBuildError, reloadForNewBuild } from '../../lib/stale-build'
import { initializeErrorReporting, reportToSentry } from '../sentry/errors'

type Event = { name: string; properties?: Record<string, unknown> }
const pending: Event[] = []
let client: PostHog | undefined
let initializing: Promise<void> | undefined

/** Analytics stays outside the rendering path; early funnel events wait for the SDK. */
export function initializeAnalytics(): Promise<void> {
  if (typeof window === 'undefined' || !import.meta.env.VITE_POSTHOG_KEY) return Promise.resolve()
  initializing ??= import('posthog-js/dist/module.slim')
    .then(({ default: posthog }) => {
      posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
        // The Dispatchlet project lives in PostHog's EU cloud; the US host silently drops its events.
        api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com',
        person_profiles: 'identified_only',
        // No cookie or local storage, so the privacy policy can promise nothing is kept on the device.
        persistence: 'memory',
        capture_pageview: false,
        autocapture: false,
        disable_session_recording: true,
        disable_surveys: true,
        advanced_disable_flags: true,
        disable_external_dependency_loading: true,
        respect_dnt: true,
        defaults: '2025-11-30',
      })
      client = posthog
      for (const event of pending.splice(0)) client.capture(event.name, event.properties)
    })
    .catch(() => {
      // A blocked analytics download must never interrupt signup or the walkthrough.
      pending.length = 0
      initializing = undefined
    })
  return initializing
}

/**
 * Reports an error to Sentry (errors live there; PostHog is analytics only): the message, stack
 * and page, never form contents. Errors before the SDK has loaded are held. A page file that a
 * deploy removed is not a bug: the page reloads instead, and only a reload that did not fix it
 * is reported.
 */
export function reportError(error: unknown) {
  if (isStaleBuildError(error) && reloadForNewBuild()) return
  reportToSentry(error)
}

/** Uncaught errors and rejected promises anywhere on the page go to error tracking. */
let watching = false

export function watchErrors() {
  if (typeof window === 'undefined' || watching) return
  watching = true
  void initializeErrorReporting()
  window.addEventListener('error', (event) => reportError(event.error ?? event.message))
  window.addEventListener('unhandledrejection', (event) => reportError(event.reason))
  // Vite fires this before the failed import rejects, so the reload starts before anything renders.
  window.addEventListener('vite:preloadError', reloadForNewBuild)
}

export function track(name: string, properties?: Record<string, unknown>) {
  if (typeof window === 'undefined' || !import.meta.env.VITE_POSTHOG_KEY) return
  if (client) client.capture(name, properties)
  else if (pending.length < 20) pending.push({ name, properties })
}
