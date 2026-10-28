import { Link, useNavigate } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { api } from '../../convex/_generated/api'
import { ChannelMark } from './brand-icons'
import { TEMPLATES } from '../../convex/lib/templates'
import { errorText, serviceName } from '../lib/format'

const WEEKDAYS = [
  ['mon', 'Monday'],
  ['tue', 'Tuesday'],
  ['wed', 'Wednesday'],
  ['thu', 'Thursday'],
  ['fri', 'Friday'],
  ['sat', 'Saturday'],
  ['sun', 'Sunday'],
] as const

type Answers = {
  research: string
  channelIds: string[]
  avoid: string
  sources: string
  onlyTheseSources: boolean
  preset: 'daily' | 'weekly'
  time: string
  weekday: (typeof WEEKDAYS)[number][0]
  maxStories: number
  postingMode: 'draft' | 'queue'
}

const START: Answers = {
  research: '',
  channelIds: [],
  avoid: '',
  sources: '',
  onlyTheseSources: false,
  preset: 'daily',
  time: '08:00',
  weekday: 'mon',
  maxStories: 3,
  postingMode: 'draft',
}

/** A big square option, a checkbox or a radio under the hood (SPEC §40). */
function Block({
  checked,
  onChange,
  name,
  type = 'radio',
  detail,
  className = '',
  children,
}: {
  checked: boolean
  onChange: () => void
  name: string
  type?: 'radio' | 'checkbox'
  detail?: string
  className?: string
  children: ReactNode
}) {
  return (
    <label className={`setup-block setup-choice ${className}`} data-checked={checked}>
      <input type={type} name={name} checked={checked} onChange={onChange} className="sr-only" />
      <span className="setup-block-title">{children}</span>
      {detail ? <span className="setup-block-detail">{detail}</span> : null}
    </label>
  )
}

function parseSources(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10)
}

/** The seven setup questions, one at a time, with the answers filling in beside them. */
export function NewAutomation() {
  const connection = useQuery(api.buffer.myConnection)
  const create = useMutation(api.automations.create)
  const sync = useAction(api.buffer.syncChannels)
  const navigate = useNavigate()
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const syncedOnce = useRef(false)
  const runSync = () => {
    setSyncing(true)
    setSyncError(null)
    sync()
      .catch((reason: unknown) =>
        setSyncError(errorText(reason, 'Buffer did not answer. Try again.')),
      )
      .finally(() => setSyncing(false))
  }
  // The first visit after sign-in often has no channels yet: fetch them once without asking.
  useEffect(() => {
    if (!connection || connection.channels.length || syncedOnce.current || connection.needsReauth)
      return
    syncedOnce.current = true
    runSync()
  })
  const [a, setA] = useState<Answers>(START)
  const [index, setIndex] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const channels = (connection?.channels ?? []).filter((c) => c.usable)
  const set = <K extends keyof Answers>(key: K, value: Answers[K]) =>
    setA((prev) => ({ ...prev, [key]: value }))

  const questions: {
    label: string
    hint?: string
    optional?: boolean
    valid: boolean
    body: ReactNode
  }[] = [
    {
      label: 'What should it research?',
      valid: a.research.trim().length > 0,
      body: (
        <>
          <input
            id={`${id}-research`}
            className="setup-input setup-field"
            value={a.research}
            maxLength={300}
            autoFocus
            onChange={(e) => set('research', e.target.value)}
            placeholder="F1 news: race results, driver and team news"
          />
          <p className="setup-hint">Or start from an example and change what you like.</p>
          <div className="setup-templates">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="setup-template"
                onClick={() => {
                  const w = t.answers
                  setA((prev) => ({
                    ...prev,
                    research: w.research,
                    avoid: w.avoid,
                    sources: w.sources.join(', '),
                    onlyTheseSources: w.onlyTheseSources,
                    preset: w.cadence.preset,
                    time: w.cadence.time,
                    weekday: (w.cadence.weekday ?? 'mon') as Answers['weekday'],
                    maxStories: w.maxStories,
                    postingMode: w.postingMode,
                  }))
                  setIndex(1)
                }}
              >
                <strong>{t.name}</strong>
                <span>{t.line}</span>
              </button>
            ))}
          </div>
        </>
      ),
    },
    {
      label: 'Where should it post?',
      hint: channels.length
        ? 'Text channels in your Buffer account. Pick as many as you like.'
        : syncing
          ? 'Reading your channels from Buffer.'
          : (syncError ??
            'No text channels found. Connect X, LinkedIn, Threads, Bluesky or Mastodon in Buffer, then sync again.'),
      valid: a.channelIds.length > 0,
      body: (
        <div className="setup-blocks">
          {channels.length ? null : (
            <button
              type="button"
              className="app-gate-secondary"
              disabled={syncing}
              onClick={runSync}
            >
              {syncing ? 'Syncing channels' : 'Sync channels'}
            </button>
          )}
          {channels.map((c) => (
            <Block
              key={c.channelId}
              type="checkbox"
              name="channels"
              className="is-channel"
              checked={a.channelIds.includes(c.channelId)}
              onChange={() =>
                set(
                  'channelIds',
                  a.channelIds.includes(c.channelId)
                    ? a.channelIds.filter((x) => x !== c.channelId)
                    : [...a.channelIds, c.channelId],
                )
              }
              detail={serviceName(c.service)}
            >
              <ChannelMark channel={serviceName(c.service)} size={20} />
              {c.name}
            </Block>
          ))}
        </div>
      ),
    },
    {
      label: 'Anything to avoid?',
      optional: true,
      valid: true,
      body: (
        <input
          id={`${id}-avoid`}
          className="setup-input setup-field"
          value={a.avoid}
          maxLength={500}
          onChange={(e) => set('avoid', e.target.value)}
          placeholder="Rumours without a named source, betting"
        />
      ),
    },
    {
      label: 'Any sources you prefer?',
      optional: true,
      hint: 'Sites or URLs, separated by commas. Unless you tick the box, it can find other reliable sources too.',
      valid: true,
      body: (
        <>
          <textarea
            id={`${id}-sources`}
            className="setup-input setup-field"
            rows={2}
            value={a.sources}
            onChange={(e) => set('sources', e.target.value)}
            placeholder="formula1.com, the-race.com"
          />
          <Block
            type="checkbox"
            name="only"
            className="is-wide"
            checked={a.onlyTheseSources}
            onChange={() => set('onlyTheseSources', !a.onlyTheseSources)}
          >
            Only use these sources
          </Block>
        </>
      ),
    },
    {
      label: 'When should it run?',
      hint: 'In your time zone.',
      valid: /^\d{2}:\d{2}$/.test(a.time),
      body: (
        <div className="setup-blocks">
          <Block
            name="preset"
            checked={a.preset === 'daily'}
            onChange={() => set('preset', 'daily')}
          >
            Daily
          </Block>
          <Block
            name="preset"
            checked={a.preset === 'weekly'}
            onChange={() => set('preset', 'weekly')}
          >
            Weekly
          </Block>
          {a.preset === 'weekly' ? (
            <select
              className="app-select setup-select"
              value={a.weekday}
              aria-label="Weekday"
              onChange={(e) => set('weekday', e.target.value as Answers['weekday'])}
            >
              {WEEKDAYS.map(([v, n]) => (
                <option key={v} value={v}>
                  {n}
                </option>
              ))}
            </select>
          ) : null}
          <label className="setup-block setup-time tabular">
            <span className="setup-block-detail">At</span>
            <input
              type="time"
              value={a.time}
              step={300}
              onChange={(e) => set('time', e.target.value)}
            />
          </label>
        </div>
      ),
    },
    {
      label:
        a.preset === 'daily'
          ? 'How many stories a day, at most?'
          : 'How many stories a week, at most?',
      hint: 'Each story gets a post for every channel. It never repeats what you’ve posted or scheduled, and posts fewer on slow news days.',
      valid: true,
      body: (
        <div className="setup-blocks is-numbers">
          {[1, 2, 3].map((n) => (
            <Block
              key={n}
              name="stories"
              className="tabular"
              checked={a.maxStories === n}
              onChange={() => set('maxStories', n)}
            >
              {n}
            </Block>
          ))}
        </div>
      ),
    },
    {
      label: 'How should posts reach Buffer?',
      valid: true,
      body: (
        <div className="setup-blocks">
          <Block
            name="mode"
            checked={a.postingMode === 'draft'}
            onChange={() => set('postingMode', 'draft')}
            detail="They wait in Buffer for your approval."
          >
            Save as drafts
          </Block>
          <Block
            name="mode"
            checked={a.postingMode === 'queue'}
            onChange={() => set('postingMode', 'queue')}
            detail="Into your queue, at the next free slots."
          >
            Schedule them
          </Block>
        </div>
      ),
    },
  ]
  const done = index >= questions.length
  const q = questions[index]
  const chosen = channels.filter((c) => a.channelIds.includes(c.channelId))
  const rows: [string, string][] = [
    ['Research', a.research],
    ['Channels', chosen.map((c) => c.name).join(', ')],
    ['Avoid', a.avoid || (index > 2 ? 'Nothing' : '')],
    [
      'Sources',
      a.sources
        ? `${parseSources(a.sources).length} given${a.onlyTheseSources ? ', only these' : ', others allowed'}`
        : index > 3
          ? 'Any reliable source'
          : '',
    ],
    [
      'Runs',
      index > 4
        ? a.preset === 'daily'
          ? `Daily at ${a.time}`
          : `${WEEKDAYS.find(([v]) => v === a.weekday)?.[1]}s at ${a.time}`
        : '',
    ],
    [
      'Stories',
      index > 5 ? `Up to ${a.maxStories} a ${a.preset === 'daily' ? 'day' : 'week'}` : '',
    ],
    [
      'Posting',
      index > 6 ? (a.postingMode === 'draft' ? 'Drafts to approve' : 'Scheduled in Buffer') : '',
    ],
  ]

  const submit = () => {
    setPending(true)
    setError(null)
    create({
      channelIds: a.channelIds,
      setup: {
        research: a.research.trim(),
        services: [],
        avoid: a.avoid.trim(),
        sources: parseSources(a.sources),
        onlyTheseSources: a.onlyTheseSources,
        cadence: {
          preset: a.preset,
          time: a.time,
          weekday: a.preset === 'weekly' ? a.weekday : null,
        },
        maxStories: a.maxStories,
        postingMode: a.postingMode,
      },
    })
      .then((automationId) => navigate({ to: '/app/a/$id', params: { id: automationId } }))
      .catch((reason: unknown) => {
        setPending(false)
        setError(errorText(reason, 'It did not save. Try again.'))
      })
  }

  if (connection === undefined) return null
  return (
    <>
      <p className="app-crumbs">
        <Link to="/app">Home</Link>
      </p>
      <h1>New automation.</h1>
      <form
        className="setup-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (done) submit()
          else if (q?.valid) setIndex(index + 1)
        }}
      >
        <div className="setup-stage">
          <div className="setup-progress" aria-hidden="true">
            {questions.map((_, i) => (
              <span key={i} data-done={i < index} />
            ))}
          </div>
          {q ? (
            <div className="setup-question" key={index}>
              <p className="setup-count">
                Question {index + 1} of {questions.length}
                {q.optional ? ', optional' : ''}
              </p>
              <h2 className="setup-title">{q.label}</h2>
              <div className="setup-answer">{q.body}</div>
              {q.hint ? <p className="setup-hint">{q.hint}</p> : null}
              <div className="app-gate-actions setup-nav">
                {index > 0 ? (
                  <button
                    type="button"
                    className="app-gate-secondary"
                    onClick={() => setIndex(index - 1)}
                  >
                    Back
                  </button>
                ) : null}
                <button type="submit" className="app-gate-primary" disabled={!q.valid}>
                  {index === questions.length - 1 ? 'Check answers' : 'Next'}
                </button>
              </div>
            </div>
          ) : (
            <div className="setup-question setup-done" key="done">
              <h2 className="setup-title">That’s everything.</h2>
              <p className="setup-hint">
                Check your answers, then create the playbook. It takes about a minute: it reads your
                sources before it writes.
              </p>
              <div className="app-gate-actions setup-nav">
                <button
                  type="button"
                  className="app-gate-secondary"
                  onClick={() => setIndex(questions.length - 1)}
                  disabled={pending}
                >
                  Back
                </button>
                <button type="submit" className="app-gate-primary" disabled={pending}>
                  {pending ? 'Creating playbook' : 'Create playbook'}
                </button>
              </div>
              {error ? (
                <p className="app-connection-error" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          )}
        </div>
        <dl className="setup-answers setup-live" aria-label="Your answers">
          {rows.map(([name, value], i) => (
            <div key={name} data-current={i === index} data-done={i < index && value !== ''}>
              <dt>
                <button
                  type="button"
                  className="setup-jump"
                  onClick={() => setIndex(i)}
                  disabled={i > index}
                >
                  {name}
                </button>
              </dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </form>
    </>
  )
}
