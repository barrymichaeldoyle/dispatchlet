import { createFileRoute } from '@tanstack/react-router'
import { AppGate } from '../components/app-gate'

/**
 * The app's front door. Not linked from the site, not in the sitemap and not indexed. Until
 * launch, anyone can sign in with Buffer, but only allowlisted accounts get past it.
 */
export const Route = createFileRoute('/app')({
  ssr: false,
  component: AppGate,
  head: () => ({
    meta: [{ title: 'Dispatchlet' }, { name: 'robots', content: 'noindex, nofollow' }],
  }),
})
