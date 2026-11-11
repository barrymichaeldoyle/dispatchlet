import { useSyncExternalStore } from 'react'

/*
 * Whether this tab is signing out. Between the click and Convex Auth settling, the auth state
 * passes through "loading" and "signed in, account still loading", which on their own look like
 * a sign-in on its way. The gate reads this so those moments say "Signing you out" instead.
 */
let leaving = false
const listeners = new Set<() => void>()

export function setLeaving(value: boolean) {
  if (leaving === value) return
  leaving = value
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLeaving(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => leaving,
    () => false,
  )
}
