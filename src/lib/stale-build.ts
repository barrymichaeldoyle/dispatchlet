/**
 * Each deploy removes the hashed files of the build before it, so a tab opened before a deploy
 * asks for page files that are gone. Reloading the page gets the new build. The reload happens at
 * most once a minute, so a file that is missing after the reload cannot cause a loop.
 */
const RELOADED_AT = 'dispatchlet:stale-build-reload'
const MIN_GAP_MS = 60_000

let reloading = false

/** The messages Chrome, Firefox and Safari give for a module that did not load, and Vite's for CSS. */
export function isStaleBuildError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : undefined
  return (
    message !== undefined &&
    /^(Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS)/.test(
      message,
    )
  )
}

/** Reloads the page, or returns false when it reloaded less than a minute ago. */
export function reloadForNewBuild(): boolean {
  if (reloading) return true
  try {
    const last = Number(sessionStorage.getItem(RELOADED_AT))
    if (last && Date.now() - last < MIN_GAP_MS) return false
    sessionStorage.setItem(RELOADED_AT, String(Date.now()))
  } catch {
    // Without storage there is no guard, so do not reload.
    return false
  }
  reloading = true
  window.location.reload()
  return true
}
