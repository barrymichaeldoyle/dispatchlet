import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Wordmark } from './wordmark'

const DURATION = 65000
const TOTAL_SECONDS = DURATION / 1000
const PROMPT =
  'Find three positive stories each morning about conservation and communities. Skip company PR and anything we’ve posted before. Write for X and LinkedIn, and schedule each story three hours apart.'
const STAGES = ['Your brief', 'The playbook', 'Research', 'Your posts', 'In Buffer']
const STARTS = [0, 11000, 23000, 41000, 54000]
const TITLES = [
  'Start with what you care about.',
  'A playbook built around your brief.',
  'Fresh stories. No repeats.',
  'One story, written for each channel.',
  'A day of posts, thoughtfully spaced.',
]
const NOTES = [
  'A paragraph is all it takes to give your agent direction.',
  'You can edit the sources, voice and rules before the first run.',
  'The agent checks previous posts before choosing what to share.',
  'Three fresh stories become six posts. Here’s one example.',
  'Spread mode leaves three hours between stories. Tomorrow, the agent runs again.',
]
const RULES = [
  ['Sources', 'Positive News, Good News Network, BBC and The Guardian.'],
  ['Voice', 'Warm and factual. Specific details, no hype.'],
  ['Rules', 'Verify the source. Skip company PR and stories already covered.'],
  ['Delivery', '3 stories each morning · X + LinkedIn · Spread 3 hours apart'],
]
const EVENTS = [
  [23700, 'Searching trusted sources', 'Finding fresh conservation and community reporting.'],
  [27000, 'Reading the sources', '7 searches · 11 pages read. Original reporting verified.'],
  [30500, 'Checking what you’ve already covered', 'Matching candidates against previous posts.'],
] as const
const STORIES = [
  {
    title: 'Wildlife makes a comeback',
    time: '09:00',
    posts: [
      [
        'X',
        'Wildlife is making a comeback after a decade of habitat restoration. Patient conservation pays off. [Source link]',
      ],
      [
        'LinkedIn',
        'A decade of local conservation work is helping wildlife recover. A reminder that long-term investment in restoring habitats can make a difference. [Source link]',
      ],
    ],
  },
  {
    title: 'A repair café brings neighbours together',
    time: '12:00',
    posts: [
      [
        'X',
        'Broken toaster? Meet your neighbours. A community repair café keeps everyday things in use and brings people together. [Source link]',
      ],
      [
        'LinkedIn',
        'A neighbourhood repair café is turning everyday repairs into community connections. Less waste, more shared skills. [Source link]',
      ],
    ],
  },
  {
    title: 'Community solar funds local projects',
    time: '15:00',
    posts: [
      [
        'X',
        'Clean energy with a local return: a community solar project puts its proceeds back into neighbourhood projects. [Source link]',
      ],
      [
        'LinkedIn',
        'Community-owned solar can do more than generate electricity. This project reinvests its proceeds in local priorities. [Source link]',
      ],
    ],
  },
]
const CANDIDATES = [
  ...STORIES.map(({ title }) => [title, 'Fresh · selected']),
  ['The urban garden story', 'Already posted · skipped'],
  ['A company’s new product launch', 'Company PR · skipped'],
]

function Icon({ kind }: { kind: 'play' | 'pause' | 'replay' | 'check' | 'arrow' | 'close' }) {
  return (
    <svg
      className={kind === 'check' ? 'flow-check' : undefined}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === 'play' ? <path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none" /> : null}
      {kind === 'pause' ? <path d="M9 5v14M16 5v14" /> : null}
      {kind === 'replay' ? (
        <>
          <path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" />
        </>
      ) : null}
      {kind === 'check' ? <path d="m5 12 4 4L19 6" /> : null}
      {kind === 'close' ? <path d="m6 6 12 12M6 18 18 6" /> : null}
      {kind === 'arrow' ? <path d="M5 12h14m-5-5 5 5-5 5" /> : null}
    </svg>
  )
}

function stream(text: string, elapsed: number, start: number, duration: number, reduced: boolean) {
  return text.slice(
    0,
    Math.floor(
      text.length * Math.min(1, Math.max(0, (elapsed - start) / (reduced ? 1 : duration))),
    ),
  )
}

function StreamText({
  text,
  elapsed,
  start,
  duration,
  reduced,
  caret = false,
}: {
  text: string
  elapsed: number
  start: number
  duration: number
  reduced: boolean
  caret?: boolean
}) {
  return (
    <>
      <span className="flow-text" aria-hidden="true">
        <span className="flow-measure">
          {text}
          <span className="flow-caret-space" />
        </span>
        <span className="flow-stream">
          {stream(text, elapsed, start, duration, reduced)}
          {caret ? <span className="flow-caret" /> : null}
        </span>
      </span>
      <span className="sr-only">{text}</span>
    </>
  )
}

function FlowPanel({
  index,
  stage,
  overview,
  title,
  waiting,
  children,
}: {
  index: number
  stage: number
  overview: boolean
  title: string
  waiting: string
  children: ReactNode
}) {
  const visible = overview ? stage >= index : stage === index
  return (
    <section
      className={`flow-panel flow-panel-${index}`}
      hidden={!overview && !visible}
      aria-label={title}
      tabIndex={overview && index > 1 ? 0 : undefined}
      data-active={stage === index}
      data-pending={stage < index}
    >
      <h3 className="flow-panel-title">{title}</h3>
      {visible ? (
        <div className="flow-panel-content">{children}</div>
      ) : overview ? (
        <p className="flow-panel-waiting">{waiting}</p>
      ) : null}
    </section>
  )
}

const subscribe = () => () => {}
const OVERVIEW_QUERY = '(min-width: 1100px) and (min-height: 650px)'
const subscribeLayout = (onChange: () => void) => {
  const layout = window.matchMedia(OVERVIEW_QUERY)
  layout.addEventListener('change', onChange)
  return () => layout.removeEventListener('change', onChange)
}
const getOverview = () => window.matchMedia(OVERVIEW_QUERY).matches

export function ExampleRun() {
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
  const dialog = useRef<HTMLDialogElement>(null)
  const closeControl = useRef<HTMLButtonElement>(null)
  const readControl = useRef<HTMLButtonElement>(null)
  const workspace = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const transcript = useRef<HTMLDetailsElement>(null)
  const readAfterClose = useRef(false)
  const [focused, setFocused] = useState(false)
  const overview = useSyncExternalStore(subscribeLayout, getOverview, () => false)
  const [elapsed, setElapsed] = useState(0)
  const [runId, setRunId] = useState(0)
  const [running, setPlaying] = useState(false)
  const [started, setStarted] = useState(false)
  const [reduced, setReduced] = useState(false)
  const complete = elapsed >= DURATION
  const playing = focused && running && !complete
  const stage = STARTS.reduce((current, start, index) => (elapsed >= start ? index : current), 0)

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(preference.matches)
    update()
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!playing) return
    let previous = performance.now()
    const timer = window.setInterval(() => {
      const now = performance.now()
      const delta = now - previous
      setElapsed((value) => Math.min(DURATION, value + delta))
      previous = now
    }, 50)
    return () => window.clearInterval(timer)
  }, [playing])

  useEffect(() => {
    const pauseWhenHidden = () => {
      if (document.hidden) setPlaying(false)
    }
    document.addEventListener('visibilitychange', pauseWhenHidden)
    return () => {
      document.removeEventListener('visibilitychange', pauseWhenHidden)
    }
  }, [])

  useEffect(() => {
    if (!focused) return
    const previous = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = previous
    }
  }, [focused])

  useEffect(() => {
    if (focused && !overview) workspace.current?.scrollTo({ top: 0, behavior: 'instant' })
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Each chapter starts at the top of the stage.
  }, [stage, focused, overview])

  const launch = (button: HTMLButtonElement) => {
    opener.current = button
    if (complete) setElapsed(0)
    setStarted(true)
    setPlaying(true)
    dialog.current?.showModal()
    setFocused(true)
  }
  const close = () => {
    setPlaying(false)
    dialog.current?.close()
  }
  const restart = () => {
    setElapsed(0)
    setRunId((value) => value + 1)
    setStarted(true)
    setPlaying(true)
    workspace.current?.scrollTo({ top: 0, behavior: 'instant' })
  }
  const play = () => {
    if (complete) restart()
    else setPlaying((value) => !value)
  }
  const seek = (index: number) => {
    setStarted(true)
    setPlaying(false)
    setElapsed(index === STAGES.length - 1 ? DURATION : STARTS[index + 1] - 50)
  }
  const label = complete ? 'Replay demo' : started ? 'Resume demo' : 'Play the demo'

  return (
    <section id="run" aria-label="Example run" className="flow-section">
      <div className="flow-heading">
        <div>
          <h2>From a brief to a fresh Buffer queue.</h2>
          <p>Follow Good News Today’s first run, start to finish.</p>
        </div>
        <button
          type="button"
          className="flow-control"
          onClick={(event) => launch(event.currentTarget)}
          disabled={!ready}
          aria-controls="flow-dialog"
          aria-haspopup="dialog"
        >
          <Icon kind={complete ? 'replay' : 'play'} />
          {label}
        </button>
      </div>

      <div className="flow-preview">
        <div className="flow-intro">
          <button
            type="button"
            className="flow-play"
            disabled={!ready}
            onClick={(event) => launch(event.currentTarget)}
            aria-label="Play the full walkthrough"
            aria-haspopup="dialog"
            aria-controls="flow-dialog"
          >
            <Icon kind="play" />
          </button>
          <h3>
            You bring the direction.
            <br />
            Dispatchlet takes it from there.
          </h3>
          <p>
            Watch a brief become a playbook, research, duplicate checks and six scheduled posts.
          </p>
          <span className="flow-duration">
            {TOTAL_SECONDS}-second walkthrough · Opens full screen
          </span>
        </div>
      </div>

      <dialog
        ref={dialog}
        id="flow-dialog"
        className="flow-dialog"
        aria-label="Dispatchlet walkthrough"
        aria-describedby="walkthrough-description"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return
          if (event.shiftKey && document.activeElement === closeControl.current) {
            event.preventDefault()
            readControl.current?.focus()
          } else if (!event.shiftKey && document.activeElement === readControl.current) {
            event.preventDefault()
            closeControl.current?.focus()
          }
        }}
        onClose={() => {
          setFocused(false)
          setPlaying(false)
          if (readAfterClose.current) {
            readAfterClose.current = false
            if (transcript.current) {
              transcript.current.open = true
              transcript.current.querySelector('summary')?.focus()
            }
          } else opener.current?.focus({ preventScroll: true })
        }}
      >
        <header className="flow-focus-header">
          <div className="flow-focus-brand">
            <Wordmark />
            <h2>Good News Today</h2>
          </div>
          <button
            type="button"
            ref={closeControl}
            className="flow-close"
            onClick={close}
            aria-label="Close walkthrough"
          >
            Close <Icon kind="close" />
          </button>
        </header>
        <div className={`flow-demo ${playing ? 'is-playing' : ''}`}>
          <ol className="flow-stages" aria-label="Demo progress">
            {STAGES.map((name, index) => (
              <li
                key={name}
                className={started && index <= stage ? 'is-current' : ''}
                aria-current={started && index === stage ? 'step' : undefined}
              >
                <button
                  type="button"
                  onClick={() => seek(index)}
                  disabled={!ready}

                  aria-controls="flow-workspace"
                >
                  <span className="flow-stage-number" aria-hidden="true">
                    {started && index < stage ? <Icon kind="check" /> : index + 1}
                  </span>
                  <span>{name}</span>
                </button>
              </li>
            ))}
          </ol>
          <div
            ref={workspace}
            id="flow-workspace"
            className={`flow-workspace ${overview ? 'is-overview' : ''}`}
            tabIndex={0}
            role="region"
            aria-label={overview ? 'Live walkthrough workspace' : 'Current walkthrough step'}
          >
            <div className="flow-caption" hidden={overview}>
              {TITLES.map((title, index) => (
                <div
                  key={title}
                  className={index === stage ? 'is-active' : ''}
                  aria-hidden={index !== stage || undefined}
                >
                  <h3>{title}</h3>
                  <p>{NOTES[index]}</p>
                </div>
              ))}
            </div>
            <div key={overview ? runId : `${runId}-${stage}`} className="flow-scene">
              <div
                className="flow-context"
                tabIndex={overview ? 0 : undefined}
                role={overview ? 'region' : undefined}
                aria-label={overview ? 'Brief and playbook' : undefined}
              >
                <FlowPanel
                  index={0}
                  stage={stage}
                  overview={overview}
                  title="Your brief"
                  waiting=""
                >
                  <div className="flow-prompt">
                    <div className="flow-field-label">What would you like to post about?</div>
                    <div className="flow-input" role="group" aria-label="Example brief">
                      <StreamText
                        text={PROMPT}
                        elapsed={elapsed}
                        start={800}
                        duration={6000}
                        reduced={reduced}
                        caret={elapsed < 7000}
                      />
                    </div>
                    <div className="flow-submit-row">
                      <span>Good News Today</span>
                      <span className={`flow-submit ${elapsed >= 10000 ? 'is-clicked' : ''}`}>
                        Create playbook <Icon kind="arrow" />
                      </span>
                    </div>
                    {elapsed > 9000 && elapsed < 11000 ? (
                      <div
                        className={`flow-cursor ${elapsed >= 10000 ? 'is-clicking' : ''}`}
                        aria-hidden="true"
                      >
                        <svg width="26" height="30" viewBox="0 0 26 30">
                          <path
                            d="M3 2v23l6-6 5 10 5-3-5-9h9Z"
                            fill="var(--color-ink)"
                            stroke="var(--color-paper)"
                            strokeWidth="2"
                          />
                        </svg>
                      </div>
                    ) : null}
                  </div>
                </FlowPanel>
                <FlowPanel
                  index={1}
                  stage={stage}
                  overview={overview}
                  title="The playbook"
                  waiting="Your brief will become an editable playbook."
                >
                  <div className="flow-playbook">
                    <div className="flow-document-title">
                      <span>Good News Today</span>
                      <span className="flow-tag">Playbook</span>
                    </div>
                    {RULES.map(([name, value], index) => (
                      <div
                        className="flow-rule flow-reveal"
                        key={name}
                        data-revealed={elapsed >= 11600 + index * 2200}
                        aria-hidden={elapsed < 11600 + index * 2200 || undefined}
                      >
                        <span>{name}</span>
                        <p>
                          <StreamText
                            text={value}
                            elapsed={elapsed}
                            start={11600 + index * 2200}
                            duration={1400}
                            reduced={reduced}
                          />
                        </p>
                      </div>
                    ))}
                    <div
                      className="flow-ready flow-reveal"
                      data-revealed={elapsed >= 21400}
                      aria-hidden={elapsed < 21400 || undefined}
                    >
                      <Icon kind="check" /> Playbook ready. Starting the first run.
                    </div>
                  </div>
                </FlowPanel>
              </div>
              <FlowPanel
                index={2}
                stage={stage}
                overview={overview}
                title="Research"
                waiting="The agent will search and check previous posts."
              >
                <div className="flow-research">
                  {EVENTS.map(([start, title, detail], index) => (
                    <div
                      className="flow-event flow-reveal"
                      key={title}
                      data-revealed={elapsed >= start}
                      aria-hidden={elapsed < start || undefined}
                    >
                      <span
                        className={`flow-event-marker ${elapsed >= (EVENTS[index + 1]?.[0] ?? 34000) ? 'is-done' : ''}`}
                      >
                        {elapsed >= (EVENTS[index + 1]?.[0] ?? 34000) ? (
                          <Icon kind="check" />
                        ) : (
                          <span className="flow-spinner" />
                        )}
                      </span>
                      <div>
                        <strong>{title}</strong>
                        <p>{detail}</p>
                      </div>
                    </div>
                  ))}
                  <div
                    className="flow-candidates flow-reveal"
                    data-revealed={elapsed >= 34000}
                    aria-hidden={elapsed < 34000 || undefined}
                  >
                    <strong>5 candidates → 3 fresh stories</strong>
                    <ul>
                      {CANDIDATES.map(([title, status], index) => (
                        <li
                          key={title}
                          className={index < 3 ? 'is-selected' : index === 3 ? 'is-duplicate' : ''}
                        >
                          <span>{title}</span>
                          <span>{status}</span>
                        </li>
                      ))}
                    </ul>
                    <p>
                      The urban garden story matches a previous post. It won’t enter the queue
                      again.
                    </p>
                  </div>
                </div>
              </FlowPanel>
              <FlowPanel
                index={3}
                stage={stage}
                overview={overview}
                title="Channel posts"
                waiting="Fresh stories will become posts for each channel."
              >
                <div className="flow-writing">
                  <article className="flow-post">
                    <div className="flow-post-heading">
                      <strong>{STORIES[0].title}</strong>
                      <span className={`flow-tag ${elapsed >= 47000 ? 'is-ready' : ''}`}>
                        {elapsed >= 47000 ? '2 posts ready' : 'Writing'}
                      </span>
                    </div>
                    <div className="flow-channel-posts">
                      {STORIES[0].posts.map(([channel, text], index) => (
                        <div
                          className="flow-reveal"
                          key={channel}
                          data-revealed={elapsed >= (index === 0 ? 41700 : 44500)}
                          aria-hidden={elapsed < (index === 0 ? 41700 : 44500) || undefined}
                        >
                          <span className="flow-channel">{channel}</span>
                          <p>
                            <StreamText
                              text={text}
                              elapsed={elapsed}
                              start={index === 0 ? 41700 : 44500}
                              duration={index === 0 ? 1600 : 2300}
                              reduced={reduced}
                            />
                          </p>
                        </div>
                      ))}
                    </div>
                  </article>
                  <ul className="flow-story-results" aria-label="Other completed stories">
                    {STORIES.slice(1).map((story, index) => (
                      <li
                        className="flow-reveal"
                        key={story.title}
                        data-revealed={elapsed >= 49500 + index * 1000}
                        aria-hidden={elapsed < 49500 + index * 1000 || undefined}
                      >
                        <Icon kind="check" />
                        <div>
                          <strong>{story.title}</strong>
                          <span>2 posts ready · X + LinkedIn</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </FlowPanel>
              <FlowPanel
                index={4}
                stage={stage}
                overview={overview}
                title="Buffer schedule"
                waiting="Posts will be spaced through the day."
              >
                <div className="flow-finish">
                  <div className="flow-success">
                    <Icon kind="check" />
                  </div>
                  <h4>Three stories. A full day covered.</h4>
                  <p>6 posts scheduled in Buffer · X + LinkedIn</p>
                  <ol className="flow-schedule" aria-label="Scheduled stories">
                    {STORIES.map((story, index) => (
                      <li
                        key={story.title}
                        className="flow-reveal"
                        data-revealed={elapsed >= 54600 + index * 1400}
                        aria-hidden={elapsed < 54600 + index * 1400 || undefined}
                      >
                        <time>{story.time}</time>
                        <div>
                          <strong>{story.title}</strong>
                          <span>X + LinkedIn · Scheduled</span>
                        </div>
                        <Icon kind="check" />
                      </li>
                    ))}
                  </ol>
                  <div className="flow-receipt">
                    <span>3-hour gaps · No repeated stories</span>
                    <span className="flow-tag">6 posts scheduled</span>
                  </div>
                  <div className="flow-next">
                    <Icon kind="check" /> Tomorrow, the playbook runs again.
                  </div>
                </div>
              </FlowPanel>
            </div>
          </div>
          <div className="flow-player">
            <span aria-live="polite" aria-atomic="true">
              {!started
                ? 'Ready when you are'
                : complete
                  ? 'Walkthrough complete'
                  : `${playing ? 'Playing' : 'Paused'} · ${STAGES[stage]}`}
            </span>
            <div className="flow-player-actions">
              {!complete ? (
                <button
                  type="button"
                  className="flow-transport flow-restart"
                  onClick={restart}
                  aria-label="Restart walkthrough"
                  aria-controls="flow-workspace"
                >
                  <Icon kind="replay" /> Restart
                </button>
              ) : null}
              {started ? (
                <button
                  type="button"
                  className="flow-transport"
                  onClick={play}
                  aria-label={
                    complete
                      ? 'Replay walkthrough'
                      : playing
                        ? 'Pause walkthrough'
                        : 'Resume walkthrough'
                  }
                  aria-controls="flow-workspace"
                >
                  <Icon
                    key={complete ? 'replay' : playing ? 'pause' : 'play'}
                    kind={complete ? 'replay' : playing ? 'pause' : 'play'}
                  />
                  {complete ? 'Replay' : playing ? 'Pause' : 'Resume'}
                </button>
              ) : null}
              <span className="flow-time" aria-hidden="true">
                {String(Math.floor(elapsed / 1000)).padStart(2, '0')} / {TOTAL_SECONDS} sec
              </span>
            </div>
          </div>
          <div
            className="flow-progress"
            role="progressbar"
            aria-label="Walkthrough progress"
            aria-valuenow={Math.floor(elapsed / 1000)}
            aria-valuemin={0}
            aria-valuemax={TOTAL_SECONDS}
          >
            <span style={{ transform: `scaleX(${elapsed / DURATION})` }} />
          </div>
        </div>
        <footer className="flow-focus-footer">
          <p id="walkthrough-description">Illustrative demo. Story details are placeholders.</p>
          <button
            ref={readControl}
            type="button"
            onClick={() => {
              readAfterClose.current = true
              close()
            }}
          >
            Read instead
          </button>
        </footer>
      </dialog>
      <noscript>
        <p className="flow-disclaimer">
          The animation needs JavaScript. You can read the full walkthrough below.
        </p>
      </noscript>
      <p className="flow-disclaimer">
        Illustrative walkthrough, sped up. Story details are placeholders. Live runs start 28
        October.
      </p>
      <details
        ref={transcript}
        className="flow-transcript"
        onToggle={(event) => {
          if (event.currentTarget.open) setPlaying(false)
        }}
      >
        <summary>Read the full walkthrough</summary>
        <ol>
          <li>
            <h3>Give the agent a brief</h3>
            <p>{PROMPT}</p>
          </li>
          <li>
            <h3>Review your playbook</h3>
            <dl>
              {RULES.map(([name, value]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </li>
          <li>
            <h3>Follow the research</h3>
            <p>
              The agent searches trusted sources and reads the original reporting. It checks dates
              and previous runs, selects three fresh stories and skips both company PR and an urban
              garden story that was already posted.
            </p>
          </li>
          <li>
            <h3>See the channel-specific posts</h3>
            {STORIES.map((story) => (
              <div key={story.title}>
                <h4>{story.title}</h4>
                {story.posts.map(([channel, text]) => (
                  <p key={channel}>
                    <strong>{channel}:</strong> {text}
                  </p>
                ))}
              </div>
            ))}
          </li>
          <li>
            <h3>See the schedule in Buffer</h3>
            <p>
              Spread mode schedules the three stories at 09:00, 12:00 and 15:00, each for X and
              LinkedIn: six posts, with three hours between stories. The duplicate is excluded.
              Draft mode is also available if you prefer to review posts first. The playbook runs
              again the next morning.
            </p>
          </li>
        </ol>
      </details>
    </section>
  )
}
