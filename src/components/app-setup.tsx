import { Link, useNavigate } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { api } from '../../convex/_generated/api'
import { ChannelMark } from './brand-icons'
import { Avatar } from './nav-icons'
import { TEMPLATES } from '../../convex/lib/templates'
import { channelHint, channelProblem, errorText, serviceName } from '../lib/format'
import { BusyLabel } from './busy-label'

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
  maxStories: 1,
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
      {type === 'checkbox' ? <span className="setup-check" aria-hidden="true" /> : null}
      <span className="setup-block-title">{children}</span>
      {detail ? <span className="setup-block-detail">{detail}</span> : null}
    </label>
  )
}

/**
 * A one-answer text box that grows with what's typed, so a long topic wraps instead of scrolling
 * out of sight. Enter still moves on, as it does in a single-line field; line breaks never go in.
 */
function GrowingText({
  value,
  onChange,
  ...rest
}: {
  id: string
  value: string
  maxLength: number
  autoFocus?: boolean
  placeholder?: string
  'aria-label': string
  onChange: (value: string) => void
}) {
  return (
    <textarea
      {...rest}
      ref={fit}
      rows={1}
      className="setup-input setup-field setup-grow"
      value={value}
      onChange={(e) => {
        onChange(e.target.value.replace(/\s*\n\s*/g, ' '))
        fit(e.target)
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
        e.preventDefault()
        e.currentTarget.form?.requestSubmit()
      }}
    />
  )
}

/** Browsers without field-sizing: content take the box's height from its text. */
function fit(el: HTMLTextAreaElement | null) {
  if (!el || CSS.supports('field-sizing', 'content')) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
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
  const blocked = (connection?.channels ?? []).filter((c) => !c.usable)
  const needsAttention = blocked.filter((c) => c.problem !== 'unsupported')
  const others = [
    ...new Set(blocked.filter((c) => c.problem === 'unsupported').map((c) => c.service)),
  ]
  // Answers the person has given themselves. An example fills in the rest, never these.
  const [touched, setTouched] = useState<ReadonlySet<keyof Answers>>(new Set())
  const set = <K extends keyof Answers>(key: K, value: Answers[K]) => {
    setA((prev) => ({ ...prev, [key]: value }))
    if (key !== 'research') setTouched((prev) => new Set(prev).add(key))
  }

  const questions: {
    label: string
    hint?: string
    /** Set on optional questions: true while nothing has been answered, so Next reads Skip. */
    blank?: boolean
    valid: boolean
    body: ReactNode
  }[] = [
    {
      label: 'What should it research?',
      valid: a.research.trim().length > 0,
      body: (
        <>
          <GrowingText
            id={`${id}-research`}
            aria-label="What should it research?"
            placeholder="e.g. electric bikes in Europe"
            value={a.research}
            maxLength={300}
            autoFocus
            onChange={(value) => set('research', value)}
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
                  const example: Omit<Answers, 'channelIds'> = {
                    research: w.research,
                    avoid: w.avoid,
                    sources: w.sources.join(', '),
                    onlyTheseSources: w.onlyTheseSources,
                    preset: w.cadence.preset,
                    time: w.cadence.time,
                    weekday: (w.cadence.weekday ?? 'mon') as Answers['weekday'],
                    maxStories: w.maxStories,
                    postingMode: w.postingMode,
                  }
                  setA((prev) => {
                    const next = { ...prev }
                    for (const key of Object.keys(example) as (keyof typeof example)[])
                      if (!touched.has(key)) Object.assign(next, { [key]: example[key] })
                    return next
                  })
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
      // With channels to pick, the ones it can't use are listed by name below, so the hint
      // doesn't repeat them.
      hint: channelHint({
        usable: channels.length,
        blocked: needsAttention.length,
        others: channels.length ? [] : others,
        syncing,
        syncError,
      }),
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
              <BusyLabel busy={syncing} idle="Sync channels" working="Syncing channels" />
            </button>
          )}
          {channels.length ? (
            <div className="setup-channels">
              {channels.map((c) => {
                const checked = a.channelIds.includes(c.channelId)
                return (
                  <label
                    key={c.channelId}
                    className="setup-block setup-choice setup-channel"
                    data-checked={checked}
                  >
                    <input
                      type="checkbox"
                      name="channels"
                      checked={checked}
                      onChange={() =>
                        set(
                          'channelIds',
                          checked
                            ? a.channelIds.filter((x) => x !== c.channelId)
                            : [...a.channelIds, c.channelId],
                        )
                      }
                      className="sr-only"
                    />
                    <Avatar src={c.avatar} size={36} badge>
                      <ChannelMark channel={serviceName(c.service)} size={c.avatar ? 9 : 16} />
                    </Avatar>
                    <span className="setup-channel-text">
                      <span className="setup-channel-name">{c.name}</span>
                      <span className="setup-block-detail">{serviceName(c.service)}</span>
                    </span>
                    <span className="setup-check" aria-hidden="true" />
                  </label>
                )
              })}
            </div>
          ) : null}
          {blocked.length ? (
            <div className="setup-unavailable">
              <p>{channels.length ? 'Can’t use' : 'In your Buffer account'}</p>
              <ul>
                {blocked.map((c) => (
                  <li key={c.channelId}>
                    <ChannelMark channel={serviceName(c.service)} size={14} />
                    <span className="setup-unavailable-name">{c.name}</span>
                    <span>{channelProblem(c.problem, c.service)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ),
    },
    {
      label: 'Anything to avoid?',
      blank: !a.avoid.trim(),
      hint: 'For example, rumours without a named source, or betting. Leave it blank to skip.',
      valid: true,
      body: (
        <input
          id={`${id}-avoid`}
          className="setup-input setup-field"
          value={a.avoid}
          maxLength={500}
          onChange={(e) => set('avoid', e.target.value)}
        />
      ),
    },
    {
      label: 'Any sources you prefer?',
      blank: !a.sources.trim(),
      hint: 'Sites or URLs, separated by commas, like formula1.com. Leave it blank to skip and it finds reliable sources itself.',
      valid: true,
      body: (
        <>
          <textarea
            id={`${id}-sources`}
            className="setup-input setup-field"
            rows={2}
            value={a.sources}
            onChange={(e) => set('sources', e.target.value)}
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
          <label className="setup-block setup-time">
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
      <form
        className="setup-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (done) submit()
          else if (q?.valid) setIndex(index + 1)
        }}
      >
        <div className="setup-stage">
          <div className="setup-count">
            <h1>New automation</h1>
            <span aria-hidden="true">·</span>
            <span className="tabular">
              {done ? 'Review' : `Step ${index + 1} of ${questions.length}`}
            </span>
            {q?.blank === undefined ? null : <span className="setup-optional">Optional</span>}
          </div>
          {q ? (
            <div className="setup-question" key={index}>
              <h2 className="setup-title">{q.label}</h2>
              {q.hint ? <p className="setup-hint setup-lede">{q.hint}</p> : null}
              <div className="setup-answer">{q.body}</div>
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
                  <BusyLabel
                    busy={q.blank === true || index === questions.length - 1}
                    idle="Next"
                    working={q.blank === true ? 'Skip' : 'Check answers'}
                  />
                </button>
              </div>
            </div>
          ) : (
            <div className="setup-question setup-done" key="done">
              <h2 className="setup-title">That’s everything</h2>
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
                  <BusyLabel busy={pending} idle="Create playbook" working="Creating playbook" />
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
