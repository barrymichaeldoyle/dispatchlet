/**
 * Browser error reporting to Sentry (project dispatchlet). The DSN is public by design, so it lives
 * here rather than in build settings. The SDK loads lazily, like analytics, so it never delays the
 * page; errors before it loads are held. No breadcrumbs, no tracing, no replay, no personal data:
 * a report is the error, its stack, the page address without its query, and the browser type.
 */
import { checkForNewBuild } from '../../lib/build-version'

const DSN = 'https://86d51613502d5a11f3ec6aa7c48d4505@o299144.ingest.us.sentry.io/4512345285263360'

type SentryBrowser = typeof import('./sdk')

let sdk: SentryBrowser | undefined
let loading: Promise<void> | undefined
const pending: unknown[] = []

/**
 * A local dev server reports nothing. Editing a file while its page is open makes the server and
 * the browser render different text, and each hot reload sent a hydration error that was not a bug.
 */
export function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function allowed(): boolean {
  if (typeof window === 'undefined') return false
  if (isLocalHost(window.location.hostname)) return false
  // Same rule as analytics: Do Not Track means nothing is sent.
  return typeof navigator === 'undefined' || navigator.doNotTrack !== '1'
}

/** production on dispatchlet.com, development anywhere else (previews). */
export function environmentFor(hostname: string): string {
  return hostname === 'dispatchlet.com' || hostname === 'www.dispatchlet.com'
    ? 'production'
    : 'development'
}

/** A page address with its query and fragment removed, so tokens in links never leave. */
export function withoutQuery(url: string): string {
  return url.split(/[?#]/)[0] ?? url
}

/**
 * A deploy replaces the hashed files, so a tab opened before it asks for ones that are gone. The
 * router reloads the page when a page's code fails to load (lazyRouteComponent), which fixes it;
 * a report would only be noise. Browsers word it differently: Chrome, Firefox, Safari.
 */
export function isStaleBuildError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(
    message,
  )
}

export function initializeErrorReporting(): Promise<void> {
  if (!allowed()) return Promise.resolve()
  loading ??= import('./sdk')
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
  if (!allowed() || isStaleBuildError(error)) return
  // A tab behind a deploy that trips over data in a newer shape is not a bug in the live code;
  // the error page reloads it onto the new build (components/route-error.tsx).
  void checkForNewBuild(true).then((behind) => {
    if (behind) return
    if (sdk) sdk.captureException(error)
    else if (pending.length < 10) pending.push(error)
  })
}
