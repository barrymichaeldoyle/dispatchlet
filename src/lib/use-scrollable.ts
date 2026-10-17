import { useEffect, useState } from 'react'

/**
 * Whether an element can scroll right now. Scroll containers only need to be tab stops when
 * there is something to scroll to, so keyboard users are not sent through empty stops.
 * Returns a callback ref and the current answer.
 */
export function useScrollable<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null)
  const [scrollable, setScrollable] = useState(false)
  useEffect(() => {
    if (!element) return
    const check = () => setScrollable(element.scrollHeight > element.clientHeight + 1)
    // ResizeObserver reports once as soon as it starts, so the first answer needs no sync update.
    // Content changes that leave the box the same size are caught by the MutationObserver.
    const resize = new ResizeObserver(check)
    resize.observe(element)
    const content = new MutationObserver(check)
    content.observe(element, { childList: true, subtree: true })
    return () => {
      resize.disconnect()
      content.disconnect()
    }
  }, [element])
  return [setElement, scrollable] as const
}
