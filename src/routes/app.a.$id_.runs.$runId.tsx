import { createFileRoute } from '@tanstack/react-router'
import type { Id } from '../../convex/_generated/dataModel'
import { RunPage } from '../components/app-run'
import { MissingItem } from '../components/route-error'

export const Route = createFileRoute('/app/a/$id_/runs/$runId')({
  head: () => ({ meta: [{ title: 'Run | Dispatchlet' }] }),
  component: () => {
    const { id, runId } = Route.useParams()
    return <RunPage id={id as Id<'automations'>} runId={runId as Id<'runs'>} />
  },
  // A malformed id fails the query's argument check while rendering; the sidebar stays up.
  errorComponent: () => <MissingItem what="run" />,
})
