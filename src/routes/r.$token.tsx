import { createFileRoute } from '@tanstack/react-router'
import { SharedRun } from '../components/app-run'

/** A run someone shared by link. Readable by anyone, never indexed. */
export const Route = createFileRoute('/r/$token')({
  ssr: false,
  component: () => {
    const { token } = Route.useParams()
    return <SharedRun token={token} />
  },
  head: () => ({
    meta: [{ title: 'A Dispatchlet run' }, { name: 'robots', content: 'noindex, nofollow' }],
  }),
})
