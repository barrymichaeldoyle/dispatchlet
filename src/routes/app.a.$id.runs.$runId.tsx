import { createFileRoute } from '@tanstack/react-router'
import type { Id } from '../../convex/_generated/dataModel'
import { RunPage } from '../components/app-run'

export const Route = createFileRoute('/app/a/$id/runs/$runId')({
  component: () => {
    const { id, runId } = Route.useParams()
    return <RunPage id={id as Id<'automations'>} runId={runId as Id<'runs'>} />
  },
})
