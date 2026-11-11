import { createFileRoute } from '@tanstack/react-router'
import { AppSettings } from '../components/app-pages'

export const Route = createFileRoute('/app/settings')({
  // ?tab=developers for tokens, assistants, webhooks and hooks; anything else is General.
  validateSearch: (search: Record<string, unknown>): { tab?: 'developers' } =>
    search.tab === 'developers' ? { tab: 'developers' } : {},
  component: AppSettings,
  head: () => ({ meta: [{ title: 'Settings | Dispatchlet' }] }),
})
