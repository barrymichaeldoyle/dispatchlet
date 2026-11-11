import { useMutation, useQuery } from 'convex/react'
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { errorText } from '../lib/format'
import { diffHunks, lineDiff } from '../lib/line-diff'
import { BusyLabel } from './busy-label'
import { useFeedback } from './feedback'

type Automation = {
  _id: Id<'automations'>
  name: string
  status: string
  revision: number
  playbook: unknown
  allowance: { ownKey: boolean; dryRunsLeft: number | null } | null
}

type Conversation = NonNullable<ReturnType<typeof useQuery<typeof api.automationChat.get>>>
type Turn = Conversation['turns'][number]

const newRequestId = () => crypto.randomUUID()

const EXAMPLES = [
  'Make the tone less formal',
  'Run weekly on Mondays at 07:00 instead of daily',
  'Leave posts as drafts so I can approve them',
]

/**
 * "Ask for changes": a conversation that prepares reviewable proposals. Nothing in here changes
 * the automation until the person presses Apply on a proposal; the server enforces the same.
 */
export function AutomationAssistant({
  automation,
  onDryRun,
  dryRunDisabled,
  panelId,
}: {
  automation: Automation
  onDryRun: () => void
  dryRunDisabled: boolean
  panelId: string
}) {
  const openConversation = useMutation(api.automationChat.open)
  const clear = useMutation(api.automationChat.clear)
  const [conversationId, setConversationId] = useState<Id<'automationConversations'> | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  const composer = useRef<HTMLTextAreaElement>(null)
  const [composerText, setComposerText] = useState('')
  const ready = Boolean(automation.playbook) && automation.status !== 'generating'

  useEffect(() => {
    if (!ready) return
    let current = true
    openConversation({ automationId: automation._id })
      .then((id) => current && setConversationId(id))
      .catch(
        (reason) =>
          current &&
          setProblem(errorText(reason, 'The assistant could not be opened. Reload the page.')),
      )
    return () => {
      current = false
    }
  }, [automation._id, openConversation, ready])

  const conversation = useQuery(
    api.automationChat.get,
    conversationId ? { id: conversationId } : 'skip',
  )

  const startOver = async () => {
    if (!conversationId) return
    const old = conversationId
    setClearing(true)
    setProblem(null)
    // Stop reading the old conversation first; it no longer exists once cleared.
    setConversationId(null)
    try {
      await clear({ id: old })
      setConfirmClear(false)
    } catch (reason) {
      setProblem(errorText(reason, 'The conversation was not cleared.'))
    }
    try {
      // Open again either way: a fresh conversation after clearing, or the old one if it stayed.
      setConversationId(await openConversation({ automationId: automation._id }))
    } catch (reason) {
      setProblem(errorText(reason, 'The assistant could not be opened. Reload the page.'))
    } finally {
      setClearing(false)
    }
  }

  const suggest = (text: string) => {
    setComposerText(text)
    requestAnimationFrame(() => {
      composer.current?.focus()
      composer.current?.setSelectionRange(text.length, text.length)
    })
  }

  return (
    <section
      id={panelId}
      className="app-section app-assistant"
      aria-labelledby={`${panelId}-title`}
    >
      <div className="app-section-head">
        <h2 id={`${panelId}-title`}>Ask for changes</h2>
        {conversation?.turns.length ? (
          confirmClear ? (
            <span className="app-gate-actions">
              <span className="app-muted">Clear the conversation and its unapplied proposals?</span>
              <button
                type="button"
                className="app-link"
                disabled={clearing}
                onClick={() => void startOver()}
              >
                <BusyLabel busy={clearing} idle="Clear it" working="Clearing" />
              </button>
              <button type="button" className="app-link" onClick={() => setConfirmClear(false)}>
                Keep it
              </button>
            </span>
          ) : (
            <button type="button" className="app-link" onClick={() => setConfirmClear(true)}>
              Start over
            </button>
          )
        ) : null}
      </div>
      <p className="app-muted">
        Describe what you want in your own words. The assistant prepares a proposal you can review;
        nothing changes until you apply it. Messages do not use your runs.
      </p>
      {!ready ? (
        <p className="app-muted">The assistant is available once the playbook is written.</p>
      ) : problem ? (
        <p className="app-connection-error" role="alert">
          {problem}
        </p>
      ) : !conversation ? (
        <p className="app-muted">Loading.</p>
      ) : (
        <>
          {conversation.turns.length ? (
            <ol className="app-chat" aria-label="Conversation">
              {conversation.turns.map((turn, index) => (
                <TurnView
                  key={turn.id}
                  turn={turn}
                  latest={index === conversation.turns.length - 1}
                  automation={automation}
                  onSuggest={suggest}
                  onDryRun={onDryRun}
                  dryRunDisabled={dryRunDisabled}
                  composer={composer}
                />
              ))}
            </ol>
          ) : (
            <div className="app-chat-empty">
              <p className="app-muted">For example:</p>
              <ul>
                {EXAMPLES.map((example) => (
                  <li key={example}>
                    <button type="button" className="app-link" onClick={() => suggest(example)}>
                      {example}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Announcer turns={conversation.turns} />
          <Composer
            conversation={conversation}
            text={composerText}
            setText={setComposerText}
            textarea={composer}
          />
        </>
      )}
    </section>
  )
}

/** Announces only state changes of the newest turn, so screen readers hear replies arrive. */
function Announcer({ turns }: { turns: Turn[] }) {
  const last = turns[turns.length - 1]
  const message = !last
    ? ''
    : last.status === 'pending'
      ? 'The assistant is preparing a reply.'
      : last.status === 'failed'
        ? 'The assistant could not reply. Your automation was not changed.'
        : last.kind === 'proposal'
          ? 'A proposal is ready for review. It has not been applied.'
          : last.kind === 'clarification'
            ? 'The assistant has a question.'
            : 'The assistant replied.'
  return (
    <p className="visually-hidden" role="status" aria-live="polite">
      {message}
    </p>
  )
}

function Composer({
  conversation,
  text,
  setText,
  textarea,
}: {
  conversation: Conversation
  text: string
  setText: (text: string) => void
  textarea: RefObject<HTMLTextAreaElement | null>
}) {
  const send = useMutation(api.automationChat.send)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // An uncertain send of the same words reuses its request ID: the server returns the same turn.
  const attempt = useRef<{ requestId: string; text: string } | null>(null)
  const inputId = useId()
  const hintId = useId()
  const { limits, turns } = conversation
  const pending = turns.some((turn) => turn.status === 'pending')
  const full = limits.turnsLeft <= 0
  const outOfDay = limits.dailyTurnsLeft <= 0
  const trimmed = text.trim()
  const blocked = pending || full || outOfDay
  const tooLong = trimmed.length > limits.messageCharacters

  const submit = async () => {
    if (sending || blocked || !trimmed || tooLong) return
    if (attempt.current?.text !== trimmed)
      attempt.current = { requestId: newRequestId(), text: trimmed }
    setSending(true)
    setError(null)
    try {
      await send({ id: conversation.id, requestId: attempt.current.requestId, message: trimmed })
      attempt.current = null
      setText('')
    } catch (reason) {
      setError(errorText(reason, 'Your message was not sent. Please try again.'))
    } finally {
      setSending(false)
    }
  }

  return (
    <form
      className="app-form app-chat-composer"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <label htmlFor={inputId}>
        <span>{turns.length ? 'Reply or refine' : 'What would you like to change?'}</span>
      </label>
      <textarea
        ref={textarea}
        id={inputId}
        rows={3}
        value={text}
        maxLength={limits.messageCharacters}
        aria-describedby={hintId}
        readOnly={sending}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void submit()
          }
        }}
      />
      <p id={hintId} className="app-muted app-chat-hint">
        {full
          ? 'This conversation is full. Start over to begin a new one.'
          : outOfDay
            ? 'You have used today’s assistant messages. Try again tomorrow, or edit the playbook and schedule yourself.'
            : pending
              ? 'Waiting for the assistant’s reply.'
              : `Enter sends, Shift+Enter adds a line. ${limits.dailyTurnsLeft} ${
                  limits.dailyTurnsLeft === 1 ? 'message' : 'messages'
                } left today.`}
      </p>
      {error ? (
        <p className="app-connection-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="app-gate-actions">
        <button
          type="submit"
          className="app-gate-primary"
          disabled={sending || blocked || !trimmed || tooLong}
          aria-busy={sending}
        >
          <BusyLabel busy={sending} idle="Send" working="Sending" />
        </button>
      </div>
    </form>
  )
}

const FAILURE_WORDS: Record<string, string> = {
  service: 'The assistant is unavailable right now.',
  declined: 'The assistant could not help with that request.',
  invalid_response: 'The assistant’s reply could not be used.',
  conflict: 'The automation changed while the assistant was working.',
  expired: 'The assistant took too long.',
}

function TurnView({
  turn,
  latest,
  automation,
  onSuggest,
  onDryRun,
  dryRunDisabled,
  composer,
}: {
  turn: Turn
  latest: boolean
  automation: Automation
  onSuggest: (text: string) => void
  onDryRun: () => void
  dryRunDisabled: boolean
  composer: RefObject<HTMLTextAreaElement | null>
}) {
  const feedback = useFeedback()
  return (
    <li className="app-chat-turn">
      <div className="app-chat-message is-user">
        <span className="visually-hidden">You: </span>
        {turn.userText}
      </div>
      {turn.status === 'pending' ? (
        <div className="app-chat-message is-assistant app-working">
          <span className="flow-spinner" aria-hidden="true" />
          <span>Thinking about your request.</span>
        </div>
      ) : (
        <div
          className="app-chat-message is-assistant"
          data-kind={turn.status === 'failed' ? 'failed' : (turn.kind ?? 'answer')}
        >
          <span className="visually-hidden">Assistant: </span>
          {turn.status === 'failed' ? (
            <>
              <p className="app-chat-failure">
                {FAILURE_WORDS[turn.errorCode ?? 'service'] ?? FAILURE_WORDS.service} Your
                automation was not changed.
              </p>
              {latest ? (
                <button type="button" className="app-link" onClick={() => onSuggest(turn.userText)}>
                  Try again
                </button>
              ) : null}
            </>
          ) : (
            <>
              {turn.kind === 'clarification' ? (
                <span className="app-chat-tag">Question</span>
              ) : turn.kind === 'unsupported' ? (
                <span className="app-chat-tag">Not possible yet</span>
              ) : null}
              <p className="app-chat-text">
                {turn.kind === 'proposal'
                  ? (turn.assistantText ?? '').replace(
                      /^Changes prepared for review; they have not been applied\. /,
                      '',
                    )
                  : turn.assistantText}
              </p>
              {turn.kind === 'proposal' && turn.proposalId ? (
                <Proposal
                  editId={turn.proposalId}
                  automation={automation}
                  onDryRun={onDryRun}
                  dryRunDisabled={dryRunDisabled}
                  onRefine={() => composer.current?.focus()}
                />
              ) : null}
              {turn.kind === 'unsupported' && (turn.alternative || turn.featureRequest) ? (
                <div className="app-chat-options">
                  {turn.alternative ? (
                    <div>
                      <p>
                        <strong>What is possible instead:</strong> {turn.alternative}
                      </p>
                      <button
                        type="button"
                        className="app-gate-secondary"
                        onClick={() =>
                          onSuggest(`Yes, please prepare that alternative: ${turn.alternative}`)
                        }
                      >
                        Ask for this instead
                      </button>
                    </div>
                  ) : null}
                  {turn.featureRequest ? (
                    <div>
                      <p className="app-muted">
                        You can tell us you want this. You will see and can edit the request before
                        anything is sent.
                      </p>
                      <button
                        type="button"
                        className="app-gate-secondary"
                        onClick={() =>
                          feedback({
                            category: 'idea',
                            message: turn.featureRequest ?? '',
                            assistant: {
                              automationId: automation._id,
                              automationName: automation.name,
                              turnId: turn.id,
                            },
                          })
                        }
                      >
                        Request this feature
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      )}
    </li>
  )
}

function Proposal({
  editId,
  automation,
  onDryRun,
  dryRunDisabled,
  onRefine,
  isUndo = false,
}: {
  editId: Id<'automationEdits'>
  automation: Automation
  onDryRun: () => void
  dryRunDisabled: boolean
  onRefine?: () => void
  isUndo?: boolean
}) {
  const edit = useQuery(api.automationEdits.get, { id: editId })
  const apply = useMutation(api.automationEdits.apply)
  const discard = useMutation(api.automationEdits.discard)
  const proposeUndo = useMutation(api.automationEdits.proposeUndo)
  const [busy, setBusy] = useState<'apply' | 'discard' | 'undo' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [undoId, setUndoId] = useState<Id<'automationEdits'> | null>(null)
  const headingId = useId()
  if (edit === undefined) return <p className="app-muted">Loading the proposal.</p>
  const stale = edit.status === 'proposed' && edit.baseRevision !== automation.revision
  const act = (name: 'apply' | 'discard' | 'undo', work: () => Promise<unknown>) => {
    if (busy) return
    setBusy(name)
    setError(null)
    work()
      .catch((reason) =>
        setError(errorText(reason, 'That did not work. Your automation was not changed.')),
      )
      .finally(() => setBusy(null))
  }
  const status =
    edit.status === 'applied'
      ? 'Applied'
      : edit.status === 'discarded'
        ? 'Discarded'
        : stale
          ? 'Out of date'
          : 'Proposed, not applied'
  return (
    <div
      role="group"
      className="app-proposal"
      data-status={stale ? 'stale' : edit.status}
      aria-labelledby={headingId}
    >
      <div className="app-proposal-head">
        <h3 id={headingId}>{isUndo ? 'Undo proposal' : 'Proposed changes'}</h3>
        <span className="app-proposal-status">{status}</span>
      </div>
      {edit.status !== 'discarded' ? (
        <>
          <ul className="app-proposal-summary">
            {edit.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {edit.before.text !== edit.after.text ? (
            <PlaybookDiff before={edit.before.text} after={edit.after.text} />
          ) : null}
        </>
      ) : null}
      {edit.status === 'proposed' ? (
        stale ? (
          <p className="app-muted">
            The automation changed after this was prepared, so it cannot be applied. Send your
            request again to get a fresh proposal.
          </p>
        ) : (
          <>
            <p className="app-muted">
              Applying changes future runs only. Posts already in Buffer stay as they are.
            </p>
            <div className="app-gate-actions">
              <button
                type="button"
                className="app-gate-primary"
                disabled={busy !== null}
                aria-busy={busy === 'apply'}
                onClick={() => act('apply', () => apply({ id: editId }))}
              >
                <BusyLabel
                  busy={busy === 'apply'}
                  idle={isUndo ? 'Undo changes' : 'Apply changes'}
                  working="Applying"
                />
              </button>
              <button
                type="button"
                className="app-gate-secondary"
                disabled={busy !== null}
                onClick={() => act('discard', () => discard({ id: editId }))}
              >
                Discard
              </button>
              {onRefine ? (
                <button
                  type="button"
                  className="app-link"
                  disabled={busy !== null}
                  onClick={onRefine}
                >
                  Refine it
                </button>
              ) : null}
            </div>
          </>
        )
      ) : null}
      {edit.status === 'applied' ? (
        <div className="app-proposal-applied" role="status">
          <p>
            {isUndo ? 'Undone.' : 'Applied.'} Future runs use these settings
            {edit.appliedAt
              ? `, saved ${new Date(edit.appliedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`
              : ''}
            .
          </p>
          <div className="app-gate-actions">
            <button
              type="button"
              className="app-gate-secondary"
              disabled={dryRunDisabled}
              onClick={onDryRun}
            >
              Try a dry run
            </button>
            {!isUndo && !undoId ? (
              <button
                type="button"
                className="app-link"
                disabled={busy !== null}
                onClick={() =>
                  act('undo', () =>
                    proposeUndo({ id: editId, baseRevision: automation.revision }).then(setUndoId),
                  )
                }
              >
                <BusyLabel busy={busy === 'undo'} idle="Undo these changes" working="Preparing" />
              </button>
            ) : null}
          </div>
          <p className="app-muted">
            A dry run does not post to Buffer.
            {automation.allowance && !automation.allowance.ownKey
              ? ` It uses one of your ${automation.allowance.dryRunsLeft} remaining dry ${
                  automation.allowance.dryRunsLeft === 1 ? 'run' : 'runs'
                }.`
              : ''}
          </p>
        </div>
      ) : null}
      {error ? (
        <p className="app-connection-error" role="alert">
          {error}
        </p>
      ) : null}
      {undoId ? (
        <Proposal
          editId={undoId}
          automation={automation}
          onDryRun={onDryRun}
          dryRunDisabled={dryRunDisabled}
          isUndo
        />
      ) : null}
    </div>
  )
}

function PlaybookDiff({ before, after }: { before: string; after: string }) {
  const hunks = useMemo(() => diffHunks(lineDiff(before, after)), [before, after])
  return (
    <details className="app-proposal-diff" open>
      <summary>Playbook changes</summary>
      <div className="app-diff" role="group" aria-label="Playbook text, removed and added lines">
        {hunks.map((line, index) =>
          line.kind === 'gap' ? (
            <div key={index} className="app-diff-gap">
              {line.count} unchanged {line.count === 1 ? 'line' : 'lines'}
            </div>
          ) : (
            <div key={index} className="app-diff-line" data-kind={line.kind}>
              <span aria-hidden="true">
                {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
              </span>
              {line.kind !== 'same' ? (
                <span className="visually-hidden">
                  {line.kind === 'added' ? 'Added: ' : 'Removed: '}
                </span>
              ) : null}
              <span>{line.text || ' '}</span>
            </div>
          ),
        )}
      </div>
    </details>
  )
}
