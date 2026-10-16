import { Component, type ReactNode } from 'react'
import { useQuery } from 'convex/react'
import ConvexProvider from '../integrations/convex/provider'
import { api } from '../../convex/_generated/api'

const SHOW_FROM = 25

function Count() {
  const count = useQuery(api.waitlist.count)
  if (count === undefined || count < SHOW_FROM) return null
  return <> {count} people are waiting.</>
}

class CountBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

export function WaitlistCount() {
  return (
    <CountBoundary>
      <ConvexProvider>
        <Count />
      </ConvexProvider>
    </CountBoundary>
  )
}
