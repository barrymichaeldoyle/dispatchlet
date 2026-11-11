import { createFileRoute } from '@tanstack/react-router'
import type { Id } from '../../convex/_generated/dataModel'
import { AutomationPage } from '../components/app-automation'
import { MissingItem } from '../components/route-error'

export const Route = createFileRoute('/app/a/$id')({
  head: () => ({ meta: [{ title: 'Automation | Dispatchlet' }] }),
  component: () => {
    const { id } = Route.useParams()
    return <AutomationPage id={id as Id<'automations'>} />
  },
  // A malformed id fails the query's argument check while rendering; the sidebar stays up.
  errorComponent: () => <MissingItem what="automation" />,
})
