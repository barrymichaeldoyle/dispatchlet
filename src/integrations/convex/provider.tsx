import { ConvexProvider, ConvexReactClient } from 'convex/react'
import type { ReactNode } from 'react'

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string | undefined

const convexClient = CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null

export default function AppConvexProvider({ children }: { children: ReactNode }) {
  if (!convexClient) {
    return <>{children}</>
  }
  return <ConvexProvider client={convexClient}>{children}</ConvexProvider>
}
