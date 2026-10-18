import { useEffect, type ReactNode } from 'react'
import { initializeAnalytics, watchErrors } from './track'

export default function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    watchErrors()
  }, [])
  useEffect(() => {
    const start = () => {
      void initializeAnalytics()
    }
    if ('requestIdleCallback' in window) {
      const idle = window.requestIdleCallback(start, { timeout: 2000 })
      return () => window.cancelIdleCallback(idle)
    }
    const timer = globalThis.setTimeout(start, 1000)
    return () => globalThis.clearTimeout(timer)
  }, [])
  return <>{children}</>
}
