import { useEffect } from 'react'

/**
 * Names the browser tab after the page, "F1 On This Day | Dispatchlet", once the page knows its
 * name. Screen readers announce the change, and tabs and history entries can be told apart.
 */
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return
    document.title = `${title} | Dispatchlet`
  }, [title])
}
