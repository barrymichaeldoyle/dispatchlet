import { useParams } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { errorText } from '../lib/format'
import { BusyLabel } from './busy-label'

type Category = 'bug' | 'idea' | 'general'

export type FeedbackPrefill = {
  category?: Category
  message?: string
  /** Set when the assistant prepared the request; the reply is offered as optional context. */
  assistant?: {
    automationId: Id<'automations'>
    automationName: string
    turnId: Id<'automationChatTurns'>
  }
}

const MAX_CHARACTERS = 2_000
const FeedbackContext = createContext<((prefill?: FeedbackPrefill) => void) | null>(null)

/** Opens the feedback form from anywhere in the app, optionally prefilled. */
export function useFeedback() {
  const open = useContext(FeedbackContext)
  if (!open) throw new Error('useFeedback needs a FeedbackProvider')
  return open
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  // Each opening is a fresh form; the key resets its state and request ID.
  const [form, setForm] = useState<{ key: number; prefill: FeedbackPrefill } | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const open = useCallback((prefill: FeedbackPrefill = {}) => {
    returnFocus.current = document.activeElement as HTMLElement | null
    setForm((current) => ({ key: (current?.key ?? 0) + 1, prefill }))
  }, [])
  const close = useCallback(() => {
    setForm(null)
    requestAnimationFrame(() => returnFocus.current?.focus())
  }, [])
  return (
    <FeedbackContext.Provider value={open}>
      {children}
      {form ? <FeedbackDialog key={form.key} prefill={form.prefill} onClose={close} /> : null}
    </FeedbackContext.Provider>
  )
}

export function SendFeedbackButton({
  className,
  children,
}: {
  className?: string
  /** Shown before the label, such as an icon. */
  children?: ReactNode
}) {
  const open = useFeedback()
  return (
    <button type="button" className={className ?? 'app-link'} onClick={() => open()}>
      {children}
      Send feedback
    </button>
  )
}

const newRequestId = () => crypto.randomUUID()

function FeedbackDialog({ prefill, onClose }: { prefill: FeedbackPrefill; onClose: () => void }) {
  const submit = useMutation(api.feedback.submit)
  // Context the current page could offer: its automation and run, never attached by default.
  const params = useParams({ strict: false }) as { id?: Id<'automations'>; runId?: Id<'runs'> }
  const automationId = prefill.assistant?.automationId ?? params.id
  const page = useQuery(api.automations.get, automationId ? { id: automationId } : 'skip')
  const automationName = prefill.assistant?.automationName ?? page?.name ?? null
  const runId = prefill.assistant ? undefined : params.runId
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const messageId = useId()
  const countId = useId()
  const [category, setCategory] = useState<Category>(prefill.category ?? 'general')
  const [message, setMessage] = useState(prefill.message ?? '')
  const [includeAutomation, setIncludeAutomation] = useState(Boolean(prefill.assistant))
  const [includeRun, setIncludeRun] = useState(false)
  const [state, setState] = useState<'editing' | 'sending' | 'sent'>('editing')
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<{ id: string; duplicate: boolean } | null>(null)
  // A retry of the same words keeps its request ID, so an uncertain send is never stored twice.
  const attempt = useRef<{ requestId: string; text: string } | null>(null)
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])

  const text = message.trim()
  const send = async () => {
    if (state !== 'editing' || !text || text.length > MAX_CHARACTERS) return
    if (attempt.current?.text !== text) attempt.current = { requestId: newRequestId(), text }
    setState('sending')
    setError(null)
    try {
      const withAutomation = includeAutomation && automationId && automationName
      const result = await submit({
        requestId: attempt.current.requestId,
        category,
        message: text,
        source: prefill.assistant ? 'assistant' : 'app',
        automationId: withAutomation ? automationId : undefined,
        chatTurnId: withAutomation && prefill.assistant ? prefill.assistant.turnId : undefined,
        runId: withAutomation && includeRun && runId ? runId : undefined,
      })
      setReceipt({ id: result.id, duplicate: result.duplicate })
      setState('sent')
    } catch (reason) {
      setState('editing')
      setError(errorText(reason, 'Your feedback was not sent. Please try again.'))
    }
  }

  return (
    <dialog
      ref={dialog}
      className="app-leave-dialog app-feedback-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        if (state !== 'sending') onClose()
      }}
    >
      {state === 'sent' && receipt ? (
        <>
          <h2 id={titleId}>Thank you</h2>
          <p role="status">
            {receipt.duplicate
              ? 'We already had this from you, so nothing new was sent.'
              : 'Your feedback is saved. We read every message.'}{' '}
            Reference <span className="tabular">{receipt.id.slice(-8)}</span>.
          </p>
          <div className="app-gate-actions">
            <button type="button" className="app-gate-primary" autoFocus onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : (
        <form
          className="app-form"
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <h2 id={titleId}>{prefill.assistant ? 'Request this feature' : 'Send feedback'}</h2>
          <fieldset>
            <legend>What is it about?</legend>
            <div className="app-form-row">
              {(
                [
                  ['bug', 'Something is wrong'],
                  ['idea', 'A feature idea'],
                  ['general', 'Something else'],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="app-radio">
                  <input
                    type="radio"
                    name="feedback-category"
                    checked={category === value}
                    onChange={() => setCategory(value)}
                  />{' '}
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <label htmlFor={messageId}>
            <span>{prefill.assistant ? 'Edit the request before sending' : 'Your message'}</span>
          </label>
          <textarea
            id={messageId}
            rows={6}
            value={message}
            maxLength={MAX_CHARACTERS}
            readOnly={state === 'sending'}
            aria-describedby={countId}
            autoFocus
            onChange={(event) => setMessage(event.target.value)}
          />
          <span id={countId} className="app-muted app-feedback-count tabular">
            {message.length.toLocaleString('en-GB')} / {MAX_CHARACTERS.toLocaleString('en-GB')}
          </span>
          {automationId && automationName ? (
            <fieldset>
              <legend>Context</legend>
              <label className="app-radio">
                <input
                  type="checkbox"
                  checked={includeAutomation}
                  onChange={(event) => setIncludeAutomation(event.target.checked)}
                />{' '}
                Include a reference to the automation “{automationName}”
                {prefill.assistant ? ' and the assistant reply this came from' : ''}
              </label>
              {runId && includeAutomation ? (
                <label className="app-radio">
                  <input
                    type="checkbox"
                    checked={includeRun}
                    onChange={(event) => setIncludeRun(event.target.checked)}
                  />{' '}
                  Include a reference to this run
                </label>
              ) : null}
              <p className="app-muted">
                Only your message, the automation name and these references are stored. Your
                conversation, keys and post text are not attached.
              </p>
            </fieldset>
          ) : null}
          {error ? (
            <p className="app-connection-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="app-gate-actions">
            <button
              type="button"
              className="app-gate-secondary"
              disabled={state === 'sending'}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="app-gate-primary"
              disabled={state === 'sending' || !text}
              aria-busy={state === 'sending'}
            >
              <BusyLabel busy={state === 'sending'} idle="Send" working="Sending" />
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}
