import { createFileRoute } from '@tanstack/react-router'
import { AppGate } from '../components/app-gate'

/**
 * The app. Not linked from the site, not in the sitemap and not indexed. Until the public
 * launch, anyone can sign in with Buffer, but only allowlisted accounts get past the gate to the
 * pages under it; there is no date that opens it automatically.
 */
export const Route = createFileRoute('/app')({
  ssr: false,
  component: AppGate,
  head: () => ({
    meta: [{ title: 'Dispatchlet' }, { name: 'robots', content: 'noindex, nofollow' }],
  }),
})
