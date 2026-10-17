import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type Ref,
} from 'react'
import { flushSync } from 'react-dom'
import { Wordmark } from './wordmark'
import { BrandText } from './brand-text'
import { ThemeToggle } from './theme-toggle'
import { Icon } from './flow-icon'
import { RunPoster } from './run-steps'
import { useOnceInView } from '../lib/use-once-in-view'
import {
  CANDIDATES,
  PREVIOUS_POST,
  PROMPT,
  RULES,
  RUN_SECONDS,
  STORIES,
  TIMING,
  resolveAt,
} from '../lib/example-run'

const {
  TYPE_START,
  TYPE_DURATION,
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
  DURATION,
} = TIMING
const TOTAL_SECONDS = DURATION / 1000
const STAGES = ['Your brief', 'The playbook', 'Research', 'Your posts', 'In Buffer']
const STARTS = [0, PLAYBOOK, RESEARCH, POSTS, BUFFER]
const TITLES = [
  'Describe what you want to post.',
  'It writes a playbook.',
  'It finds new stories and skips repeats.',
  'It writes a post for each channel.',
  'It schedules them in Buffer.',
]
const NOTES = [
  'This is the only part you do. Dispatchlet handles the rest.',
  'Sources, voice and schedule from your brief. You can edit it any time.',
  'It checks what you’ve already posted before choosing stories.',
  'Three stories, with a post for X and LinkedIn for each.',
  'Three stories, three hours apart. Then it runs again tomorrow.',
]
const EVENTS = [
  [
    EVENT_STARTS[0],
    'Searching trusted sources',
    'Finding fresh conservation and community reporting.',
  ],
  [
    EVENT_STARTS[1],
    'Reading the sources',
    '5 searches and 4 pages read. Original reporting verified.',
  ],
  [
    EVENT_STARTS[2],
    'Checking what you’ve already covered',
    'Matching candidates against previous posts.',
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
      <h3 className="flow-panel-title">
        <BrandText>{title}</BrandText>
      </h3>
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

/** Appears as people scroll past the demo without playing it. */
function DemoNudge() {
  const [ref, state] = useOnceInView<HTMLParagraphElement>()
  return (
    <p ref={ref} className="flow-nudge" data-state={state}>
      Seriously, watch the demo. It’s {RUN_SECONDS} seconds.
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

  useEffect(() => {
    if (shouldExpand === expanded) return
    const apply = () => flushSync(() => setExpanded(shouldExpand))
    if (shouldExpand && overview && focused && !reduced && document.startViewTransition) {
      document.startViewTransition(apply)
    } else apply()
  }, [shouldExpand, expanded, overview, focused, reduced])

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
    setElapsed(index === STAGES.length - 1 ? DURATION : STARTS[index + 1] - 50)
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
          <span>
            A daily news run for X and LinkedIn, start to finish in {RUN_SECONDS} seconds.
          </span>
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
          <ol className="flow-stages" aria-label="Demo progress">
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
            ref={workspace}
            id="flow-workspace"
            className={`flow-workspace ${overview ? 'is-overview' : ''} ${overview && !expanded ? 'is-intro' : ''}`}
            tabIndex={0}
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
                className="flow-context"
                tabIndex={overview ? 0 : undefined}
                role={overview ? 'region' : undefined}
                aria-label={overview ? 'Brief and playbook' : undefined}
              >
                <FlowPanel
                  index={0}
                  stage={viewStage}
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
                        start={TYPE_START}
                        duration={TYPE_DURATION}
                        reduced={reduced}
                        caret={elapsed < CURSOR_START}
                      />
                    </div>
                    <div className="flow-submit-row">
                      <span>Good News Today</span>
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
                    <p
                      className="flow-handoff flow-reveal"
                      data-revealed={elapsed >= CLICK + 300}
                      aria-hidden={elapsed < CLICK + 300 || undefined}
                    >
                      Your part’s done. The rest is automatic.
                    </p>
                  </div>
                </FlowPanel>
                <FlowPanel
                  index={1}
                  stage={viewStage}
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
              <FlowPanel
                index={2}
                stage={viewStage}
                overview={overview}
                title="Research"
                waiting="The agent will search and check previous posts."
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
                      </div>
                    </div>
                  ))}
                  <div
                    className="flow-candidates flow-reveal"
                    data-revealed={elapsed >= CANDIDATE_START}
                    aria-hidden={elapsed < CANDIDATE_START || undefined}
                  >
                    <strong>Research candidates</strong>
                    <ul>
                      {CANDIDATES.map(([title, status], index) => (
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
                      <p>Previous post, illustrative example</p>
                      <blockquote>{PREVIOUS_POST}</blockquote>
                      <p>
                        The agent matched this finding to the urban garden story in its posting
                        history. It keeps the three fresh stories and leaves this repeat out.
                      </p>
                    </div>
                    <p
                      className="flow-reveal flow-match-note"
                      data-revealed={elapsed >= MATCH}
                      aria-hidden={elapsed < MATCH || undefined}
                    >
                      The urban garden story matches a post you’ve already shared, so it stays out
                      of the queue.
                    </p>
                  </div>
                </div>
              </FlowPanel>
              <FlowPanel
                index={3}
                stage={viewStage}
                overview={overview}
                title="Channel posts"
                waiting="Fresh stories will become posts for each channel."
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
                              <span className="flow-channel">
                                {channel}
                                {channel === 'X' ? (
                                  <span className="flow-count">{text.length} of 280</span>
                                ) : null}
                              </span>
                              <p>
                                <StreamText
                                  text={text}
                                  elapsed={selectedStory !== null ? DURATION : elapsed}
                                  start={index === 0 ? X_START : LI_START}
                                  duration={index === 0 ? X_DURATION : LI_DURATION}
                                  reduced={reduced}
                                />
                              </p>
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
                title="Buffer schedule"
                waiting="Posts will be spaced through the day."
              >
                <div className="flow-finish">
                  <div className="flow-success">
                    <Icon kind="check" />
                  </div>
                  <h4>Three stories. A full day covered.</h4>
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
                          <span>Scheduled for X and LinkedIn</span>
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
          <div className="flow-player">
            <span
              aria-live="polite"
              aria-atomic="true"
              className={complete ? 'sr-only' : undefined}
            >
              {!started ? (
                'Ready when you are'
              ) : complete ? (
                'Walkthrough complete'
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
      <p className="flow-disclaimer">Illustrative example.</p>
      {started ? null : <DemoNudge />}
    </section>
  )
}
