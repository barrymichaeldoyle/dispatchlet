import { createFileRoute } from '@tanstack/react-router'
import { AppGate } from '../components/app-gate'
import { Frame } from '../components/oauth-consent'

/**
 * The app. Not linked from the site, not in the sitemap and not indexed. Until the public
 * launch, anyone can sign in with Buffer, but only allowlisted accounts get past the gate to the
 * pages under it; there is no date that opens it automatically.
 */
export const Route = createFileRoute('/app')({
  ssr: false,
  component: AppGate,
  // Client-only, so the server sends the first screen sign-in shows rather than a blank page.
  pendingComponent: () => <Frame title="Signing you in." />,
  head: () => ({
    meta: [{ title: 'Dispatchlet' }, { name: 'robots', content: 'noindex, nofollow' }],
  }),
})
