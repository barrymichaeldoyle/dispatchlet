import posthog from 'posthog-js'

export function track(event: string, properties?: Record<string, unknown>) {
  if (typeof window === 'undefined' || !posthog.__loaded) return
  posthog.capture(event, properties)
}
