/**
 * Whether a newer build of the site has been deployed since this tab loaded. A tab left open for
 * days keeps running the code it loaded with, while Convex sends it data in the newest shape, so
 * an old tab eventually reads a field that is gone and crashes (and asks for code files the deploy
 * removed). The tab asks the Worker which build is live (/version) when it comes back into view
 * and every so often while open; once it is behind, the next page change is a full page load, and
 * a page that crashes reloads instead of showing the error. Never in the middle of an edit: a page
 * change already passed the editor's "leave without saving?" question, and a crashed page has no
 * edit left to lose.
 */

declare const __BUILD_ID__: string | undefined

/** This tab's build, set by vite.config.ts; the same id the Worker built alongside it reports. */
const BUILD_ID: string =
  typeof __BUILD_ID__ === 'string' && !import.meta.env.DEV ? __BUILD_ID__ : 'dev'

const CHECK_EVERY_MS = 10 * 60_000
/** Even when asked outright (an error), at most this often, so a burst of errors is one request. */
const FORCED_GAP_MS = 30_000
/** Remembers which build a reload went to, so a mismatch that a reload can't fix never loops. */
const RELOADED_FOR = 'dispatchlet:reloaded-for-build'

let live: string | undefined
/** A tab that just loaded has the live build, so the first question can wait an interval. */
let lastCheck = Date.now()
let checking: Promise<boolean> | undefined

/** Whether the live build is known to be newer than this tab's. */
function isBehind(): boolean {
  return live !== undefined && live !== BUILD_ID
}

/** Asks the Worker which build is live, at most once per interval, or per 30 seconds if forced. */
export function checkForNewBuild(force = false): Promise<boolean> {
  if (isBehind()) return Promise.resolve(true)
  if (BUILD_ID === 'dev') return Promise.resolve(false)
  if (Date.now() - lastCheck < (force ? FORCED_GAP_MS : CHECK_EVERY_MS))
    return Promise.resolve(false)
  checking ??= fetch('/version', { cache: 'no-store' })
    .then((response) => (response.ok ? (response.json() as Promise<{ build?: unknown }>) : null))
    .then((body) => {
      lastCheck = Date.now()
      if (typeof body?.build === 'string' && body.build) live = body.build
      return isBehind()
    })
    // Offline or blocked: try again next time.
    .catch(() => false)
    .finally(() => {
      checking = undefined
    })
  return checking
}

/** Loads the page again on the new build, once per build. Returns whether it is reloading. */
export function reloadOntoNewBuild(href = window.location.href): boolean {
  if (!isBehind()) return false
  try {
    if (sessionStorage.getItem(RELOADED_FOR) === live) return false
    sessionStorage.setItem(RELOADED_FOR, live!)
  } catch {
    // Storage blocked: still reload; the server sends the live build either way.
  }
  window.location.assign(href)
  return true
}

type NavigationSource = {
  subscribe(
    event: 'onResolved',
    listener: (event: { pathChanged: boolean; toLocation: { href: string } }) => void,
  ): () => void
}

/** Starts watching for deploys in the browser: on return to the tab, on a timer, on page change. */
export function watchForNewBuild(router: NavigationSource): void {
  if (typeof window === 'undefined' || BUILD_ID === 'dev') return
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForNewBuild()
  })
  window.setInterval(() => {
    if (document.visibilityState === 'visible') void checkForNewBuild()
  }, CHECK_EVERY_MS)
  router.subscribe('onResolved', ({ pathChanged, toLocation }) => {
    if (pathChanged && isBehind()) reloadOntoNewBuild(toLocation.href)
  })
}
