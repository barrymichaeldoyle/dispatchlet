import type { CSSProperties, ReactNode } from 'react'
import { ChannelMark } from './brand-icons'
import { StreamText } from './stream-text'
import { ANSWERS, ANSWER_SUMMARY, TIMING } from '../lib/example-run'

const {
  QUESTION_STARTS,
  TYPE_START,
  TYPE_DURATION,
  CHANNEL_TICKS,
  AVOID_START,
  AVOID_DURATION,
  SOURCE_START,
  SOURCE_INTERVAL,
  DAILY,
  RUN_TIME,
  STORY_COUNT,
  POSTING,
  CURSOR_START,
} = TIMING
const SOURCES = ANSWERS.sources.join(', ')

function Question({
  index,
  active,
  label,
  optional = false,
  hint,
  children,
}: {
  index: number
  active: number
  label: string
  optional?: boolean
  hint?: string
  children: ReactNode
}) {
  return (
    <div
      className="setup-question"
      data-active={active === index}
      style={{ '--step-index': index } as CSSProperties}
    >
      <div className="setup-label">
        <span>{label}</span>
        {optional ? <span className="setup-optional">Optional</span> : null}
      </div>
      <div className="setup-answer">
        {children}
        {hint ? <p className="setup-hint">{hint}</p> : null}
      </div>
    </div>
  )
}

function Choice({
  kind,
  checked,
  children,
}: {
  kind: 'checkbox' | 'radio'
  checked: boolean
  children: ReactNode
}) {
  return (
    <span className="setup-choice" data-checked={checked}>
      <span className={`setup-${kind}`} aria-hidden="true" />
      {children}
      {checked ? <span className="sr-only">, selected</span> : null}
    </span>
  )
}

/**
 * The setup questions, answered one after another in the demo. Left without a time it shows the
 * finished answers, for the step sections.
 */
export function SetupForm({
  elapsed = Number.POSITIVE_INFINITY,
  reduced = true,
}: {
  elapsed?: number
  reduced?: boolean
}) {
  const at = (time: number) => elapsed >= time
  const active =
    elapsed < CURSOR_START
      ? QUESTION_STARTS.reduce((current, start, index) => (at(start) ? index : current), -1)
      : -1
  const type = (text: string, start: number, duration: number, index: number) => (
    <StreamText
      text={text}
      elapsed={elapsed}
      start={start}
      duration={duration}
      reduced={reduced}
      caret={active === index}
    />
  )
  return (
    <div className="setup-form" role="group" aria-label="Example answers">
      <Question index={0} active={active} label="What should it research?">
        <div className="setup-input">{type(ANSWERS.topic, TYPE_START, TYPE_DURATION, 0)}</div>
      </Question>
      <Question index={1} active={active} label="Where should it post?">
        <div className="setup-choices">
          {ANSWERS.channels.map((channel, index) => (
            <Choice key={channel} kind="checkbox" checked={at(CHANNEL_TICKS[index])}>
              <ChannelMark channel={channel} size={13} />
              {channel}
            </Choice>
          ))}
        </div>
      </Question>
      <Question index={2} active={active} label="Anything to avoid?" optional>
        <div className="setup-input">{type(ANSWERS.avoid, AVOID_START, AVOID_DURATION, 2)}</div>
      </Question>
      <Question index={3} active={active} label="Sources you prefer?" optional>
        <div className="setup-input">
          {type(SOURCES, SOURCE_START, SOURCE_INTERVAL * ANSWERS.sources.length, 3)}
        </div>
        <div className="setup-choices">
          <Choice kind="checkbox" checked={false}>
            Only use these sources
          </Choice>
          <span className="setup-note">Unticked, it can find others too.</span>
        </div>
      </Question>
      <Question index={4} active={active} label="When should it run?">
        <div className="setup-choices">
          <Choice kind="radio" checked={at(DAILY)}>
            Daily
          </Choice>
          <Choice kind="radio" checked={false}>
            Weekly
          </Choice>
          <span className="setup-inline">
            at{' '}
            <span className="setup-input is-short tabular">{at(RUN_TIME) ? ANSWERS.time : ''}</span>
          </span>
          <span className="setup-note">Your time zone</span>
        </div>
      </Question>
      <Question
        index={5}
        active={active}
        label="How many stories a day?"
        hint="Each story gets a post for every channel. It never repeats what you’ve posted or scheduled, and schedules fewer on slow news days."
      >
        <div className="setup-choices">
          <span className="setup-inline">
            Up to{' '}
            <span className="setup-input is-short tabular">
              {at(STORY_COUNT) ? ANSWERS.stories : ''}
            </span>
          </span>
        </div>
      </Question>
      <Question
        index={6}
        active={active}
        label="How should posts reach Buffer?"
        hint="Drafts wait in Buffer for your approval."
      >
        <div className="setup-choices">
          <Choice kind="radio" checked={at(POSTING)}>
            Schedule them
          </Choice>
          <Choice kind="radio" checked={false}>
            Save as drafts
          </Choice>
        </div>
      </Question>
    </div>
  )
}

/** The submitted answers, as short rows. */
export function SetupSummary() {
  return (
    <dl className="setup-summary" aria-label="Example answers">
      {ANSWER_SUMMARY.map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}
