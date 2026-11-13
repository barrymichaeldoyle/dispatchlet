import { createFileRoute } from '@tanstack/react-router'
import { AppGate } from '../components/app-gate'
// The app's own styles; public pages load only styles.css.
import appOnlyCss from '../app.css?url'

/**
 * The app, reached from the site's sign-in links; not in the sitemap and not indexed. With
 * SIGNUP_OPEN unset, anyone can sign in with Buffer but only allowlisted accounts get past the
 * gate to the pages under it.
 */
export const Route = createFileRoute('/app')({
  ssr: false,
  component: AppGate,
  // Client-only, so the server sends the first screen sign-in shows rather than a blank page.
  head: () => ({
    meta: [{ title: 'Dispatchlet' }, { name: 'robots', content: 'noindex, nofollow' }],
    links: [{ rel: 'stylesheet', href: appOnlyCss }],
  }),
})
