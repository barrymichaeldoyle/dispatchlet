import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'

const SHOW_FROM = 25

export function WaitlistCount() {
  const count = useQuery(api.waitlist.count)
  if (count === undefined || count < SHOW_FROM) return null
  return <> {count} people are waiting.</>
}
