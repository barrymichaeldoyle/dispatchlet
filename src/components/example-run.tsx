import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from 'react'
import { flushSync } from 'react-dom'
import { Wordmark } from './wordmark'
import { BrandText } from './brand-text'
import { ThemeToggle } from './theme-toggle'
import { Icon } from './flow-icon'
import { BufferMark, ChannelMark } from './brand-icons'
import { PostPreview } from './post-preview'
import { RunPoster } from './run-steps'
import { NextDay } from './next-day'
import { SetupAnswers, SetupQuestions } from './setup-form'
import { StreamText } from './stream-text'
import { useOnceInView } from '../lib/use-once-in-view'
import { useScrollable } from '../lib/use-scrollable'
import { CANDIDATES, PREVIOUS_POST, RULES, STORIES, TIMING, resolveAt } from '../lib/example-run'

const {
  CURSOR_START,
  CURSOR_TRAVEL,
  CLICK,
  EXPAND,
  CREATED,
  PLAYBOOK,
  RULE_START,
  RULE_INTERVAL,
  READY,
  RESEARCH,
  EVENT_STARTS,
  CANDIDATE_START,
  CANDIDATE_INTERVAL,
  MATCH,
  POSTS,
  X_START,
  X_DURATION,
  LI_START,
  LI_DURATION,
  POSTS_READY,
  STORY_2,
  STORY_3,
  WRITING_SETTLED,
  BUFFER,
  SLOT_START,
  SLOT_INTERVAL,
  RECEIPT,
  NEXT_DAY,
  DURATION,
} = TIMING
const TOTAL_SECONDS = DURATION / 1000
const SPEEDS = [0.5, 0.75, 1, 1.5, 2]
const SPEED_KEY = 'dispatchlet-demo-speed'
// The sources named in the playbook, as the agent reads them.
const SOURCE_TILES = ['Positive News', 'Good News Network', 'BBC', 'Guardian']
const STAGES = ['Your answers', 'The playbook', 'Research', 'Your posts', 'In Buffer']
const STARTS = [0, PLAYBOOK, RESEARCH, POSTS, BUFFER]
const TITLES = [
  'Answer a few quick questions.',
  'It writes a playbook.',
  'It finds new stories and skips repeats.',
  'It writes a post for each channel.',
  'It schedules them in Buffer.',
]
const NEXT_DAY_TITLE = 'Tomorrow, it runs again on its own.'
const NOTES = [
  'This is the only part you do. Skip the optional ones if you like.',
  'The plain-language instructions it follows on every run. You can edit it any time.',
  'It checks what you’ve already posted before choosing stories.',
  'Three stories, with a post for X and LinkedIn for each.',
  'Three stories, three hours apart. This one runs daily. Yours can run weekly instead.',
]
const EVENTS = [
  [
    EVENT_STARTS[0],
    'Searching trusted sources',
    'Looking for new conservation and community reporting.',
  ],
  [EVENT_STARTS[1], 'Reading the sources', '4 pages read, original reporting verified.'],
  [
    EVENT_STARTS[2],
    'Checking what you’ve already covered',
    'Matching each story against your previous posts.',
  ],
] as const
function cursorMotion(elapsed: number) {
  const travel = Math.min(1, Math.max(0, (elapsed - CURSOR_START) / CURSOR_TRAVEL))
  // After the click the pointer gets out of the way so the new label is readable.
  const leave = Math.min(1, Math.max(0, (elapsed - CLICK - 250) / 250))
  return {
    opacity: Math.min(1, travel / 0.16) * (1 - leave),
    transform: `translate(${(1 - travel) * 70}px, ${(1 - travel) * 40}px)`,
  }
}

function FlowPanel({
  index,
  stage,
  overview,
  title,
  icon,
  children,
}: {
  index: number
  stage: number
  overview: boolean
  title: string
  icon?: ReactNode
  children: ReactNode
}) {
  const visible = overview ? stage >= index : stage === index
  const [scrollRef, scrollable] = useScrollable<HTMLElement>()
  return (
    <section
      ref={scrollRef}
      className={`flow-panel flow-panel-${index}`}
      hidden={!overview && !visible}
      aria-label={title}
      tabIndex={overview && index > 1 && scrollable ? 0 : undefined}
      data-active={stage === index}
      data-pending={stage < index}
    >
      <h3 className="flow-panel-title">
        {icon}
        <BrandText>{title}</BrandText>
      </h3>
      {/* On desktop a step's column keeps its place but stays empty and hidden until it starts. */}
      {visible ? <div className="flow-panel-content">{children}</div> : null}
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

/** Appears as people scroll past the demo without playing it, and plays it when pressed. */
function DemoNudge({ onPlay }: { onPlay: () => void }) {
  const [ref, state] = useOnceInView<HTMLParagraphElement>()
  return (
    <p ref={ref} className="flow-nudge" data-state={state}>
      <button type="button" onClick={onPlay} aria-haspopup="dialog" aria-controls="flow-dialog">
        Seriously, watch the demo.
      </button>
    </p>
  )
}

export type ExampleRunHandle = { play: (opener: HTMLElement) => void }

export function ExampleRun({ ref }: { ref?: Ref<ExampleRunHandle> }) {
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
  const dialog = useRef<HTMLDialogElement>(null)
  const closeControl = useRef<HTMLButtonElement>(null)
  const themeGroup = useRef<HTMLDivElement>(null)
  const readControl = useRef<HTMLButtonElement>(null)
  const workspace = useRef<HTMLDivElement>(null)
  const previews = useRef<HTMLDivElement>(null)
  const duplicateDetail = useRef<HTMLDivElement>(null)
  const focusPreview = useRef(false)
  const opener = useRef<HTMLElement | null>(null)
  const readAfterClose = useRef(false)
  const joinAfterClose = useRef(false)
  const [focused, setFocused] = useState(false)
  const overview = useSyncExternalStore(subscribeLayout, getOverview, () => false)
  const [elapsed, setElapsed] = useState(0)
  const [runId, setRunId] = useState(0)
  const [selectedStory, setSelectedStory] = useState<number | null>(null)
  const [running, setPlaying] = useState(false)
  const [started, setStarted] = useState(false)
  const [reduced, setReduced] = useState(false)
  const complete = elapsed >= DURATION
  const playing = focused && running && !complete
  const stage = STARTS.reduce((current, start, index) => (elapsed >= start ? index : current), 0)
  const viewStage = !overview && selectedStory !== null ? 3 : stage
  // Desktop opens on the brief alone, then opens out into the full workspace once it is submitted.
  const shouldExpand = elapsed >= EXPAND || selectedStory !== null
  const [expanded, setExpanded] = useState(false)
  // Scroll containers are tab stops only while they have something to scroll.
  const [workspaceScrollRef, workspaceScrollable] = useScrollable<HTMLDivElement>()
  const [contextScrollRef, contextScrollable] = useScrollable<HTMLDivElement>()
  const workspaceRef = useCallback(
    (element: HTMLDivElement | null) => {
      workspace.current = element
      workspaceScrollRef(element)
    },
    [workspaceScrollRef],
  )

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(preference.matches)
    update()
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])

  // Playback speed is a per-viewer preference, so it is remembered in this browser only.
  const [speed, setSpeed] = useState(1)
  const restoreSpeed = () => {
    try {
      const saved = Number(localStorage.getItem(SPEED_KEY))
      if (SPEEDS.includes(saved)) setSpeed(saved)
    } catch {
      // Storage can be blocked; the default speed is fine.
    }
  }
  const changeSpeed = (value: number) => {
    setSpeed(value)
    try {
      localStorage.setItem(SPEED_KEY, String(value))
    } catch {
      // Storage can be blocked; the choice still applies to this visit.
    }
  }

  useEffect(() => {
    if (!playing) return
    let previous = performance.now()
    const timer = window.setInterval(() => {
      const now = performance.now()
      const delta = (now - previous) * speed
      setElapsed((value) => Math.min(DURATION, value + delta))
      previous = now
    }, 50)
    return () => window.clearInterval(timer)
  }, [playing, speed])

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
    if (focused || !readAfterClose.current) return
    readAfterClose.current = false
    const steps = document.getElementById('run-steps-title')
    if (!steps) return
    steps.focus({ preventScroll: true })
    steps.scrollIntoView({ block: 'start', behavior: reduced ? 'instant' : 'smooth' })
  }, [focused, reduced])

  useEffect(() => {
    if (focused && !overview) workspace.current?.scrollTo({ top: 0, behavior: 'instant' })
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Each visible chapter starts at the top of the workspace.
  }, [viewStage, focused, overview])

  // On short screens the button can sit below the answers, so it scrolls into view for the click.
  const submitting = elapsed >= CURSOR_START && elapsed < PLAYBOOK
  useEffect(() => {
    if (!focused || !submitting || (overview && expanded)) return
    const row = workspace.current?.querySelector('.flow-submit-row')
    const scroller = overview
      ? workspace.current?.querySelector('.flow-context')
      : workspace.current
    if (!row || !scroller) return
    // An instant scroll of the container itself: a smooth one can outlive the chapter and leave
    // the next one a few pixels down.
    const distance =
      row.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom + 16
    if (distance > 0) scroller.scrollBy({ top: distance, behavior: 'instant' })
  }, [submitting, focused, overview, expanded])

  useEffect(() => {
    if (shouldExpand === expanded) return
    if (shouldExpand && overview && focused && !reduced && document.startViewTransition) {
      // The transition snapshots the DOM, runs this callback, then snapshots again, so the state
      // must be committed inside it. The callback runs outside React's own work, where flushSync
      // is allowed; from this effect directly it is not (React warns and Restart would trigger it).
      document.startViewTransition(() => flushSync(() => setExpanded(true)))
      // oxlint-disable-next-line react/set-state-in-effect -- `expanded` is `shouldExpand` delayed by the view transition, so it cannot be derived during render.
    } else setExpanded(shouldExpand)
  }, [shouldExpand, expanded, overview, focused, reduced])

  useLayoutEffect(() => {
    // The answers may have scrolled their column; the summary starts at the top.
    workspace.current?.querySelector('.flow-context')?.scrollTo({ top: 0, behavior: 'instant' })
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Runs each time the layout opens out or closes up.
  }, [expanded])

  useEffect(() => {
    if (!focusPreview.current) return
    focusPreview.current = false
    previews.current
      ?.querySelector<HTMLElement>('[data-selected="true"]')
      ?.focus({ preventScroll: true })
    workspace.current?.scrollTo({ top: 0, behavior: 'instant' })
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Selection commits the preview before moving keyboard focus.
  }, [selectedStory])

  const dismissDetail = () => {
    if (duplicateDetail.current?.matches(':popover-open')) duplicateDetail.current.hidePopover()
  }
  const inspectStory = (index: number, moveFocus = false) => {
    setPlaying(false)
    const focus = moveFocus || !overview
    if (index === selectedStory && elapsed >= WRITING_SETTLED) {
      if (focus)
        previews.current
          ?.querySelector<HTMLElement>('[data-selected="true"]')
          ?.focus({ preventScroll: true })
    } else focusPreview.current = focus
    setSelectedStory(index)
    setElapsed((value) => Math.max(value, WRITING_SETTLED))
  }

  const launch = (button: HTMLElement) => {
    opener.current = button
    restoreSpeed()
    setSelectedStory(null)
    if (complete) setElapsed(0)
    setStarted(true)
    setPlaying(true)
    dialog.current?.showModal()
    setFocused(true)
  }
  useImperativeHandle(ref, () => ({ play: launch }))

  const close = () => {
    dismissDetail()
    setPlaying(false)
    dialog.current?.close()
  }
  const restart = () => {
    dismissDetail()
    setSelectedStory(null)
    setElapsed(0)
    setRunId((value) => value + 1)
    setStarted(true)
    setPlaying(true)
    workspace.current?.scrollTo({ top: 0, behavior: 'instant' })
  }
  const play = () => {
    dismissDetail()
    setSelectedStory(null)
    if (complete) restart()
    else setPlaying((value) => !value)
  }
  const seek = (index: number) => {
    dismissDetail()
    setSelectedStory(null)
    setStarted(true)
    setPlaying(false)
    // The last step shows the finished first run; the next morning plays on after it.
    setElapsed(index === STAGES.length - 1 ? NEXT_DAY - 50 : STARTS[index + 1] - 50)
  }
  // The progress bar scrubs like a video: playback pauses while dragging and resumes on release.
  const resumeAfterScrub = useRef(false)
  const scrubTo = (time: number) => {
    dismissDetail()
    setSelectedStory(null)
    setStarted(true)
    setElapsed(Math.min(DURATION, Math.max(0, time)))
  }
  const scrubToPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    scrubTo(((event.clientX - rect.left) / rect.width) * DURATION)
  }
  const endScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    if (resumeAfterScrub.current) setPlaying(true)
    resumeAfterScrub.current = false
  }
  const scrubByKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = {
      ArrowRight: 1000,
      ArrowUp: 1000,
      ArrowLeft: -1000,
      ArrowDown: -1000,
      PageUp: 5000,
      PageDown: -5000,
    }[event.key]
    if (step !== undefined) scrubTo(elapsed + step)
    else if (event.key === 'Home') scrubTo(0)
    else if (event.key === 'End') scrubTo(DURATION)
    else return
    event.preventDefault()
  }
  const label = complete ? 'Replay demo' : started ? 'Resume demo' : 'Play the demo'

  return (
    <section id="run" aria-label="Example run" className="flow-section">
      <div className="flow-heading">
        <div>
          <h2>See how it works.</h2>
        </div>
      </div>
      <div className="flow-launch">
        <RunPoster />
        <span className="flow-launch-icon" aria-hidden="true">
          <Icon kind={complete ? 'replay' : 'play'} />
        </span>
        <span id="flow-launch-description" className="flow-launch-copy">
          <strong>Good News Today</strong>
          <span>A good-news account on X and LinkedIn, from setup to its second day.</span>
        </span>
        <button
          type="button"
          className="flow-launch-action"
          onClick={(event) => launch(event.currentTarget)}
          disabled={!ready}
          aria-describedby="flow-launch-description"
          aria-controls="flow-dialog"
          aria-haspopup="dialog"
        >
          {label}
          <Icon kind="arrow" />
        </button>
      </div>

      <dialog
        ref={dialog}
        id="flow-dialog"
        className="flow-dialog"
        aria-label="Dispatchlet walkthrough"
        aria-describedby="walkthrough-description"
        onKeyDown={(event) => {
          // Video-style shortcuts. K always toggles; Space and the arrows defer to focused controls.
          const target = event.target as HTMLElement
          const onControl = target.closest(
            'button, a, input, select, summary, [role="slider"], [popover]',
          )
          if (event.metaKey || event.ctrlKey || event.altKey) return
          if (event.key === 'k' || (event.key === ' ' && !onControl)) {
            event.preventDefault()
            play()
            return
          }
          if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && !onControl) {
            event.preventDefault()
            scrubTo(elapsed + (event.key === 'ArrowRight' ? 5000 : -5000))
            return
          }
          if (event.key !== 'Tab') return
          const themeTab =
            themeGroup.current?.querySelector<HTMLInputElement>('input:checked') ??
            themeGroup.current?.querySelector<HTMLInputElement>('input')
          if (event.shiftKey && themeTab && document.activeElement === themeTab) {
            event.preventDefault()
            readControl.current?.focus()
          } else if (!event.shiftKey && document.activeElement === readControl.current) {
            event.preventDefault()
            ;(themeTab ?? closeControl.current)?.focus()
          }
        }}
        onClose={() => {
          setFocused(false)
          setPlaying(false)
          if (joinAfterClose.current) {
            joinAfterClose.current = false
            const target =
              document.getElementById('waitlist-email') ??
              document.querySelector<HTMLElement>('.waitlist-confirmation')
            target?.focus({ preventScroll: true })
            target?.scrollIntoView({ block: 'center', behavior: reduced ? 'instant' : 'smooth' })
          } else if (!readAfterClose.current) opener.current?.focus({ preventScroll: true })
        }}
      >
        <header className="flow-focus-header">
          <div className="flow-focus-brand">
            <Wordmark />
            <h2>Good News Today</h2>
          </div>
          <div className="flow-focus-tools">
            <ThemeToggle name="demo-theme" ref={themeGroup} />
            <button
              type="button"
              ref={closeControl}
              className="flow-close"
              onClick={close}
              autoFocus
              aria-label="Close walkthrough"
            >
              <span className="flow-close-label">Close</span>
              <Icon kind="close" />
            </button>
          </div>
        </header>
        <div className={`flow-demo ${playing ? 'is-playing' : ''}`}>
          <ol
            className="flow-stages"
            aria-label="Demo progress"
            data-started={started}
            style={{ '--stage': viewStage } as CSSProperties}
          >
            {STAGES.map((name, index) => (
              <li
                key={name}
                className={started && index <= viewStage ? 'is-current' : ''}
                aria-current={started && index === viewStage ? 'step' : undefined}
              >
                <button
                  type="button"
                  onClick={() => seek(index)}
                  disabled={!ready}

                  aria-controls="flow-workspace"
                >
                  <span className="flow-stage-number" aria-hidden="true">
                    {started && index < viewStage ? <Icon kind="check" /> : index + 1}
                  </span>
                  <span>
                    <BrandText>{name}</BrandText>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div
            ref={workspaceRef}
            id="flow-workspace"
            className={`flow-workspace ${overview ? 'is-overview' : ''} ${overview && !expanded ? 'is-intro' : ''}`}
            tabIndex={workspaceScrollable ? 0 : undefined}
            role="region"
            aria-label={overview ? 'Live walkthrough workspace' : 'Current walkthrough step'}
          >
            <div className="flow-caption" hidden={overview}>
              {TITLES.map((title, index) => (
                <div
                  key={title}
                  className={index === viewStage ? 'is-active' : ''}
                  aria-hidden={index !== viewStage || undefined}
                >
                  <h3>
                    <BrandText>{title}</BrandText>
                  </h3>
                  <p>
                    <BrandText>{NOTES[index]}</BrandText>
                  </p>
                </div>
              ))}
            </div>
            <div key={overview ? runId : `${runId}-${viewStage}`} className="flow-scene">
              <div
                ref={contextScrollRef}
                className="flow-context"
                tabIndex={overview && contextScrollable ? 0 : undefined}
                role={overview ? 'region' : undefined}
                aria-label={overview ? 'Answers and playbook' : undefined}
              >
                <FlowPanel
                  index={0}
                  stage={viewStage}
                  overview={overview}
                  title="Your answers"
                  icon={<Icon kind="brief" />}
                >
                  {/* On desktop the questions get the columns to the right; the answers stay here. */}
                  <div className={`flow-prompt ${overview ? '' : 'is-asking'}`}>
                    {overview ? null : <SetupQuestions elapsed={elapsed} reduced={reduced} />}
                    <div className="setup-side">
                      <SetupAnswers elapsed={elapsed} />
                      <div className="flow-submit-row">
                        {/* After the click the label gives way to the handoff, in the same place. */}
                        <span className="flow-handoff">
                          <span
                            className={elapsed >= CLICK + 300 ? 'is-active' : ''}
                            aria-hidden={elapsed < CLICK + 300 || undefined}
                          >
                            Your part’s done. The rest is automatic.
                          </span>
                        </span>
                        <span
                          className={`flow-submit ${elapsed >= CLICK && elapsed < CLICK + 400 ? 'is-clicked' : ''}`}
                        >
                          <span className="flow-submit-label">
                            {(
                              ['Create playbook', 'Creating playbook', 'Playbook created'] as const
                            ).map((text, phase) => {
                              const current = elapsed >= CREATED ? 2 : elapsed >= CLICK ? 1 : 0
                              return (
                                <span
                                  key={text}
                                  aria-hidden={phase !== current || undefined}
                                  className={phase === current ? 'is-active' : ''}
                                >
                                  {text}
                                </span>
                              )
                            })}
                          </span>
                          <span className="flow-submit-icon">
                            {elapsed >= CREATED ? (
                              <Icon kind="check" />
                            ) : elapsed >= CLICK ? (
                              <span className="flow-spinner" />
                            ) : (
                              <Icon kind="arrow" />
                            )}
                            {elapsed >= CURSOR_START && elapsed < PLAYBOOK ? (
                              <span
                                className={`flow-cursor ${elapsed >= CLICK ? 'is-clicking' : ''}`}
                                style={cursorMotion(elapsed)}
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
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>
                </FlowPanel>
                <FlowPanel
                  index={1}
                  stage={viewStage}
                  overview={overview}
                  title="The playbook"
                  icon={<Icon kind="playbook" />}
                >
                  <div className="flow-playbook">
                    <div className="flow-document-title">
                      <span>Good News Today</span>
                      <span className="flow-tag">Playbook</span>
                    </div>
                    <p className="flow-playbook-note">The instructions it follows on every run.</p>
                    {RULES.map(([name, value], index) => (
                      <div
                        className="flow-rule flow-reveal"
                        key={name}
                        data-revealed={elapsed >= RULE_START + index * RULE_INTERVAL}
                        aria-hidden={elapsed < RULE_START + index * RULE_INTERVAL || undefined}
                      >
                        <span>
                          <BrandText>{name}</BrandText>
                        </span>
                        <p>{value}</p>
                      </div>
                    ))}
                    <div
                      className="flow-ready flow-reveal"
                      data-revealed={elapsed >= READY}
                      aria-hidden={elapsed < READY || undefined}
                    >
                      <Icon kind="check" /> Playbook ready. Starting the first run.
                    </div>
                  </div>
                </FlowPanel>
              </div>
              {overview && !expanded ? (
                <div className="flow-questions">
                  <SetupQuestions elapsed={elapsed} reduced={reduced} />
                </div>
              ) : null}
              <FlowPanel
                index={2}
                stage={viewStage}
                overview={overview}
                title="Research"
                icon={<Icon kind="research" />}
              >
                <div className="flow-research">
                  {EVENTS.map(([start, title, detail], index) => (
                    <div
                      className={`flow-event flow-reveal ${index === 1 ? 'is-informative' : ''}`}
                      key={title}
                      data-revealed={elapsed >= start}
                      aria-hidden={elapsed < start || undefined}
                    >
                      <span
                        className={`flow-event-marker ${elapsed >= (EVENTS[index + 1]?.[0] ?? CANDIDATE_START) ? 'is-done' : ''}`}
                      >
                        {elapsed >= (EVENTS[index + 1]?.[0] ?? CANDIDATE_START) ? (
                          <Icon kind="check" />
                        ) : (
                          <span className="flow-spinner" />
                        )}
                      </span>
                      <div>
                        <strong>{title}</strong>
                        <p>{detail}</p>
                        {index === 1 ? (
                          <span className="flow-sources" aria-hidden="true">
                            {SOURCE_TILES.map((source) => (
                              <span key={source}>{source}</span>
                            ))}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  <div
                    className="flow-candidates flow-reveal"
                    data-revealed={elapsed >= CANDIDATE_START}
                    aria-hidden={elapsed < CANDIDATE_START || undefined}
                  >
                    <strong>Stories found</strong>
                    <ul>
                      {CANDIDATES.map(([title, status, source], index) => (
                        <li
                          key={title}
                          data-highlighted={selectedStory === index}
                          data-revealed={elapsed >= CANDIDATE_START + index * CANDIDATE_INTERVAL}
                          aria-hidden={
                            elapsed < CANDIDATE_START + index * CANDIDATE_INTERVAL || undefined
                          }
                          inert={elapsed < CANDIDATE_START + index * CANDIDATE_INTERVAL}
                          className={`flow-reveal ${index < 3 ? 'is-selected' : index === 3 ? 'is-duplicate' : ''}`}
                          data-state={
                            selectedStory !== null || elapsed >= resolveAt(index)
                              ? 'resolved'
                              : index === 3 && elapsed >= MATCH
                                ? 'matching'
                                : 'checking'
                          }
                        >
                          <span className="flow-candidate-mark" aria-hidden="true">
                            {selectedStory !== null || elapsed >= resolveAt(index) ? (
                              <Icon kind={index < 3 ? 'check' : 'skip'} />
                            ) : (
                              <span className="flow-candidate-pending" />
                            )}
                          </span>
                          {index < 3 ? (
                            <button
                              type="button"
                              className="flow-story-link"
                              aria-pressed={selectedStory === index}
                              onClick={() => inspectStory(index)}
                            >
                              {title}
                            </button>
                          ) : index === 3 ? (
                            <button
                              type="button"
                              className="flow-story-link"
                              popoverTarget="flow-duplicate-detail"
                              onClick={(event) =>
                                event.currentTarget.focus({ preventScroll: true })
                              }
                              aria-label="The urban garden story: why it was skipped"
                            >
                              {title}
                            </button>
                          ) : (
                            <span>{title}</span>
                          )}
                          <span className="flow-candidate-source">{source}</span>
                          <span className="flow-candidate-status">
                            {/* Every label this row can show shares one cell, so its width never changes. */}
                            {(index === 3
                              ? ['Checking', 'Matches an earlier post', status]
                              : ['Checking', status]
                            ).map((text, phase, labels) => {
                              const settled = selectedStory !== null || elapsed >= resolveAt(index)
                              const current = settled
                                ? labels.length - 1
                                : index === 3 && elapsed >= MATCH
                                  ? 1
                                  : 0
                              return (
                                <span
                                  key={text}
                                  aria-hidden={phase !== current}
                                  data-active={phase === current}
                                >
                                  {text}
                                </span>
                              )
                            })}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div
                      ref={duplicateDetail}
                      id="flow-duplicate-detail"
                      className="flow-duplicate-detail"
                      popover="auto"
                      role="dialog"
                      aria-labelledby="flow-duplicate-title"
                      onToggle={(event) => {
                        if (event.newState === 'open') {
                          setPlaying(false)
                          duplicateDetail.current
                            ?.querySelector('button')
                            ?.focus({ preventScroll: true })
                        }
                      }}
                    >
                      <div className="flow-detail-heading">
                        <h4 id="flow-duplicate-title">Already shared. Skipped this time.</h4>
                        <button
                          type="button"
                          popoverTarget="flow-duplicate-detail"
                          popoverTargetAction="hide"
                          aria-label="Close duplicate explanation"
                        >
                          <Icon kind="close" />
                        </button>
                      </div>
                      {/* The match itself: what research found today, and the post it repeats. */}
                      <div className="flow-match">
                        <div className="flow-match-card">
                          <span className="flow-match-label">Found today, {CANDIDATES[3][2]}</span>
                          <strong>{CANDIDATES[3][0]}</strong>
                        </div>
                        <p className="flow-match-link">Same story</p>
                        <div className="flow-match-card is-previous">
                          <span className="flow-match-label">
                            Previous post, illustrative example
                          </span>
                          <blockquote>{PREVIOUS_POST}</blockquote>
                        </div>
                      </div>
                      <p>
                        It matched this story to a post you’ve already shared, so it skips it and
                        keeps the three new ones.
                      </p>
                    </div>
                    <p
                      className="flow-reveal flow-match-note"
                      data-revealed={elapsed >= MATCH}
                      aria-hidden={elapsed < MATCH || undefined}
                    >
                      You’ve already posted the urban garden story, so it’s skipped.
                    </p>
                  </div>
                </div>
              </FlowPanel>
              {overview ? (
                <aside
                  className="flow-match-callout flow-reveal"
                  aria-label="Why one story was skipped"
                  data-revealed={elapsed >= MATCH && elapsed < POSTS}
                  aria-hidden={elapsed < MATCH || elapsed >= POSTS || undefined}
                >
                  <h4>Why one story was skipped</h4>
                  <div className="flow-match">
                    <div className="flow-match-card">
                      <span className="flow-match-label">Found today, {CANDIDATES[3][2]}</span>
                      <strong>{CANDIDATES[3][0]}</strong>
                    </div>
                    <p className="flow-match-link">Same story</p>
                    <div className="flow-match-card is-previous">
                      <span className="flow-match-label">Already posted by you</span>
                      <blockquote>{PREVIOUS_POST}</blockquote>
                    </div>
                  </div>
                  <p>
                    It checks every story against what you’ve already posted. You shared this one
                    before, so it’s skipped.
                  </p>
                </aside>
              ) : null}
              <FlowPanel
                index={3}
                stage={viewStage}
                overview={overview}
                title="Your posts"
                icon={<Icon kind="posts" />}
              >
                <div className="flow-writing">
                  <div ref={previews} className="flow-post-previews">
                    {STORIES.map((story, storyIndex) => (
                      <article
                        className="flow-post"
                        key={story.title}
                        tabIndex={-1}
                        aria-label={`${story.title} posts`}
                        data-selected={(selectedStory ?? 0) === storyIndex}
                        aria-hidden={(selectedStory ?? 0) !== storyIndex}
                        inert={(selectedStory ?? 0) !== storyIndex}
                      >
                        <div className="flow-post-heading">
                          <strong>{story.title}</strong>
                          {selectedStory !== null && storyIndex !== 0 ? (
                            <button
                              type="button"
                              className="flow-tag flow-preview-reset"
                              onClick={() => inspectStory(0, true)}
                            >
                              First story
                            </button>
                          ) : (
                            <span
                              className={`flow-tag flow-status-tag ${selectedStory !== null || elapsed >= POSTS_READY ? 'is-ready' : ''}`}
                            >
                              {/* Both labels share one cell, so the tag never changes width or wraps. */}
                              {(['Writing', '2 posts ready'] as const).map((text, index) => {
                                const active =
                                  (selectedStory !== null || elapsed >= POSTS_READY) ===
                                  (index === 1)
                                return (
                                  <span key={text} aria-hidden={!active} data-active={active}>
                                    {text}
                                  </span>
                                )
                              })}
                            </span>
                          )}
                        </div>
                        <div className="flow-channel-posts">
                          {story.posts.map(([channel, text], index) => (
                            <div
                              className="flow-reveal"
                              key={channel}
                              data-revealed={
                                selectedStory !== null ||
                                elapsed >= (index === 0 ? X_START : LI_START)
                              }
                              aria-hidden={
                                (selectedStory === null &&
                                  elapsed < (index === 0 ? X_START : LI_START)) ||
                                undefined
                              }
                            >
                              <PostPreview channel={channel} length={text.length}>
                                <StreamText
                                  text={text}
                                  elapsed={selectedStory !== null ? DURATION : elapsed}
                                  start={index === 0 ? X_START : LI_START}
                                  duration={index === 0 ? X_DURATION : LI_DURATION}
                                  reduced={reduced}
                                />
                              </PostPreview>
                            </div>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                  <span className="sr-only" aria-live="polite">
                    {selectedStory !== null
                      ? `Inspecting ${STORIES[selectedStory].title}. Playback paused.`
                      : ''}
                  </span>
                  <ul className="flow-story-results" aria-label="More story previews">
                    {STORIES.slice(1).map((story, index) => (
                      <li
                        className="flow-reveal"
                        key={story.title}
                        data-revealed={elapsed >= STORY_2 + index * (STORY_3 - STORY_2)}
                        aria-hidden={elapsed < STORY_2 + index * (STORY_3 - STORY_2) || undefined}
                      >
                        <Icon kind="check" />
                        <div>
                          <button
                            type="button"
                            className="flow-story-link"
                            aria-pressed={selectedStory === index + 1}
                            onClick={() => inspectStory(index + 1, true)}
                          >
                            <strong>{story.title}</strong>
                          </button>
                          <span>2 posts ready for X and LinkedIn</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </FlowPanel>
              <FlowPanel
                index={4}
                stage={viewStage}
                overview={overview}
                title="In Buffer"
                icon={<BufferMark size={16} />}
              >
                <div className="flow-finish">
                  <p className="flow-finish-status">
                    <span
                      className={elapsed < RECEIPT ? 'is-active' : ''}
                      aria-hidden={elapsed >= RECEIPT || undefined}
                    >
                      <BrandText>Scheduling in Buffer for X and LinkedIn</BrandText>
                    </span>
                    <span
                      className={elapsed >= RECEIPT ? 'is-active' : ''}
                      aria-hidden={elapsed < RECEIPT || undefined}
                    >
                      <BrandText>6 posts scheduled in Buffer for X and LinkedIn</BrandText>
                    </span>
                  </p>
                  {/* The day at a glance: three posts spread between 06:00 and 18:00. */}
                  <div className="flow-day" aria-hidden="true">
                    {STORIES.map((story, index) => (
                      <span
                        key={story.time}
                        className="flow-day-slot"
                        data-revealed={elapsed >= SLOT_START + index * SLOT_INTERVAL}
                        style={{ left: `${((Number(story.time.slice(0, 2)) - 6) / 12) * 100}%` }}
                      >
                        <span className="flow-day-dot" />
                        <span className="flow-day-time">{story.time}</span>
                      </span>
                    ))}
                  </div>
                  <ol className="flow-schedule" aria-label="Scheduled stories">
                    {STORIES.map((story, index) => (
                      <li
                        key={story.title}
                        data-highlighted={selectedStory === index}
                        className="flow-reveal"
                        data-revealed={elapsed >= SLOT_START + index * SLOT_INTERVAL}
                        aria-hidden={elapsed < SLOT_START + index * SLOT_INTERVAL || undefined}
                      >
                        <time>{story.time}</time>
                        <div>
                          <button
                            type="button"
                            className="flow-story-link"
                            aria-pressed={selectedStory === index}
                            onClick={() => inspectStory(index)}
                          >
                            <strong>{story.title}</strong>
                          </button>
                          <span className="flow-slot-channels">
                            <ChannelMark channel="X" size={12} />
                            <ChannelMark channel="LinkedIn" size={12} />
                            Scheduled
                          </span>
                        </div>
                        <Icon kind="check" />
                      </li>
                    ))}
                  </ol>
                  <div
                    className="flow-receipt flow-reveal"
                    data-revealed={elapsed >= RECEIPT}
                    aria-hidden={elapsed < RECEIPT || undefined}
                  >
                    Found 5 stories. Skipped 2. Scheduled 6 posts.
                  </div>
                  <div
                    className="flow-next flow-reveal"
                    data-revealed={elapsed >= RECEIPT}
                    aria-hidden={elapsed < RECEIPT || undefined}
                  >
                    <Icon kind="check" /> Next run tomorrow at 08:00.
                  </div>
                </div>
              </FlowPanel>
            </div>
          </div>
          {/* The second run covers the workspace: the same agent, the next morning, on its own. */}
          <div
            className="flow-next-day flow-reveal"
            data-revealed={elapsed >= NEXT_DAY && selectedStory === null}
            aria-hidden={elapsed < NEXT_DAY || selectedStory !== null || undefined}
            inert={elapsed < NEXT_DAY || selectedStory !== null}
          >
            <NextDay elapsed={elapsed} onBack={() => seek(STAGES.length - 1)} />
          </div>
          <div className="flow-player">
            <span
              aria-live="polite"
              aria-atomic="true"
              className={complete ? 'sr-only' : 'flow-player-status'}
            >
              {!started ? (
                'Ready when you are'
              ) : complete ? (
                'Walkthrough complete'
              ) : overview ? (
                // Desktop has no chapter captions, so the player narrates what is happening.
                <>
                  <span className="flow-player-narration">
                    <BrandText>
                      {elapsed >= NEXT_DAY ? NEXT_DAY_TITLE : TITLES[viewStage]}
                    </BrandText>
                  </span>
                  {playing ? null : <span className="flow-player-state"> Paused.</span>}
                </>
              ) : (
                <>
                  <span className="flow-player-stage">
                    <BrandText>{STAGES[viewStage]}</BrandText>
                  </span>{' '}
                  <span className="flow-player-state">{playing ? 'playing' : 'paused'}</span>
                </>
              )}
            </span>
            {complete ? (
              <button
                type="button"
                className="flow-join"
                onClick={() => {
                  joinAfterClose.current = true
                  close()
                }}
              >
                Notify me at launch <Icon kind="arrow" />
              </button>
            ) : null}
            <div className="flow-player-actions">
              <label className="flow-speed">
                <span className="flow-speed-label">Speed</span>
                <select
                  value={speed}
                  onChange={(event) => changeSpeed(Number(event.target.value))}
                  aria-controls="flow-workspace"
                >
                  {SPEEDS.map((value) => (
                    <option key={value} value={value}>
                      {value}×
                    </option>
                  ))}
                </select>
              </label>
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
                  aria-keyshortcuts="k"
                  title={complete ? 'Replay (K)' : playing ? 'Pause (K)' : 'Resume (K)'}
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
                  <span className="flow-transport-label">
                    <span aria-hidden="true">Resume</span>
                    <span>{complete ? 'Replay' : playing ? 'Pause' : 'Resume'}</span>
                  </span>
                </button>
              ) : null}
            </div>
          </div>
          <div
            className="flow-progress"
            role="slider"
            tabIndex={0}
            aria-label="Walkthrough progress"
            aria-valuenow={Math.floor(elapsed / 1000)}
            aria-valuemin={0}
            aria-valuemax={TOTAL_SECONDS}
            aria-valuetext={`${Math.floor(elapsed / 1000)} of ${TOTAL_SECONDS} seconds`}
            aria-controls="flow-workspace"
            onPointerDown={(event) => {
              if (event.button !== 0) return
              event.currentTarget.setPointerCapture(event.pointerId)
              resumeAfterScrub.current = playing
              setPlaying(false)
              scrubToPointer(event)
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) scrubToPointer(event)
            }}
            onPointerUp={endScrub}
            onPointerCancel={endScrub}
            onKeyDown={scrubByKey}
          >
            <span
              className="flow-progress-fill"
              style={{ transform: `scaleX(${elapsed / DURATION})` }}
            />
            {/* The handle stays fully on the bar at both ends. */}
            <span
              className="flow-progress-thumb"
              style={{ left: `calc(6px + (100% - 12px) * ${elapsed / DURATION})` }}
            />
          </div>
        </div>
        <footer className="flow-focus-footer">
          <p id="walkthrough-description">Illustrative story details.</p>
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
          The animation needs JavaScript. The steps below show the same run.
        </p>
      </noscript>

      {started ? null : (
        <DemoNudge
          onPlay={() => {
            // The nudge goes away once the demo starts, so focus returns to the main play button.
            const button = document.querySelector<HTMLElement>('.flow-launch-action')
            if (button) launch(button)
          }}
        />
      )}
    </section>
  )
}
