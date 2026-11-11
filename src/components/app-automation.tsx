import { Link, useBlocker, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { parsePlaybook, renderPlaybook, type Playbook } from '../../convex/lib/playbook'
import { describeCadence } from '../../convex/lib/schedule'
import { ChannelMark } from './brand-icons'
import { channelProblem, errorText, metricLabel, serviceName, whenIn } from '../lib/format'
import { AutomationAssistant } from './automation-chat'
import { BusyLabel } from './busy-label'
import {
  playbookFieldAtLine,
  validatePlaybookForm,
  type PlaybookFieldError,
} from '../lib/playbook-validation'

type LeaveGuard = (proceed: () => void) => void

const STATUS_WORDS: Record<string, string> = {
  generating: 'writing the playbook',
  ready: 'not enabled yet',
  active: 'enabled',
  paused: 'paused',
  failed: 'paused after 3 failed runs',
}

export function AutomationPage({ id }: { id: Id<'automations'> }) {
  const a = useQuery(api.automations.get, { id })
  const runs = useQuery(api.runs.listByAutomation, { automationId: id })
  const perf = useQuery(api.automations.performance, { id })
  const setStatus = useMutation(api.automations.setStatus)
  const trigger = useMutation(api.runs.trigger)
  const regenerate = useMutation(api.automations.regenerate)
  const remove = useMutation(api.automations.remove)
  const navigate = useNavigate()
  const leaveGuard = useRef<LeaveGuard | null>(null)
  const registerLeaveGuard = useCallback((guard: LeaveGuard | null) => {
    leaveGuard.current = guard
  }, [])
  const [tab, setTab] = useState<'playbook' | 'schedule' | 'runs'>('playbook')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const assistantId = useId()
  // Ticks each minute while a run is open, so the buttons come back once it counts as abandoned.
  const [now, setNow] = useState(() => Date.now())
  const open = runs?.some((r) => !r.finishedAt) ?? false
  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [open])
  if (a === undefined) return <p className="app-muted">Loading.</p>
  if (a === null) return <p>This automation does not exist, or it is not yours.</p>
  // The same rule as runs.trigger: an unfinished run older than 15 minutes counts as abandoned.
  const running = runs?.some((r) => !r.finishedAt && now - r.startedAt < 15 * 60_000) ?? false
  const act = (name: string, work: () => Promise<unknown>) => {
    setBusy(name)
    setError(null)
    work()
      .catch((reason: unknown) => setError(errorText(reason, 'That did not work. Try again.')))
      .finally(() => setBusy(null))
  }
  const run = (dry: boolean) => {
    const proceed = () =>
      act(dry ? 'dry' : 'now', () =>
        trigger({ automationId: id, dry }).then((runId) =>
          navigate({ to: '/app/a/$id/runs/$runId', params: { id, runId } }),
        ),
      )
    if (leaveGuard.current) leaveGuard.current(proceed)
    else proceed()
  }
  const allowance = a.allowance
  const status = STATUS_WORDS[a.status] ?? a.status
  return (
    <>
      <p className="app-crumbs">
        <Link to="/app">Home</Link>
      </p>
      <div className="app-home-head">
        <div>
          <h1>{a.name}</h1>
          <p className="app-muted app-subtitle">
            {describeCadence(a.cadence)}, {a.timezone.replaceAll('_', ' ')}
          </p>
        </div>
        <div className="app-gate-actions">
          <button
            type="button"
            className="app-gate-primary"
            disabled={busy !== null || running || !a.playbook}
            onClick={() => run(false)}
          >
            <BusyLabel busy={busy === 'now'} idle="Run now" working="Starting" />
          </button>
          <button
            type="button"
            className="app-gate-secondary"
            disabled={busy !== null || running || !a.playbook}
            onClick={() => run(true)}
          >
            <BusyLabel busy={busy === 'dry'} idle="Dry run" working="Starting" />
          </button>
          {a.status === 'active' ? (
            <button
              type="button"
              className="app-gate-secondary"
              disabled={busy !== null}
              onClick={() => act('pause', () => setStatus({ id, status: 'paused' }))}
            >
              Pause
            </button>
          ) : (
            <button
              type="button"
              className="app-gate-secondary"
              disabled={busy !== null || !a.playbook}
              onClick={() => act('enable', () => setStatus({ id, status: 'active' }))}
            >
              {a.status === 'paused' || a.status === 'failed' ? 'Resume' : 'Enable'}
            </button>
          )}
          <button
            type="button"
            className="app-gate-secondary"
            aria-expanded={assistantOpen}
            aria-controls={assistantOpen ? assistantId : undefined}
            onClick={() => {
              setAssistantOpen((shown) => !shown)
              if (!assistantOpen)
                requestAnimationFrame(() =>
                  document.getElementById(assistantId)?.querySelector('textarea')?.focus(),
                )
            }}
          >
            {assistantOpen ? 'Close assistant' : 'Ask for changes'}
          </button>
          {running ? <span className="app-muted">A run is going.</span> : null}
        </div>
      </div>
      <dl className="app-stats">
        <div data-attention={a.status === 'active'}>
          <dt>{a.status === 'active' && a.nextRunAt ? 'Next run' : 'Status'}</dt>
          <dd className="tabular" data-text={!(a.status === 'active' && a.nextRunAt)}>
            {a.status === 'active' && a.nextRunAt ? whenIn(a.nextRunAt, a.timezone) : status}
          </dd>
        </div>
        <div>
          <dt>Posts, last 30 days</dt>
          <dd className="tabular">{perf ? perf.posts : 0}</dd>
        </div>
        <div data-attention={Boolean(perf?.drafts)}>
          <dt>Sent / drafts</dt>
          <dd className="tabular">{perf ? `${perf.sent} / ${perf.drafts}` : '0 / 0'}</dd>
        </div>
        <div>
          <dt>{allowance?.ownKey ? 'AI usage' : 'Free runs left'}</dt>
          <dd className="tabular" data-text={Boolean(allowance?.ownKey)}>
            {allowance?.ownKey ? 'On your key' : (allowance?.runsLeft ?? '—')}
          </dd>
        </div>
      </dl>
      {a.status === 'generating' ? (
        <p className="app-working" role="status">
          <span className="flow-spinner" aria-hidden="true" />
          <span>
            Reading your sources and writing the playbook. It takes about a minute, and a first dry
            run starts here on its own when it is done.
          </span>
        </p>
      ) : a.status === 'ready' ? (
        <p className="app-muted">Try a dry run, then enable it.</p>
      ) : null}
      {a.generationError ? (
        <p className="app-connection-error" role="alert">
          The playbook could not be written. {a.generationError}
        </p>
      ) : null}
      {allowance && !allowance.ownKey ? (
        <p className="app-muted">
          Dispatchlet covers your free runs. {allowance.dryRunsLeft} dry{' '}
          {allowance.dryRunsLeft === 1 ? 'run' : 'runs'} left.{' '}
          <Link to="/app/settings">Add your own Anthropic key</Link> to lift the limit.
        </p>
      ) : null}
      {error ? (
        <p className="app-connection-error" role="alert">
          {error}
        </p>
      ) : null}
      {perf?.best || perf?.totals.length ? (
        <p className="app-muted app-performance">
          {perf.totals.length
            ? `${perf.totals
                .slice(0, 3)
                .map(metricLabel)
                .join(', ')} across the ${perf.withMetrics} posts with metrics so far.`
            : ''}
          {perf.best ? (
            <>
              {' '}
              Best so far:{' '}
              <Link to="/app/a/$id/runs/$runId" params={{ id, runId: perf.best.runId }}>
                {perf.best.title}
              </Link>
              {`, ${perf.best.value.toLocaleString('en-GB')} ${perf.best.type}.`}
            </>
          ) : null}
        </p>
      ) : null}
      {assistantOpen ? (
        <AutomationAssistant
          panelId={assistantId}
          automation={a}
          onDryRun={() => run(true)}
          dryRunDisabled={busy !== null || running || !a.playbook}
        />
      ) : null}
      <nav className="app-tabs" aria-label="Sections">
        {(['playbook', 'schedule', 'runs'] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-current={tab === t ? 'page' : undefined}
            onClick={() => {
              if (t === tab) return
              if (leaveGuard.current) leaveGuard.current(() => setTab(t))
              else setTab(t)
            }}
          >
            {t === 'playbook'
              ? 'Playbook'
              : t === 'schedule'
                ? 'Schedule'
                : `Runs${runs?.length ? ` (${runs.length})` : ''}`}
          </button>
        ))}
      </nav>
      {tab === 'playbook' ? (
        a.playbook && a.text ? (
          <PlaybookEditor
            key={id}
            registerLeaveGuard={registerLeaveGuard}
            id={id}
            version={a.version}
            playbook={a.playbook}
            text={a.text}
            createdBy={a.playbookCreatedBy}
            onRegenerate={() => act('regen', () => regenerate({ id }))}
            busy={busy !== null || a.status === 'generating'}
          />
        ) : (
          <section className="app-section">
            {a.status === 'generating' ? (
              <p className="app-working">
                <span className="flow-spinner" aria-hidden="true" />
                <span>The playbook appears here as soon as it is written.</span>
              </p>
            ) : (
              <p className="app-muted">There is no playbook yet.</p>
            )}
            {a.status !== 'generating' ? (
              <button
                type="button"
                className="app-gate-secondary"
                onClick={() => act('regen', () => regenerate({ id }))}
                disabled={busy !== null}
              >
                Try again
              </button>
            ) : null}
          </section>
        )
      ) : null}
      {tab === 'schedule' ? <ScheduleEditor a={a} /> : null}
      {tab === 'runs' ? (
        <section className="app-section">
          {runs && runs.length ? (
            <ul className="app-runs">
              {runs.map((r) => (
                <li key={r._id} data-status={r.finishedAt ? r.status : 'running'}>
                  <div className="app-runs-when">
                    <Link
                      to="/app/a/$id/runs/$runId"
                      params={{ id, runId: r._id }}
                      className="tabular"
                    >
                      {whenIn(r.startedAt, a.timezone)}
                    </Link>
                    <span className="app-muted">
                      {r.kind === 'dry' ? 'Dry run' : r.kind === 'now' ? 'Run now' : 'Scheduled'}
                    </span>
                  </div>
                  <p className="app-runs-outcome">
                    {r.finishedAt ? r.last || r.status : 'Running.'}
                  </p>
                  <p className="app-runs-counts tabular">
                    <span>{r.found} found</span>
                    <span>{r.kept} kept</span>
                    <span>{r.posted} posted</span>
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="app-muted">No runs yet. Try a dry run.</p>
          )}
        </section>
      ) : null}
      <section className="app-section">
        <h2>Delete automation</h2>
        <p>Stops the schedule and removes it from your list. Posts already in Buffer stay there.</p>
        {confirmDelete ? (
          <div className="app-gate-actions">
            <button
              type="button"
              className="app-gate-danger"
              disabled={busy !== null}
              onClick={() =>
                act('delete', () => remove({ id }).then(() => navigate({ to: '/app' })))
              }
            >
              Delete it
            </button>
            <button
              type="button"
              className="app-gate-secondary"
              onClick={() => setConfirmDelete(false)}
            >
              Keep it
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="app-gate-secondary"
            onClick={() => setConfirmDelete(true)}
          >
            Delete automation
          </button>
        )}
      </section>
    </>
  )
}

type Loaded = NonNullable<ReturnType<typeof useQuery<typeof api.automations.get>>>

function ScheduleEditor({ a }: { a: Loaded }) {
  const connection = useQuery(api.buffer.myConnection)
  const update = useMutation(api.automations.updateConfig)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const [message, setMessage] = useState('')
  const save = (changes: Omit<Parameters<typeof update>[0], 'id'>) => {
    setState('saving')
    update({ id: a._id, ...changes })
      .then(() => setState('saved'))
      .catch((reason: unknown) => {
        setState('failed')
        setMessage(errorText(reason, 'Not saved.'))
      })
  }
  const channels = connection?.channels ?? []
  const weekdays = [
    ['mon', 'Mondays'],
    ['tue', 'Tuesdays'],
    ['wed', 'Wednesdays'],
    ['thu', 'Thursdays'],
    ['fri', 'Fridays'],
    ['sat', 'Saturdays'],
    ['sun', 'Sundays'],
  ]
  return (
    <section className="app-section app-schedule">
      <h2>When it runs</h2>
      <div className="app-field">
        <select
          className="app-select"
          value={a.cadence.preset}
          aria-label="How often"
          onChange={(e) =>
            save({
              cadence: {
                ...a.cadence,
                preset: e.target.value as 'daily' | 'weekly',
                weekday: e.target.value === 'weekly' ? (a.cadence.weekday ?? 'mon') : null,
              },
            })
          }
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
        {a.cadence.preset === 'weekly' ? (
          <select
            className="app-select"
            value={a.cadence.weekday ?? 'mon'}
            aria-label="Weekday"
            onChange={(e) => save({ cadence: { ...a.cadence, weekday: e.target.value } })}
          >
            {weekdays.map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
        ) : null}
        <input
          type="time"
          className="app-select tabular"
          value={a.cadence.time}
          step={300}
          aria-label="Time"
          onChange={(e) =>
            e.target.value && save({ cadence: { ...a.cadence, time: e.target.value } })
          }
        />
        <span className="app-muted">
          {a.timezone.replaceAll('_', ' ')}, set in <Link to="/app/settings">settings</Link>.
        </span>
      </div>
      <h2>Channels</h2>
      <ul className="app-choices">
        {channels.map((c) => (
          <li key={c.channelId} data-checked={a.channelIds.includes(c.channelId)}>
            <label>
              <input
                type="checkbox"
                checked={a.channelIds.includes(c.channelId)}
                disabled={!c.usable}
                onChange={(e) =>
                  save({
                    channelIds: e.target.checked
                      ? [...a.channelIds, c.channelId]
                      : a.channelIds.filter((x) => x !== c.channelId),
                  })
                }
              />
              <ChannelMark channel={serviceName(c.service)} size={14} />
              <span>{c.name}</span>
              {c.usable ? null : (
                <span className="app-muted">{channelProblem(c.problem, c.service)}</span>
              )}
            </label>
          </li>
        ))}
      </ul>
      <h2>Stories a run, at most</h2>
      <div className="app-field">
        {[1, 2, 3].map((n) => (
          <label key={n} className="app-radio tabular">
            <input
              type="radio"
              name="max"
              checked={a.maxPostsPerRun === n}
              onChange={() => save({ maxPostsPerRun: n })}
            />{' '}
            {n}
          </label>
        ))}
      </div>
      <h2>How posts reach Buffer</h2>
      <ul className="app-choices">
        {[
          [
            'draft',
            'Save as drafts',
            'They wait in Buffer for your approval. Each run emails you an approve link for each draft.',
          ],
          ['queue', 'Add to the queue', 'Into the next free slots on each channel.'],
          [
            'spread',
            'Spread through the day',
            'Scheduled from ten minutes after the run, two hours apart.',
          ],
        ].map(([mode, title, detail]) => (
          <li key={mode} data-checked={a.postingMode === mode}>
            <label>
              <input
                type="radio"
                name="mode"
                checked={a.postingMode === mode}
                onChange={() => save({ postingMode: mode as 'draft' | 'queue' | 'spread' })}
              />
              <span>{title}</span>
              <span className="app-muted">{detail}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="app-muted" role="status">
        {state === 'saving'
          ? 'Saving'
          : state === 'saved'
            ? 'Saved'
            : state === 'failed'
              ? message
              : ''}
      </p>
    </section>
  )
}

/** One line per entry, for the form's list fields. */
const list = (value: string[]) => value.join('\n')
const fromList = (value: string) =>
  value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

/** Native disclosures keep each editing task independent and keyboard accessible. */
function PlaybookSection({
  title,
  summary,
  children,
  initiallyOpen = false,
  compact = false,
}: {
  title: string
  summary: string
  children: ReactNode
  initiallyOpen?: boolean
  compact?: boolean
}) {
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <details
      className={`app-playbook-section${compact ? ' is-compact' : ''}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="app-playbook-section-copy">
          <span className="app-playbook-section-title">{title}</span>
          <span className="app-playbook-section-summary">{summary}</span>
        </span>
        <span className="app-playbook-section-action" aria-hidden="true">
          {open ? 'Close' : 'Edit'}
        </span>
      </summary>
      <div className="app-playbook-section-fields">{children}</div>
    </details>
  )
}

function PlaybookLeaveDialog({
  saving,
  onKeepEditing,
  onDiscard,
  onSave,
}: {
  saving: boolean
  onKeepEditing: () => void
  onDiscard: () => void
  onSave: () => void
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
        onKeepEditing()
      }}
    >
      <h2 id={titleId}>Save your changes?</h2>
      <p id={descriptionId}>
        You have unsaved playbook edits. Save them before continuing, or discard them.
      </p>
      <div className="app-gate-actions">
        <button type="button" className="app-gate-secondary" autoFocus onClick={onKeepEditing}>
          Keep editing
        </button>
        <button type="button" className="app-gate-secondary" disabled={saving} onClick={onDiscard}>
          Discard changes
        </button>
        <button
          type="button"
          className="app-gate-primary"
          disabled={saving}
          aria-busy={saving}
          onClick={onSave}
        >
          <BusyLabel busy={saving} idle="Save and continue" working="Saving" />
        </button>
      </div>
    </dialog>
  )
}

/**
 * The playbook as a form and as text, kept in step: the text is the source, the form is a view.
 * Form edits re-render the text; text edits re-parse with a short delay and name the line when
 * something is not understood.
 */
function PlaybookEditor({
  id,
  version,
  playbook,
  text,
  createdBy,
  onRegenerate,
  busy,
  registerLeaveGuard,
}: {
  id: Id<'automations'>
  version: number
  playbook: Playbook
  text: string
  createdBy: string | null
  onRegenerate: () => void
  busy: boolean
  registerLeaveGuard?: (guard: LeaveGuard | null) => void
}) {
  const save = useMutation(api.automations.savePlaybook)
  const [view, setView] = useState<'form' | 'text'>('form')
  const [draft, setDraft] = useState(text)
  const [form, setForm] = useState<Playbook>(playbook)
  const [problem, setProblem] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const timer = useRef<number | null>(null)
  const editor = useRef<HTMLElement>(null)
  const errorId = useId()
  const [fieldProblem, setFieldProblem] = useState<PlaybookFieldError | null>(null)
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null)
  const leaveAttempt = useRef(0)
  // The version the draft was started from. A newer one arriving (a save from another tab, the
  // API, or "write it again") replaces a clean draft and is only announced over a dirty one.
  const [base, setBase] = useState({ version, text, playbook })
  // The version this editor's own save made, taken up as it arrives (the server renders the text).
  const [saved, setSaved] = useState<number | null>(null)
  const dirty = draft !== base.text
  const stale = version !== base.version
  const adopt = () => {
    setBase({ version, text, playbook })
    setDraft(text)
    setForm(playbook)
    setProblem(null)
    setFieldProblem(null)
  }
  if (stale && (!dirty || version === saved)) adopt()
  const lines = useMemo(() => draft.split('\n').length, [draft])

  const blocker = useBlocker({
    shouldBlockFn: () => dirty || state === 'saving',
    enableBeforeUnload: dirty || state === 'saving',
    withResolver: true,
  })
  const requestLeave = useCallback<LeaveGuard>(
    (proceed) => {
      if (dirty || state === 'saving') setPendingLeave(() => proceed)
      else proceed()
    },
    [dirty, state],
  )
  useEffect(() => {
    registerLeaveGuard?.(requestLeave)
    return () => {
      registerLeaveGuard?.(null)
    }
  }, [registerLeaveGuard, requestLeave])
  const cancelLeave = () => {
    leaveAttempt.current++
    setPendingLeave(null)
    if (blocker.status === 'blocked') blocker.reset()
  }
  const finishLeave = () => {
    setPendingLeave(null)
    if (blocker.status === 'blocked') blocker.proceed()
    else pendingLeave?.()
  }
  const reportFieldProblem = (error: PlaybookFieldError, focus = true) => {
    setFieldProblem(error)
    setProblem(null)
    if (!focus) return
    requestAnimationFrame(() => {
      const control = editor.current?.querySelector<HTMLElement>(
        `[data-playbook-field="${error.field}"]`,
      )
      if (!control) return
      for (let parent = control.parentElement; parent; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement) parent.open = true
      }
      // Let nested disclosures lay out before measuring where to scroll the control.
      requestAnimationFrame(() => {
        control.focus({ preventScroll: true })
        control.scrollIntoView({ block: 'center' })
      })
    })
  }
  const fieldProps = (field: string) => ({
    'data-playbook-field': field,
    'aria-invalid': fieldProblem?.field === field || undefined,
    'aria-describedby': fieldProblem?.field === field ? errorId : undefined,
  })
  const fieldError = (field: string) =>
    fieldProblem?.field === field ? (
      <span id={errorId} className="app-field-error" role="alert">
        {fieldProblem.message}
      </span>
    ) : null

  const fromForm = (next: Playbook) => {
    setForm(next)
    setDraft(renderPlaybook(next))
    setProblem(null)
    setFieldProblem(null)
  }
  const fromText = (next: string) => {
    setDraft(next)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const parsed = parsePlaybook(next)
      if (parsed.ok) {
        setForm(parsed.playbook)
        setProblem(null)
        setFieldProblem(null)
      } else setProblem(`Line ${parsed.line}: ${parsed.message}`)
    }, 300)
  }
  const showForm = () => {
    if (timer.current) window.clearTimeout(timer.current)
    const parsed = parsePlaybook(draft)
    if (!parsed.ok) {
      setProblem(`Line ${parsed.line}: ${parsed.message}`)
      return
    }
    setForm(parsed.playbook)
    setProblem(null)
    setFieldProblem(null)
    setView('form')
  }
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current)
    },
    [],
  )

  const submit = async (): Promise<boolean> => {
    if (state === 'saving') return false
    if (timer.current) window.clearTimeout(timer.current)
    if (view === 'form') {
      const error = validatePlaybookForm(form)[0]
      if (error) {
        reportFieldProblem(error)
        return false
      }
    }
    const parsed = parsePlaybook(draft)
    if (!parsed.ok) {
      if (view === 'form')
        reportFieldProblem({
          field: playbookFieldAtLine(form, parsed.line),
          message: parsed.message,
        })
      else setProblem(`Line ${parsed.line}: ${parsed.message}`)
      return false
    }
    setState('saving')
    setProblem(null)
    try {
      const result = await save({ id, text: draft })
      if (result.ok) {
        setSaved(result.version)
        setState('saved')
        return true
      }
      setState('failed')
      if (view === 'form' && !result.message.startsWith('A playbook can be up to'))
        reportFieldProblem({
          field: playbookFieldAtLine(form, result.line),
          message: result.message,
        })
      else setProblem(view === 'text' ? `Line ${result.line}: ${result.message}` : result.message)
    } catch (reason: unknown) {
      setState('failed')
      setProblem(errorText(reason, 'Not saved.'))
    }
    return false
  }
  const saveAndLeave = async () => {
    const attempt = leaveAttempt.current
    const ok = !dirty || (await submit())
    if (attempt !== leaveAttempt.current) return
    if (ok) finishLeave()
    else cancelLeave()
  }
  const discardDraft = () => {
    if (timer.current) window.clearTimeout(timer.current)
    setDraft(base.text)
    setForm(base.playbook)
    setProblem(null)
    setFieldProblem(null)
    setState('idle')
  }
  return (
    <section ref={editor} className="app-section app-playbook">
      <div className="app-playbook-head">
        <p className="app-muted">
          Version {version}, {createdBy === 'ai' ? 'written by Dispatchlet' : 'edited by you'}. The
          instructions it follows on every run.
        </p>
        <nav className="app-tabs is-small" aria-label="View">
          <button
            type="button"
            aria-current={view === 'form' ? 'page' : undefined}
            onClick={showForm}
          >
            Form
          </button>
          <button
            type="button"
            aria-current={view === 'text' ? 'page' : undefined}
            onClick={() => setView('text')}
          >
            Text
          </button>
        </nav>
      </div>
      {view === 'text' ? (
        <div className="app-editor">
          <div className="app-editor-gutter" aria-hidden="true">
            {Array.from({ length: lines }, (_, i) => (
              <span key={i}>{i + 1}</span>
            ))}
          </div>
          <textarea
            className="app-editor-text"
            readOnly={state === 'saving'}
            value={draft}
            spellCheck={false}
            aria-label="Playbook text"
            onChange={(e) => fromText(e.target.value)}
            rows={Math.max(lines + 1, 12)}
          />
        </div>
      ) : (
        <div
          className="app-form"
          inert={state === 'saving'}
          onBlurCapture={(event) => {
            const field = (event.target as HTMLElement).dataset.playbookField
            if (!field) return
            const error = validatePlaybookForm(form).find((issue) => issue.field === field)
            if (error) reportFieldProblem(error, false)
          }}
        >
          <PlaybookSection title="Purpose" summary={`${form.name}. ${form.about}`}>
            <label>
              <span>Name</span>
              <input
                {...fieldProps(`name`)}
                value={form.name}
                maxLength={60}
                onChange={(e) => fromForm({ ...form, name: e.target.value })}
              />
              {fieldError(`name`)}
            </label>
            <label>
              <span>About</span>
              <textarea
                rows={4}
                {...fieldProps(`about`)}
                value={form.about}
                onChange={(e) => fromForm({ ...form, about: e.target.value })}
              />
              {fieldError(`about`)}
            </label>
          </PlaybookSection>
          <PlaybookSection
            title="Sources & searches"
            summary={`${form.sources.length} ${form.sources.length === 1 ? 'source' : 'sources'} · ${form.searchQueries.length} ${form.searchQueries.length === 1 ? 'search' : 'searches'}${form.sources.length ? ` · ${form.sources.map((source) => source.label || source.url || 'New source').join(', ')}` : ''}`}
          >
            <fieldset>
              <legend>Sources</legend>
              {form.sources.map((s, i) => (
                <PlaybookSection
                  key={i}
                  compact
                  title={s.label || s.url || 'New source'}
                  summary={
                    [s.url, s.priority === 'high' ? 'Check first' : '']
                      .filter(Boolean)
                      .join(' · ') ||
                    s.note ||
                    'Add a website or publisher'
                  }
                  initiallyOpen={!s.label && !s.url}
                >
                  <label>
                    <span>Website or publisher</span>
                    <input
                      {...fieldProps(`sources.${i}.url`)}
                      value={s.url ?? s.label}
                      aria-label="Source"
                      onChange={(e) =>
                        fromForm({
                          ...form,
                          sources: form.sources.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  ...(/^(https?:\/\/|[a-z0-9-]+\.[a-z])/i.test(e.target.value)
                                    ? {
                                        url: e.target.value.includes('://')
                                          ? e.target.value
                                          : `https://${e.target.value}`,
                                        label: e.target.value
                                          .replace(/^https?:\/\//, '')
                                          .split('/')[0]!,
                                      }
                                    : { url: null, label: e.target.value }),
                                }
                              : x,
                          ),
                        })
                      }
                    />
                    {fieldError(`sources.${i}.url`)}
                  </label>
                  <label>
                    <span>What it is good for</span>
                    <input
                      {...fieldProps(`sources.${i}.note`)}
                      value={s.note}
                      placeholder="What it is good for"
                      aria-label="Note"
                      onChange={(e) =>
                        fromForm({
                          ...form,
                          sources: form.sources.map((x, j) =>
                            j === i ? { ...x, note: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    {fieldError(`sources.${i}.note`)}
                  </label>
                  <label className="app-radio">
                    <input
                      type="checkbox"
                      checked={s.priority === 'high'}
                      onChange={(e) =>
                        fromForm({
                          ...form,
                          sources: form.sources.map((x, j) =>
                            j === i ? { ...x, priority: e.target.checked ? 'high' : 'normal' } : x,
                          ),
                        })
                      }
                    />{' '}
                    Check first
                  </label>
                  <button
                    type="button"
                    className="app-link"
                    onClick={() =>
                      fromForm({ ...form, sources: form.sources.filter((_, j) => j !== i) })
                    }
                  >
                    Remove
                  </button>
                </PlaybookSection>
              ))}
              <button
                type="button"
                className="app-link"
                onClick={() =>
                  fromForm({
                    ...form,
                    sources: [
                      ...form.sources,
                      { label: '', url: null, note: '', priority: 'normal' },
                    ],
                  })
                }
              >
                Add a source
              </button>
            </fieldset>
            <label>
              <span>Searches, one a line</span>
              <textarea
                rows={3}
                {...fieldProps(`searchQueries`)}
                value={list(form.searchQueries)}
                onChange={(e) => fromForm({ ...form, searchQueries: fromList(e.target.value) })}
              />
              {fieldError(`searchQueries`)}
            </label>
          </PlaybookSection>
          <PlaybookSection
            title="Story selection"
            summary={`${form.freshnessHours % 24 === 0 ? `${form.freshnessHours / 24} days` : `${form.freshnessHours} hours`} of news · ${form.include.length} include ${form.include.length === 1 ? 'rule' : 'rules'} · ${form.exclude.length} skip ${form.exclude.length === 1 ? 'rule' : 'rules'}`}
          >
            <label>
              <span>Only stories from the last</span>
              <select
                {...fieldProps(`freshnessHours`)}
                value={form.freshnessHours}
                onChange={(e) => fromForm({ ...form, freshnessHours: Number(e.target.value) })}
              >
                {[24, 36, 48, 72, 168, 192, 336].map((h) => (
                  <option key={h} value={h}>
                    {h % 24 === 0 ? `${h / 24} ${h / 24 === 1 ? 'day' : 'days'}` : `${h} hours`}
                  </option>
                ))}
              </select>
              {fieldError(`freshnessHours`)}
            </label>
            <label>
              <span>Post about, one rule a line</span>
              <textarea
                rows={3}
                {...fieldProps(`include`)}
                value={list(form.include)}
                onChange={(e) => fromForm({ ...form, include: fromList(e.target.value) })}
              />
              {fieldError(`include`)}
            </label>
            <label>
              <span>Skip, one rule a line</span>
              <textarea
                rows={3}
                {...fieldProps(`exclude`)}
                value={list(form.exclude)}
                onChange={(e) => fromForm({ ...form, exclude: fromList(e.target.value) })}
              />
              {fieldError(`exclude`)}
            </label>
          </PlaybookSection>
          <PlaybookSection
            title="Voice"
            summary={`${form.voice.tone || 'No tone set'} · ${form.voice.emoji === 'none' ? 'No emoji' : `${form.voice.emoji === 'light' ? 'Light' : 'Free use of'} emoji`} · ${form.voice.hashtags === 'none' ? 'No hashtags' : `${form.voice.hashtags === 'few' ? 'A few' : 'Many'} hashtags`}`}
          >
            <label>
              <span>Tone</span>
              <input
                {...fieldProps(`voice.tone`)}
                value={form.voice.tone}
                onChange={(e) =>
                  fromForm({ ...form, voice: { ...form.voice, tone: e.target.value } })
                }
              />
              {fieldError(`voice.tone`)}
            </label>
            <label>
              <span>Notes on the voice</span>
              <textarea
                rows={2}
                {...fieldProps(`voice.notes`)}
                value={form.voice.notes}
                onChange={(e) =>
                  fromForm({ ...form, voice: { ...form.voice, notes: e.target.value } })
                }
              />
              {fieldError(`voice.notes`)}
            </label>
            <label>
              <span>Avoid saying, separated by commas</span>
              <input
                {...fieldProps(`voice.avoidSaying`)}
                value={form.voice.avoidSaying.join(', ')}
                onChange={(e) =>
                  fromForm({
                    ...form,
                    voice: {
                      ...form.voice,
                      avoidSaying: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    },
                  })
                }
              />
              {fieldError(`voice.avoidSaying`)}
            </label>
            <div className="app-form-row">
              <label>
                <span>Emoji</span>
                <select
                  {...fieldProps(`voice.emoji`)}
                  value={form.voice.emoji}
                  onChange={(e) =>
                    fromForm({
                      ...form,
                      voice: { ...form.voice, emoji: e.target.value as Playbook['voice']['emoji'] },
                    })
                  }
                >
                  <option value="none">none</option>
                  <option value="light">light</option>
                  <option value="free">free</option>
                </select>
                {fieldError(`voice.emoji`)}
              </label>
              <label>
                <span>Hashtags</span>
                <select
                  {...fieldProps(`voice.hashtags`)}
                  value={form.voice.hashtags}
                  onChange={(e) =>
                    fromForm({
                      ...form,
                      voice: {
                        ...form.voice,
                        hashtags: e.target.value as Playbook['voice']['hashtags'],
                      },
                    })
                  }
                >
                  <option value="none">none</option>
                  <option value="few">few</option>
                  <option value="many">many</option>
                </select>
                {fieldError(`voice.hashtags`)}
              </label>
            </div>
          </PlaybookSection>
          <PlaybookSection
            title="Channel formats"
            summary={
              form.formats.map((format) => serviceName(format.service)).join(' · ') ||
              'No channel formats'
            }
          >
            {form.formats.map((f, i) => (
              <div key={f.service} className="app-form-format">
                <strong>{serviceName(f.service)}</strong>
                <label>
                  <span>How a post reads here</span>
                  <input
                    {...fieldProps(`formats.${i}.style`)}
                    value={f.style}
                    aria-label={`${serviceName(f.service)} style`}
                    onChange={(e) =>
                      fromForm({
                        ...form,
                        formats: form.formats.map((x, j) =>
                          j === i ? { ...x, style: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  {fieldError(`formats.${i}.style`)}
                </label>
                <details className="app-format-options">
                  <summary>Length, threads & links</summary>
                  <div className="app-playbook-section-fields">
                    <div className="app-form-row">
                      <label className="app-radio">
                        <input
                          type="checkbox"
                          checked={f.thread}
                          onChange={(e) =>
                            fromForm({
                              ...form,
                              formats: form.formats.map((x, j) =>
                                j === i ? { ...x, thread: e.target.checked } : x,
                              ),
                            })
                          }
                        />{' '}
                        Threads when needed
                      </label>
                      <label className="app-radio">
                        Up to{' '}
                        <input
                          type="number"
                          className="tabular app-number"
                          min={50}
                          {...fieldProps(`formats.${i}.maxLength`)}
                          value={f.maxLength ?? ''}
                          placeholder="limit"
                          onChange={(e) =>
                            fromForm({
                              ...form,
                              formats: form.formats.map((x, j) =>
                                j === i
                                  ? {
                                      ...x,
                                      maxLength: e.target.value ? Number(e.target.value) : null,
                                    }
                                  : x,
                              ),
                            })
                          }
                        />
                        characters
                        {fieldError(`formats.${i}.maxLength`)}
                      </label>
                    </div>
                    <label>
                      <span>Where the link goes</span>
                      <input
                        {...fieldProps(`formats.${i}.linkBack`)}
                        value={f.linkBack ?? ''}
                        placeholder="Blank means after the text"
                        aria-label={`${serviceName(f.service)} link`}
                        onChange={(e) =>
                          fromForm({
                            ...form,
                            formats: form.formats.map((x, j) =>
                              j === i ? { ...x, linkBack: e.target.value || null } : x,
                            ),
                          })
                        }
                      />
                      {fieldError(`formats.${i}.linkBack`)}
                    </label>
                  </div>
                </details>
              </div>
            ))}
          </PlaybookSection>
        </div>
      )}
      <div className="app-playbook-regenerate">
        <span className="app-muted">Want a fresh starting point?</span>
        <button
          type="button"
          className="app-link"
          disabled={busy || state === 'saving'}
          onClick={() => requestLeave(onRegenerate)}
        >
          Write it again
        </button>
      </div>
      <div className="app-gate-actions app-playbook-save" role="group" aria-label="Save playbook">
        {problem ? (
          <p className="app-connection-error" role="alert">
            {problem}
          </p>
        ) : null}
        {stale && dirty && state !== 'saving' ? (
          <p className="app-playbook-stale" role="status">
            This playbook changed elsewhere. Saving will overwrite that change.{' '}
            <button type="button" className="app-link" onClick={adopt}>
              Load the new version
            </button>
          </p>
        ) : null}
        <span className="app-playbook-save-status app-muted" role="status">
          {state === 'saving'
            ? 'Saving changes…'
            : dirty
              ? 'Unsaved changes'
              : state === 'saved'
                ? 'Saved as a new version.'
                : 'All changes saved'}
        </span>
        <button
          type="button"
          className="app-gate-primary"
          disabled={!dirty || state === 'saving'}
          onClick={() => {
            void submit()
          }}
        >
          <BusyLabel busy={state === 'saving'} idle="Save" working="Saving" />
        </button>
        {dirty ? (
          <button
            type="button"
            className="app-gate-secondary"
            disabled={state === 'saving'}
            onClick={discardDraft}
          >
            Discard changes
          </button>
        ) : null}
      </div>
      {pendingLeave || blocker.status === 'blocked' ? (
        <PlaybookLeaveDialog
          saving={state === 'saving'}
          onKeepEditing={cancelLeave}
          onDiscard={() => {
            discardDraft()
            finishLeave()
          }}
          onSave={() => {
            void saveAndLeave()
          }}
        />
      ) : null}
    </section>
  )
}
