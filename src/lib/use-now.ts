import { useEffect, useState } from 'react'

/**
 * The time, refreshed every minute, for anything that depends on "now": a Convex query that
 * read Date.now() keeps that answer until its data changes, so a tab left open would go on
 * showing a post as "up next" after it went out, or "Today" after midnight.
 */
export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(timer)
  }, [everyMs])
  return now
}
