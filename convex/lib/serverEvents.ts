/**
 * Operational events from the backend to PostHog (project Dispatchlet, EU): how Dispatchlet
 * spends the Buffer call budget all users share. No personal data: one fixed distinct id, no
 * person profile, and only operation names, priorities, outcomes and counts. The project key is
 * public by design (the website ships it), so it lives here.
 */
const KEY = 'phc_s9AGQ8tazGPmFnCAxQobzEAYS7Grc6zVAALL4ECivAA4'
const HOST = 'https://eu.i.posthog.com'

/** dev or production, from the deployment Convex says it is running on. */
function environment(): string {
  return process.env.CONVEX_CLOUD_URL?.includes('amiable-mosquito-364') ? 'production' : 'dev'
}

/** Only real deployments report; tests and local runs without a deployment URL stay quiet. */
function enabled(): boolean {
  return (
    Boolean(process.env.CONVEX_CLOUD_URL?.endsWith('.convex.cloud')) &&
    process.env.SERVER_EVENTS !== 'off'
  )
}

/** The GraphQL operation's name, such as DispatchletChannels, or "unnamed". */
export function operationName(document: string): string {
  return /\b(?:query|mutation)\s+(\w+)/.exec(document)?.[1] ?? 'unnamed'
}

/** Sends one event and never throws or waits long: analytics must not slow or break a run. */
export async function serverEvent(event: string, properties: Record<string, unknown>) {
  if (!enabled()) return
  try {
    await fetch(`${HOST}/i/v0/e/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: KEY,
        event,
        distinct_id: 'dispatchlet-server',
        properties: { ...properties, environment: environment(), $process_person_profile: false },
      }),
      signal: AbortSignal.timeout(2000),
    })
  } catch {
    // Dropped: the event is only for dashboards.
  }
}
