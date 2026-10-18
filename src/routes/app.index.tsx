import { createFileRoute } from '@tanstack/react-router'
import { AppHome } from '../components/app-pages'

export const Route = createFileRoute('/app/')({
  component: AppHome,
})
