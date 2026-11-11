import { createFileRoute } from '@tanstack/react-router'
import { OAuthConsent } from '../components/oauth-consent'
// The app's own styles; public pages load only styles.css.
import appOnlyCss from '../app.css?url'

/** Where an MCP client's sign-in lands: who is asking, for what, Allow or Deny (SPEC §44.7). */
export const Route = createFileRoute('/oauth/consent')({
  ssr: false,
  component: OAuthConsent,
  head: () => ({
    meta: [{ title: 'Connect to Dispatchlet' }, { name: 'robots', content: 'noindex, nofollow' }],
    links: [{ rel: 'stylesheet', href: appOnlyCss }],
  }),
})
