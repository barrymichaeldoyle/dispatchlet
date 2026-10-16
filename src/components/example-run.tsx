import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Wordmark } from './wordmark'

const DURATION = 36000
const PROMPT =
  'Find positive news about conservation and communities. Use trusted sources, skip company PR, and never repeat a story. Write one post for X and LinkedIn every morning. Save drafts for me to review.'
const STAGES = ['Your brief', 'The playbook', 'Research', 'Your drafts', 'In Buffer']
const STARTS = [0, 6500, 14000, 24000, 33000]
const TITLES = [
  'Start with what you care about.',
  'A playbook built around your brief.',
  'Follow the work as it happens.',
  'One story. Written for each channel.',
  'Ready for your review in Buffer.',
]
const NOTES = [
  'A paragraph is all it takes to give your agent direction.',
  'You can edit the sources, voice and rules before the first run.',
  'See the searches, sources and decisions behind every post.',
  'The same research, with copy adapted for X and LinkedIn.',
  'Review your drafts, then let the same playbook run tomorrow.',
]
const RULES = [
  ['Sources', 'Positive News, Good News Network, BBC and The Guardian.'],
  ['Voice', 'Warm and factual. Specific details, no hype.'],
  ['Rules', 'Verify the source. Skip company PR and stories already covered.'],
  ['Delivery', 'Every morning · X + LinkedIn · Save as drafts'],
]
const EVENTS = [
  [
    14500,
    'Searching trusted sources',
    'Looking for conservation and community stories from the last 48 hours.',
  ],
  [
    17000,
    'Reading the sources',
    '7 searches · 11 pages read. Checking dates and original reporting.',
  ],
  [
    19500,
    'Checking what you’ve already covered',
    'Comparing candidates with previous runs. No repeat stories.',
  ],
  [
    21500,
    'Choosing a story',
    'Kept: a conservation recovery. Skipped: company PR. Saved a repair café story for a later run.',
  ],
] as const
const POSTS = [
  [
    'X',
    '[Species] numbers in [region] have doubled since a reserve was set up ten years ago, according to [conservation body]. Slow work, but it works. theguardian.com/…',
  ],
  [
    'LinkedIn',
    'Ten years ago [region] set aside a reserve for [species]. This week [conservation body] reported the population has doubled.\n\nIt took patience, local rangers and not much money. The full story is in the link.',
  ],
]

function Icon({ kind }: { kind: 'play' | 'pause' | 'replay' | 'check' | 'arrow' | 'close' }) {
  return (
    <svg
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
}: {
  text: string
  elapsed: number
  start: number
  duration: number
  reduced: boolean
}) {
  return (
    <>
      <span className="flow-stream" aria-hidden="true">
        {stream(text, elapsed, start, duration, reduced)}
      </span>
      <span className="sr-only">{text}</span>
    </>
  )
}

const subscribe = () => () => {}

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
  const [elapsed, setElapsed] = useState(0)
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
    if (focused) workspace.current?.scrollTo({ top: 0, behavior: 'instant' })
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Each chapter starts at the top of the stage.
  }, [stage, focused])

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
  const play = () => {
    if (complete) setElapsed(0)
    setPlaying((value) => (complete ? true : !value))
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
          <p>Watch a brief become a playbook, research and two drafts ready to review.</p>
          <span className="flow-duration">36-second walkthrough · Opens full screen</span>
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
            className="flow-workspace"
            tabIndex={0}
            role="region"
            aria-label="Current walkthrough step"
          >
            <div className="flow-caption">
              <h3>{TITLES[stage]}</h3>
              <p>{NOTES[stage]}</p>
            </div>
            <div key={stage} className="flow-scene">
              {stage === 0 ? (
                <div className="flow-prompt">
                  <div className="flow-field-label">What would you like to post about?</div>
                  <div className="flow-input" role="group" aria-label="Example brief">
                    <StreamText
                      text={PROMPT}
                      elapsed={elapsed}
                      start={650}
                      duration={4400}
                      reduced={reduced}
                    />
                    {elapsed < 5200 ? <span className="flow-caret" aria-hidden="true" /> : null}
                  </div>
                  <div className="flow-submit-row">
                    <span>Good News Today</span>
                    <span className={`flow-submit ${elapsed >= 6000 ? 'is-clicked' : ''}`}>
                      Create playbook <Icon kind="arrow" />
                    </span>
                  </div>
                  {elapsed > 5100 ? (
                    <div
                      className={`flow-cursor ${elapsed >= 6000 ? 'is-clicking' : ''}`}
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
              ) : null}
              {stage === 1 ? (
                <div className="flow-playbook">
                  <div className="flow-document-title">
                    <span>Good News Today</span>
                    <span className="flow-tag">Playbook</span>
                  </div>
                  {RULES.map(([name, value], index) =>
                    elapsed >= 7000 + index * 1400 ? (
                      <div className="flow-rule" key={name}>
                        <span>{name}</span>
                        <p>
                          <StreamText
                            text={value}
                            elapsed={elapsed}
                            start={7000 + index * 1400}
                            duration={1000}
                            reduced={reduced}
                          />
                        </p>
                      </div>
                    ) : null,
                  )}
                  {elapsed >= 12500 ? (
                    <div className="flow-ready">
                      <Icon kind="check" /> Playbook ready. Starting the first run.
                    </div>
                  ) : null}
                </div>
              ) : null}
              {stage === 2 ? (
                <div className="flow-research">
                  {EVENTS.map(([start, title, detail], index) =>
                    elapsed >= start ? (
                      <div className="flow-event" key={title}>
                        <span
                          className={`flow-event-marker ${elapsed >= (EVENTS[index + 1]?.[0] ?? 23500) ? 'is-done' : ''}`}
                        >
                          {elapsed >= (EVENTS[index + 1]?.[0] ?? 23500) ? (
                            <Icon kind="check" />
                          ) : (
                            <span className="flow-spinner" />
                          )}
                        </span>
                        <div>
                          <strong>{title}</strong>
                          <p>
                            <StreamText
                              text={detail}
                              elapsed={elapsed}
                              start={start}
                              duration={1400}
                              reduced={reduced}
                            />
                          </p>
                        </div>
                      </div>
                    ) : null,
                  )}
                </div>
              ) : null}
              {stage === 3 ? (
                <div className="flow-posts">
                  {POSTS.map(([channel, text], index) =>
                    elapsed >= 24200 + index * 3600 ? (
                      <article className="flow-post" key={channel}>
                        <div className="flow-post-heading">
                          <strong>
                            Good News Today <span>on {channel}</span>
                          </strong>
                          <span className="flow-tag">
                            {elapsed >= 31600 ? 'Draft ready' : 'Writing'}
                          </span>
                        </div>
                        <p>
                          <StreamText
                            text={text}
                            elapsed={elapsed}
                            start={24200 + index * 3600}
                            duration={3300}
                            reduced={reduced}
                          />
                        </p>
                      </article>
                    ) : null,
                  )}
                </div>
              ) : null}
              {stage === 4 ? (
                <div className="flow-finish">
                  <div className="flow-success">
                    <Icon kind="check" />
                  </div>
                  <h4>Two drafts. Your final say.</h4>
                  <p>
                    Saved to Buffer for X and LinkedIn.
                    <br />
                    Both tagged Dispatchlet and ready for review.
                  </p>
                  <div className="flow-receipt">
                    <span>Good News Today</span>
                    <span className="flow-tag">2 drafts saved</span>
                  </div>
                  <div className="flow-next">
                    <Icon kind="check" /> Tomorrow, the playbook runs again.
                  </div>
                </div>
              ) : null}
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
                  <Icon kind={complete ? 'replay' : playing ? 'pause' : 'play'} />
                  {complete ? 'Replay' : playing ? 'Pause' : 'Resume'}
                </button>
              ) : null}
              <span className="flow-time" aria-hidden="true">
                {String(Math.floor(elapsed / 1000)).padStart(2, '0')} / 36 sec
              </span>
            </div>
          </div>
          <div
            className="flow-progress"
            role="progressbar"
            aria-label="Walkthrough progress"
            aria-valuenow={Math.floor(elapsed / 1000)}
            aria-valuemin={0}
            aria-valuemax={36}
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
              and previous runs, keeps a conservation recovery story, skips company PR and saves a
              repair café story for later.
            </p>
          </li>
          <li>
            <h3>Review the channel-specific drafts</h3>
            {POSTS.map(([channel, text]) => (
              <div key={channel}>
                <h4>{channel}</h4>
                <p>{text}</p>
              </div>
            ))}
          </li>
          <li>
            <h3>Find your drafts in Buffer</h3>
            <p>
              Both posts are saved as drafts and tagged Dispatchlet. You review them before they go
              out. The playbook runs again the next morning.
            </p>
          </li>
        </ol>
      </details>
    </section>
  )
}
