/**
 * Browser error reporting to Sentry (project dispatchlet). The DSN is public by design, so it lives
 * here rather than in build settings. The SDK loads lazily, like analytics, so it never delays the
 * page; errors before it loads are held. No breadcrumbs, no tracing, no replay, no personal data:
 * a report is the error, its stack, the page address without its query, and the browser type.
 */
const DSN = 'https://86d51613502d5a11f3ec6aa7c48d4505@o299144.ingest.us.sentry.io/4512345285263360'

type SentryBrowser = typeof import('@sentry/browser')

let sdk: SentryBrowser | undefined
let loading: Promise<void> | undefined
const pending: unknown[] = []

function allowed(): boolean {
  if (typeof window === 'undefined') return false
  // Same rule as analytics: Do Not Track means nothing is sent.
  return typeof navigator === 'undefined' || navigator.doNotTrack !== '1'
}

/** production on dispatchlet.com, development anywhere else (localhost, previews). */
export function environmentFor(hostname: string): string {
  return hostname === 'dispatchlet.com' || hostname === 'www.dispatchlet.com'
    ? 'production'
    : 'development'
}

/** A page address with its query and fragment removed, so tokens in links never leave. */
export function withoutQuery(url: string): string {
  return url.split(/[?#]/)[0] ?? url
}

export function initializeErrorReporting(): Promise<void> {
  if (!allowed()) return Promise.resolve()
  loading ??= import('@sentry/browser')
    .then((Sentry) => {
      Sentry.init({
        dsn: DSN,
        environment: environmentFor(window.location.hostname),
        defaultIntegrations: false,
        integrations: [
          Sentry.linkedErrorsIntegration(),
          Sentry.dedupeIntegration(),
          Sentry.httpContextIntegration(),
        ],
        tracesSampleRate: 0,
        beforeBreadcrumb: () => null,
        beforeSend(event) {
          if (event.request?.url) event.request.url = withoutQuery(event.request.url)
          if (event.request) delete event.request.query_string
          return event
        },
      })
      sdk = Sentry
      for (const error of pending.splice(0)) Sentry.captureException(error)
    })
    .catch(() => {
      // A blocked download must never break the page.
      loading = undefined
    })
  return loading
}

export function reportToSentry(error: unknown) {
  if (!allowed()) return
  if (sdk) sdk.captureException(error)
  else if (pending.length < 10) pending.push(error)
}
