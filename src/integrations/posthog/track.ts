import type { PostHog } from 'posthog-js/dist/module.slim'

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
        api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
        person_profiles: 'identified_only',
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

export function track(name: string, properties?: Record<string, unknown>) {
  if (typeof window === 'undefined' || !import.meta.env.VITE_POSTHOG_KEY) return
  if (client) client.capture(name, properties)
  else if (pending.length < 20) pending.push({ name, properties })
}
