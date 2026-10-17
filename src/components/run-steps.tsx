import type { CSSProperties, ReactNode } from 'react'
import { BrandText } from './brand-text'
import { Icon } from './flow-icon'
import { ChannelMark } from './brand-icons'
import { PostPreview } from './post-preview'
import { StepArt, type StepArtKind } from './step-art'
import { CANDIDATES, PREVIOUS_POST, PROMPT, RULES, STORIES } from '../lib/example-run'
import { useOnceInView } from '../lib/use-once-in-view'

/**
 * Pieces of the real demo UI, frozen at the moment that explains each step. "done" is the
 * finished state and the default, so the page reads correctly without JavaScript; "waiting"
 * is the state just before it, shown only until the piece scrolls into view.
 */
function Swap({ before, after }: { before: ReactNode; after: ReactNode }) {
  return (
    <span className="step-swap">
      <span data-phase="before" aria-hidden="true">
        {before}
      </span>
      <span data-phase="after">{after}</span>
    </span>
  )
}

function BriefFragment() {
  return (
    <div className="step-brief">
      <div className="flow-input">{PROMPT}</div>
      <div className="flow-submit-row">
        <span>Good News Today</span>
        <span className="flow-submit">
          <Swap before="Create playbook" after="Playbook created" />
          <Icon kind="check" />
        </span>
      </div>
    </div>
  )
}

function PlaybookFragment() {
  return (
    <div className="flow-playbook step-playbook">
      <div className="flow-document-title">
        <span>Good News Today</span>
        <span className="flow-tag">Playbook</span>
      </div>
      {RULES.map(([name, value], index) => (
        <div className="flow-rule" key={name} style={{ '--step-index': index } as CSSProperties}>
          <span>
            <BrandText>{name}</BrandText>
          </span>
          <p>{value}</p>
        </div>
      ))}
    </div>
  )
}

function ResearchFragment({ withMatch = true }: { withMatch?: boolean }) {
  return (
    <div className={`step-research ${withMatch ? '' : 'is-solo'}`}>
      <div className="flow-candidates">
        <strong>Stories found</strong>
        <ul>
          {CANDIDATES.map(([title, status], index) => (
            <li
              key={title}
              className={index < 3 ? 'is-selected' : index === 3 ? 'is-duplicate' : 'is-skipped'}
              style={{ '--step-index': index } as CSSProperties}
            >
              <span className="flow-candidate-mark" aria-hidden="true">
                <Icon kind={index < 3 ? 'check' : 'skip'} />
              </span>
              <span>{title}</span>
              <span>
                <Swap before="Checking" after={status} />
              </span>
            </li>
          ))}
        </ul>
      </div>
      {withMatch ? (
        <figure className="step-match">
          <figcaption>Matched in your posting history</figcaption>
          <blockquote>{PREVIOUS_POST}</blockquote>
          <p>Same story as an earlier post, so it stays out of today’s queue.</p>
        </figure>
      ) : null}
    </div>
  )
}

function PostsFragment() {
  const story = STORIES[0]
  return (
    <article className="flow-post step-posts">
      <div className="flow-post-heading">
        <strong>{story.title}</strong>
        <span className="flow-tag flow-status-tag">
          <Swap before="Writing" after="2 posts ready" />
        </span>
      </div>
      <div className="flow-channel-posts">
        {story.posts.map(([channel, text], index) => (
          <div key={channel} style={{ '--step-index': index } as CSSProperties}>
            <PostPreview channel={channel} length={text.length}>
              {text}
            </PostPreview>
          </div>
        ))}
      </div>
    </article>
  )
}

function ScheduleFragment() {
  return (
    <div className="step-schedule">
      <p className="step-schedule-status">
        <BrandText>6 posts scheduled in Buffer for X and LinkedIn</BrandText>
      </p>
      <ol className="flow-schedule">
        {STORIES.map((story, index) => (
          <li key={story.title} style={{ '--step-index': index } as CSSProperties}>
            <time>{story.time}</time>
            <div>
              <strong>{story.title}</strong>
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
      <p className="flow-next">
        <Icon kind="check" /> Next run tomorrow at 08:00.
      </p>
    </div>
  )
}

/** Holds a fragment in its "before" state until it scrolls into view, then plays once. */
function StepFigure({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const [ref, state] = useOnceInView<HTMLDivElement>()

  return (
    <div ref={ref} className={`step-figure ${wide ? 'is-wide' : ''}`} data-state={state}>
      {children}
    </div>
  )
}

const STEPS: {
  art: StepArtKind
  title: string
  text: string
  figure: ReactNode
  wide?: boolean
  more?: boolean
}[] = [
  {
    art: 'brief',
    title: 'Describe what you want to post.',
    text: 'One paragraph sets the topic, what to skip, the channels and the schedule.',
    figure: <BriefFragment />,
  },
  {
    art: 'playbook',
    title: 'It writes a playbook you can edit.',
    text: 'Sources, voice, rules and timing, in plain words. Change anything before the first run.',
    figure: <PlaybookFragment />,
  },
  {
    art: 'research',
    title: 'It finds new stories and skips repeats.',
    text: 'Every run checks what you’ve already posted. A story you’ve shared before stays out of the queue, and so does company PR.',
    figure: <ResearchFragment />,
    wide: true,
  },
  {
    art: 'posts',
    title: 'It writes a post for each channel.',
    text: 'Every story gets an X post and a LinkedIn post, each written for its channel and its length.',
    figure: <PostsFragment />,
    more: true,
  },
  {
    art: 'schedule',
    title: 'It schedules them in Buffer.',
    text: 'Spread through the day, or saved as drafts for you to approve. Tomorrow it runs again.',
    figure: <ScheduleFragment />,
  },
]

export function RunSteps() {
  return (
    <section className="steps" aria-labelledby="run-steps-title">
      <div className="steps-heading">
        <h2 id="run-steps-title" tabIndex={-1}>
          Fine, you’d rather read about it.
        </h2>
        <p>Here’s the same run, one step at a time.</p>
      </div>
      <ol className="steps-list">
        {STEPS.map((step) => (
          <li key={step.title} className={`step ${step.wide ? 'is-wide' : ''}`}>
            <div className="step-copy">
              <StepArt kind={step.art} />
              <h3>
                <BrandText>{step.title}</BrandText>
              </h3>
              <p>
                <BrandText>{step.text}</BrandText>
              </p>
              {step.more ? (
                <details className="flow-written-posts">
                  <summary>Read all six example posts</summary>
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
                </details>
              ) : null}
            </div>
            <StepFigure wide={step.wide}>{step.figure}</StepFigure>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** A still of the finished run, drawn from the same pieces, behind the demo's play button. */
export function RunPoster() {
  return (
    <div className="flow-poster" aria-hidden="true" inert>
      <div className="flow-poster-canvas" data-state="done">
        <div className="flow-poster-column is-brief">
          <BriefFragment />
          <PlaybookFragment />
        </div>
        <div className="flow-poster-column">
          <ResearchFragment withMatch={false} />
        </div>
        <div className="flow-poster-column is-posts">
          <PostsFragment />
        </div>
        <div className="flow-poster-column">
          <ScheduleFragment />
        </div>
      </div>
    </div>
  )
}
