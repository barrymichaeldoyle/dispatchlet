import { createFileRoute } from '@tanstack/react-router'
import { OAuthConsent } from '../components/oauth-consent'

/** Where an MCP client's sign-in lands: who is asking, for what, Allow or Deny (SPEC §44.7). */
export const Route = createFileRoute('/oauth/consent')({
  ssr: false,
  component: OAuthConsent,
  head: () => ({
    meta: [{ title: 'Connect to Dispatchlet' }, { name: 'robots', content: 'noindex, nofollow' }],
  }),
})
