import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { reportError } from './integrations/posthog/track'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    // Render errors caught by the router never reach window.onerror, so report them here.
    defaultOnCatch: (error) => reportError(error),
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
