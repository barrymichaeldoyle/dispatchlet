import { createFileRoute } from '@tanstack/react-router'
import { Frame, OAuthConsent } from '../components/oauth-consent'

/** Where an MCP client's sign-in lands: who is asking, for what, Allow or Deny (SPEC §44.7). */
export const Route = createFileRoute('/oauth/consent')({
  ssr: false,
  component: OAuthConsent,
  // The page is client-only (it needs the browser's sign-in), so the server sends this instead
  // of an empty screen while the script loads.
  pendingComponent: () => <Frame title="One moment." />,
  head: () => ({
    meta: [{ title: 'Connect to Dispatchlet' }, { name: 'robots', content: 'noindex, nofollow' }],
  }),
})
