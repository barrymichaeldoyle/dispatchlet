import { useCallback, useRef, useState, type MouseEvent } from 'react'

/** Matches the exit animation on `.app-leave-dialog[data-closing]` in app.css. */
const EXIT_MS = 120

/**
 * Lets a dialog fade out before it unmounts. Put `data-closing={closing || undefined}` on the
 * dialog and call `close(after)` instead of closing straight away; `after` runs once the dialog has
 * faded, or at once when the person prefers reduced motion. A second call while closing is ignored.
 */
export function useDialogExit() {
  const [closing, setClosing] = useState(false)
  const started = useRef(false)
  const close = useCallback((after: () => void) => {
    if (started.current) return
    started.current = true
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      after()
      return
    }
    setClosing(true)
    window.setTimeout(after, EXIT_MS)
  }, [])
  return [closing, close] as const
}

/**
 * Whether a click on a modal dialog landed on its backdrop. The backdrop's clicks target the dialog
 * itself, and so do clicks on the dialog's own padding, so the point is checked against its box.
 */
export function isBackdropClick(event: MouseEvent<HTMLDialogElement>) {
  if (event.target !== event.currentTarget) return false
  const box = event.currentTarget.getBoundingClientRect()
  return (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  )
}
