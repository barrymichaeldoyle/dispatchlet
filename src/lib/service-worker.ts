/**
 * Registers the service worker. The app renders after the page's load event has fired, so this
 * registers straight away rather than waiting for it. Nothing depends on the worker being there.
 */
export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}
