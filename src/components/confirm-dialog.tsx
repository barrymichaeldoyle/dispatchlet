import { useEffect, useId, useRef, type ReactNode } from 'react'
import { BusyLabel } from './busy-label'

/**
 * Asks before a consequential action, in a modal, so the choice is in view wherever the page was
 * scrolled. Use it whenever confirming would reveal text or buttons away from the click; a confirm
 * that swaps in place of a small row action can stay inline (see ConfirmLink).
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  workingLabel,
  cancelLabel = 'Keep it',
  danger = false,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  title: string
  children: ReactNode
  confirmLabel: string
  workingLabel: string
  cancelLabel?: string
  danger?: boolean
  busy: boolean
  error?: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])
  return (
    <dialog
      ref={dialog}
      className="app-leave-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onCancel()
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <div id={descriptionId}>{children}</div>
      {error ? (
        <p className="app-connection-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="app-gate-actions">
        <button
          type="button"
          className="app-gate-secondary"
          autoFocus
          disabled={busy}
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={danger ? 'app-gate-danger' : 'app-gate-primary'}
          disabled={busy}
          aria-busy={busy}
          onClick={onConfirm}
        >
          <BusyLabel busy={busy} idle={confirmLabel} working={workingLabel} />
        </button>
      </div>
    </dialog>
  )
}
