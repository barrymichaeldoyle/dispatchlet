import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { parsePlaybook, renderPlaybook, type Playbook } from '../../convex/lib/playbook'
import { describeCadence } from '../../convex/lib/schedule'
import { ChannelMark } from './brand-icons'
import { errorText, serviceName, usd, whenIn } from '../lib/format'
import { BusyLabel } from './busy-label'

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
  const [tab, setTab] = useState<'playbook' | 'schedule' | 'runs'>('playbook')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  if (a === undefined) return <p className="app-muted">Loading.</p>
  if (a === null) return <p>This automation does not exist, or it is not yours.</p>
  const running = runs?.some((r) => !r.finishedAt) ?? false
  const act = (name: string, work: () => Promise<unknown>) => {
    setBusy(name)
    setError(null)
    work()
      .catch((reason: unknown) => setError(errorText(reason, 'That did not work. Try again.')))
      .finally(() => setBusy(null))
  }
  const run = (dry: boolean) =>
    act(dry ? 'dry' : 'now', () =>
      trigger({ automationId: id, dry }).then((runId) =>
        navigate({ to: '/app/a/$id/runs/$runId', params: { id, runId } }),
      ),
    )
  const allowance = a.allowance
  const status = STATUS_WORDS[a.status] ?? a.status
  const finished = (runs ?? []).filter(
    (r) => r.kind !== 'dry' && r.finishedAt && r.status === 'done',
  )
  const costPerRun = finished.length
    ? finished.reduce((sum, r) => sum + r.costUsd, 0) / finished.length
    : null
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
          <dt>Cost per run</dt>
          <dd className="tabular" data-text={costPerRun === null}>
            {costPerRun === null ? 'No runs yet' : usd(costPerRun)}
          </dd>
        </div>
      </dl>
      {a.status === 'generating' ? (
        <p className="app-muted">Reading your sources and writing the playbook. About a minute.</p>
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
          {allowance.runsLeft} free {allowance.runsLeft === 1 ? 'run' : 'runs'} and{' '}
          {allowance.dryRunsLeft} dry {allowance.dryRunsLeft === 1 ? 'run' : 'runs'} left.{' '}
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
                .map((t) => `${t.value.toLocaleString('en-GB')} ${t.type.replaceAll('_', ' ')}`)
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
      <nav className="app-tabs" aria-label="Sections">
        {(['playbook', 'schedule', 'runs'] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-current={tab === t ? 'page' : undefined}
            onClick={() => setTab(t)}
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
            key={a.version}
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
            <p className="app-muted">
              {a.status === 'generating'
                ? 'The playbook is on its way.'
                : 'There is no playbook yet.'}
            </p>
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
                  <p className="app-runs-cost tabular">{usd(r.costUsd)}</p>
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
              {c.usable ? null : <span className="app-muted">needs attention in Buffer</span>}
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
            'They wait in Buffer for your approval. Each run emails you a one-click approve link.',
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
}: {
  id: Id<'automations'>
  version: number
  playbook: Playbook
  text: string
  createdBy: string | null
  onRegenerate: () => void
  busy: boolean
}) {
  const save = useMutation(api.automations.savePlaybook)
  const [view, setView] = useState<'form' | 'text'>('form')
  const [draft, setDraft] = useState(text)
  const [form, setForm] = useState<Playbook>(playbook)
  const [problem, setProblem] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const timer = useRef<number | null>(null)
  const dirty = draft !== text
  const lines = useMemo(() => draft.split('\n').length, [draft])

  const fromForm = (next: Playbook) => {
    setForm(next)
    setDraft(renderPlaybook(next))
    setProblem(null)
  }
  const fromText = (next: string) => {
    setDraft(next)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const parsed = parsePlaybook(next)
      if (parsed.ok) {
        setForm(parsed.playbook)
        setProblem(null)
      } else setProblem(`Line ${parsed.line}: ${parsed.message}`)
    }, 300)
  }
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current)
    },
    [],
  )

  const submit = () => {
    const parsed = parsePlaybook(draft)
    if (!parsed.ok) {
      setProblem(`Line ${parsed.line}: ${parsed.message}`)
      return
    }
    setState('saving')
    save({ id, text: draft })
      .then((r) => {
        if (r.ok) setState('saved')
        else {
          setState('failed')
          setProblem(`Line ${r.line}: ${r.message}`)
        }
      })
      .catch((reason: unknown) => {
        setState('failed')
        setProblem(errorText(reason, 'Not saved.'))
      })
  }
  const list = (value: string[]) => value.join('\n')
  const fromList = (value: string) =>
    value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)

  return (
    <section className="app-section app-playbook">
      <div className="app-playbook-head">
        <p className="app-muted">
          Version {version}, {createdBy === 'ai' ? 'written by Dispatchlet' : 'edited by you'}. The
          instructions it follows on every run.
        </p>
        <nav className="app-tabs is-small" aria-label="View">
          <button
            type="button"
            aria-current={view === 'form' ? 'page' : undefined}
            onClick={() => setView('form')}
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
            value={draft}
            spellCheck={false}
            aria-label="Playbook text"
            onChange={(e) => fromText(e.target.value)}
            rows={Math.max(lines + 1, 12)}
          />
        </div>
      ) : (
        <div className="app-form">
          <label>
            <span>Name</span>
            <input
              value={form.name}
              maxLength={60}
              onChange={(e) => fromForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            <span>About</span>
            <textarea
              rows={4}
              value={form.about}
              onChange={(e) => fromForm({ ...form, about: e.target.value })}
            />
          </label>
          <fieldset>
            <legend>Sources</legend>
            {form.sources.map((s, i) => (
              <div key={i} className="app-form-source">
                <input
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
                <input
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
              </div>
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
              value={list(form.searchQueries)}
              onChange={(e) => fromForm({ ...form, searchQueries: fromList(e.target.value) })}
            />
          </label>
          <label>
            <span>Only stories from the last</span>
            <select
              value={form.freshnessHours}
              onChange={(e) => fromForm({ ...form, freshnessHours: Number(e.target.value) })}
            >
              {[24, 36, 48, 72, 168, 192, 336].map((h) => (
                <option key={h} value={h}>
                  {h % 24 === 0 ? `${h / 24} ${h / 24 === 1 ? 'day' : 'days'}` : `${h} hours`}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Post about, one rule a line</span>
            <textarea
              rows={3}
              value={list(form.include)}
              onChange={(e) => fromForm({ ...form, include: fromList(e.target.value) })}
            />
          </label>
          <label>
            <span>Skip, one rule a line</span>
            <textarea
              rows={3}
              value={list(form.exclude)}
              onChange={(e) => fromForm({ ...form, exclude: fromList(e.target.value) })}
            />
          </label>
          <label>
            <span>Tone</span>
            <input
              value={form.voice.tone}
              onChange={(e) =>
                fromForm({ ...form, voice: { ...form.voice, tone: e.target.value } })
              }
            />
          </label>
          <label>
            <span>Notes on the voice</span>
            <textarea
              rows={2}
              value={form.voice.notes}
              onChange={(e) =>
                fromForm({ ...form, voice: { ...form.voice, notes: e.target.value } })
              }
            />
          </label>
          <label>
            <span>Avoid saying, separated by commas</span>
            <input
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
          </label>
          <div className="app-form-row">
            <label>
              <span>Emoji</span>
              <select
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
            </label>
            <label>
              <span>Hashtags</span>
              <select
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
            </label>
          </div>
          <fieldset>
            <legend>Formats</legend>
            {form.formats.map((f, i) => (
              <div key={f.service} className="app-form-format">
                <strong>{serviceName(f.service)}</strong>
                <label>
                  <span>How a post reads here</span>
                  <input
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
                </label>
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
                      value={f.maxLength ?? ''}
                      placeholder="limit"
                      onChange={(e) =>
                        fromForm({
                          ...form,
                          formats: form.formats.map((x, j) =>
                            j === i
                              ? { ...x, maxLength: e.target.value ? Number(e.target.value) : null }
                              : x,
                          ),
                        })
                      }
                    />{' '}
                    characters
                  </label>
                </div>
                <label>
                  <span>Where the link goes</span>
                  <input
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
                </label>
              </div>
            ))}
          </fieldset>
        </div>
      )}
      {problem ? (
        <p className="app-connection-error" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="app-gate-actions">
        <button
          type="button"
          className="app-gate-primary"
          disabled={!dirty || state === 'saving' || problem !== null}
          onClick={submit}
        >
          <BusyLabel busy={state === 'saving'} idle="Save" working="Saving" />
        </button>
        {dirty ? (
          <button
            type="button"
            className="app-gate-secondary"
            onClick={() => {
              setDraft(text)
              setForm(playbook)
              setProblem(null)
            }}
          >
            Discard changes
          </button>
        ) : null}
        <button type="button" className="app-gate-secondary" disabled={busy} onClick={onRegenerate}>
          Write it again
        </button>
        <span className="app-muted" role="status">
          {state === 'saved' && !dirty ? 'Saved as a new version.' : ''}
        </span>
      </div>
    </section>
  )
}
