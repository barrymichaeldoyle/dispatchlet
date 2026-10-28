import { createFileRoute } from '@tanstack/react-router'
import { NewAutomation } from '../components/app-setup'

export const Route = createFileRoute('/app/new')({
  component: NewAutomation,
})
