import { createFileRoute } from '@tanstack/react-router'
import type { Id } from '../../convex/_generated/dataModel'
import { AutomationPage } from '../components/app-automation'
import { MissingItem } from '../components/route-error'

const TABS = new Set(['schedule', 'runs'])

export const Route = createFileRoute('/app/a/$id')({
  // ?tab=schedule or ?tab=runs; anything else is the playbook.
  validateSearch: (search: Record<string, unknown>): { tab?: 'schedule' | 'runs' } =>
    typeof search.tab === 'string' && TABS.has(search.tab)
      ? { tab: search.tab as 'schedule' | 'runs' }
      : {},
  head: () => ({ meta: [{ title: 'Automation | Dispatchlet' }] }),
  component: () => {
    const { id } = Route.useParams()
    return <AutomationPage key={id} id={id as Id<'automations'>} />
  },
  // A malformed id fails the query's argument check while rendering; the sidebar stays up.
  errorComponent: () => <MissingItem what="automation" />,
})
