import { createFileRoute } from '@tanstack/react-router'
import type { Id } from '../../convex/_generated/dataModel'
import { AutomationPage } from '../components/app-automation'

export const Route = createFileRoute('/app/a/$id')({
  component: () => {
    const { id } = Route.useParams()
    return <AutomationPage id={id as Id<'automations'>} />
  },
})
