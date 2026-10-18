import { createFileRoute } from '@tanstack/react-router'
import { AppSettings } from '../components/app-pages'

export const Route = createFileRoute('/app/settings')({
  component: AppSettings,
  head: () => ({ meta: [{ title: 'Settings | Dispatchlet' }] }),
})
