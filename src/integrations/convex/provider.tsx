import { ConvexProvider } from 'convex/react'
import { ConvexQueryClient } from '@convex-dev/react-query'
import type { ReactNode } from 'react'

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string | undefined

const convexQueryClient = CONVEX_URL ? new ConvexQueryClient(CONVEX_URL) : null

export default function AppConvexProvider({ children }: { children: ReactNode }) {
  if (!convexQueryClient) {
    return <>{children}</>
  }
  return <ConvexProvider client={convexQueryClient.convexClient}>{children}</ConvexProvider>
}
