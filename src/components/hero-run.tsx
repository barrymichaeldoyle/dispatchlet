import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type RefObject,
} from 'react'
import { BrandText } from './brand-text'
import { ChannelMark } from './brand-icons'
import { PostPreview } from './post-preview'
import { StreamText } from './stream-text'
import { ANSWERS, CANDIDATES, STORIES } from '../lib/example-run'
import { track } from '../integrations/posthog/track'

/**
 * The hero's run, in milliseconds from when it comes into view: stories arrive, each is checked,
 * the two it shouldn't post are struck through, then the posts are written. The last frame is the
 * hero as the server renders it, so nothing is lost without JavaScript or with reduced motion.
 */
const T = {
  ROWS: [300, 600, 900, 1200, 1500],
  CHECK: 1950,
  RESOLVE: [2250, 2700, 3150, 3600, 4050],
  WRITE: 4550,
  TYPE_START: 4800,
  TYPE_DURATION: 1500,
  LINKEDIN: 6500,
  DONE: 7100,
} as const

const DONE = Number.POSITIVE_INFINITY
const IDLE = -1

const [FIRST] = STORIES
const [[, X_POST], [, LINKEDIN_POST]] = FIRST.posts

type Row =
  | { kind: 'kept'; title: string; source: string; time: string }
  | { kind: 'skipped'; title: string; source: string; reason: string }

/** The run's finds in the order they came in: the two it skips arrive among the three it keeps. */
const SKIPS: Row[] = CANDIDATES.filter(([, status]) => status.endsWith('skipped')).map(
  ([title, status, source]) => ({
    kind: 'skipped',
    title,
    source,
    reason: status.replace(', skipped', ''),
  }),
)
const KEEPS: Row[] = STORIES.map(({ title, source, time }) => ({
  kind: 'kept',
  title,
  source,
  time,
}))
const ROWS: Row[] = [KEEPS[0], SKIPS[0], KEEPS[1], SKIPS[1], KEEPS[2]]
const SKIPPED = SKIPS.length
const WRITTEN = STORIES.length * FIRST.posts.length

type Phase = 'idle' | 'research' | 'check' | 'write' | 'done'

function phaseAt(t: number): Phase {
  if (t < 0) return 'idle'
  if (t < T.CHECK) return 'research'
  if (t < T.WRITE) return 'check'
  if (t < T.DONE) return 'write'
  return 'done'
}

const STATUS: { phase: Phase; text: string }[] = [
  { phase: 'research', text: `Searching ${ANSWERS.sources.length} sources` },
  { phase: 'check', text: 'Checking what’s already posted' },
  { phase: 'write', text: 'Writing posts' },
  {
    phase: 'done',
    text: `Found ${ROWS.length} stories, skipped ${SKIPPED}, wrote ${WRITTEN} posts.`,
  },
]

const REDUCED = '(prefers-reduced-motion: reduce)'
const subscribeMotion = (onChange: () => void) => {
  const query = window.matchMedia(REDUCED)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
const noop = () => () => {}

/**
 * A clock for the run. On the server, and wherever motion isn't welcome, it sits at the end: the
 * full hero. Otherwise it holds at the start until the figure is in view, then plays once.
 */
function useRunClock(figure: RefObject<HTMLElement | null>) {
  const ready = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  )
  const motion = useSyncExternalStore(
    subscribeMotion,
    () => !window.matchMedia(REDUCED).matches,
    () => false,
  )
  const [t, setT] = useState<number | null>(null)
  const frame = useRef(0)

  const play = useCallback(() => {
    cancelAnimationFrame(frame.current)
    const start = performance.now()
    const tick = (now: number) => {
      const elapsed = now - start
      setT(elapsed >= T.DONE ? DONE : elapsed)
      if (elapsed < T.DONE) frame.current = requestAnimationFrame(tick)
    }
    setT(0)
    frame.current = requestAnimationFrame(tick)
  }, [])

  useEffect(() => {
    if (!motion || !figure.current) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        observer.disconnect()
        play()
      },
      { threshold: 0.35 },
    )
    observer.observe(figure.current)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame.current)
    }
  }, [motion, figure, play])

  // Not started yet: the end when motion is off, the start (nothing arrived) when it's on.
  const now = t ?? (motion ? IDLE : DONE)
  return { t: motion ? now : DONE, ready, motion, play }
}

/** Rewinds the figure before its first paint, and shows the end anyway if the app never loads. */
const PREPAINT = `(() => {
  const f = document.getElementById('hero-run');
  if (!f || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  f.dataset.phase = 'idle';
  setTimeout(() => { if (!f.dataset.ready) f.dataset.phase = 'done'; }, 4000);
})();`

export function HeroRun() {
  const figure = useRef<HTMLElement>(null)
  const { t, ready, motion, play } = useRunClock(figure)
  const phase = phaseAt(t)
  const available = ready && motion && phase === 'done'
  const typing = t >= T.TYPE_START && t < T.TYPE_START + T.TYPE_DURATION
  const typed = Math.floor(
    X_POST.length * Math.min(1, Math.max(0, (t - T.TYPE_START) / T.TYPE_DURATION)),
  )

  return (
    <>
      <figure
        ref={figure}
        id="hero-run"
        className="landing-proof hero-run flow-writing"
        data-phase={phase}
        data-ready={ready ? 'true' : undefined}
        suppressHydrationWarning
      >
        <div className="landing-proof-day hero-run-card">
          <p className="hero-run-status">
            {STATUS.map((status) => (
              <span key={status.phase} data-active={status.phase === phase || undefined}>
                {status.text}
              </span>
            ))}
            <span className="hero-run-when">Daily, {ANSWERS.time}</span>
          </p>
          <ol>
            {ROWS.map((row, index) => (
              <li
                key={row.title}
                data-kind={row.kind}
                data-in={t >= T.ROWS[index]}
                data-resolved={t >= T.RESOLVE[index]}
                style={{ '--i': index } as CSSProperties}
              >
                <span className="hero-run-slot">
                  {row.kind === 'kept' ? <time>{row.time}</time> : 'Skip'}
                </span>
                <span className="hero-run-story">
                  <span className="hero-run-title">
                    <span>{row.title}</span>
                  </span>
                  <span className="hero-run-meta">
                    {row.source}
                    {row.kind === 'skipped' ? (
                      <span className="hero-run-reason"> · {row.reason}</span>
                    ) : null}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div className="hero-run-posts" data-in={t >= T.WRITE}>
          <div className="hero-run-twin" data-in={t >= T.LINKEDIN} aria-hidden="true">
            <ChannelMark channel="LinkedIn" size={12} />
            <span>{LINKEDIN_POST}</span>
          </div>
          <PostPreview channel="X" length={t === DONE ? X_POST.length : typed}>
            <StreamText
              text={X_POST}
              elapsed={t}
              start={T.TYPE_START}
              duration={T.TYPE_DURATION}
              reduced={false}
              caret={typing}
            />
          </PostPreview>
        </div>
        <figcaption>
          <BrandText>{`One morning’s run for an example account. Each story gets an X and a LinkedIn post in Buffer.`}</BrandText>{' '}
          <button
            type="button"
            className="hero-run-replay"
            data-available={available}
            aria-hidden={!available || undefined}
            tabIndex={available ? undefined : -1}
            onClick={() => {
              track('hero_run_replayed')
              play()
            }}
          >
            Replay the run
          </button>
        </figcaption>
      </figure>
      <script dangerouslySetInnerHTML={{ __html: PREPAINT }} />
    </>
  )
}
