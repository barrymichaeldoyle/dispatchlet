import type { ReactNode } from 'react'
import { ChannelMark } from './brand-icons'
import { Icon } from './flow-icon'
import { StreamText } from './stream-text'
import { ANSWERS, ANSWER_ROWS, TIMING } from '../lib/example-run'

const {
  QUESTION_STARTS,
  ANSWERED,
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
  DONE,
} = TIMING
const SOURCES = ANSWERS.sources.join(', ')

/** A big selectable block, the demo's stand-in for a checkbox or radio button. */
function Block({
  checked,
  detail,
  className = '',
  children,
}: {
  checked: boolean
  detail?: string
  className?: string
  children: ReactNode
}) {
  return (
    <span className={`setup-block ${className}`} data-checked={checked}>
      <span className="setup-block-title">{children}</span>
      {detail ? <span className="setup-block-detail">{detail}</span> : null}
      {checked ? <span className="sr-only">, selected</span> : null}
    </span>
  )
}

type Question = { label: string; optional?: boolean; hint?: string; answer: ReactNode }

function questions(elapsed: number, reduced: boolean): Question[] {
  const at = (time: number) => elapsed >= time
  const type = (text: string, start: number, duration: number) => (
    <span className="setup-input">
      <StreamText
        text={text}
        elapsed={elapsed}
        start={start}
        duration={duration}
        reduced={reduced}
        caret={elapsed < start + duration + 200}
      />
    </span>
  )
  return [
    {
      label: 'What should it research?',
      hint: 'One line is enough.',
      answer: type(ANSWERS.topic, TYPE_START, TYPE_DURATION),
    },
    {
      label: 'Where should it post?',
      hint: 'Text channels in your Buffer account. Pick as many as you like.',
      answer: (
        <span className="setup-blocks">
          {ANSWERS.allChannels.map((channel, index) => (
            <Block
              key={channel}
              checked={index < ANSWERS.channels.length && at(CHANNEL_TICKS[index])}
              className="is-logo"
            >
              <ChannelMark channel={channel} size={28} />
            </Block>
          ))}
        </span>
      ),
    },
    {
      label: 'Anything to avoid?',
      optional: true,
      answer: type(ANSWERS.avoid, AVOID_START, AVOID_DURATION),
    },
    {
      label: 'Any sources you prefer?',
      optional: true,
      hint: 'Unless you tick the box, it can find other reliable sources too.',
      answer: (
        <>
          {type(SOURCES, SOURCE_START, SOURCE_INTERVAL * ANSWERS.sources.length)}
          <Block checked={false} className="is-wide">
            <span className="setup-box" aria-hidden="true" />
            Only use these sources
          </Block>
        </>
      ),
    },
    {
      label: 'When should it run?',
      hint: 'In your time zone.',
      answer: (
        <span className="setup-blocks">
          <Block checked={at(DAILY)}>Daily</Block>
          <Block checked={false}>Weekly</Block>
          <Block checked={at(RUN_TIME)} className="tabular">
            {at(RUN_TIME) ? `At ${ANSWERS.time}` : 'At …'}
          </Block>
        </span>
      ),
    },
    {
      label: 'How many stories a day, at most?',
      hint: 'Each story gets a post for every channel. It never repeats what you’ve posted or scheduled, and schedules fewer on slow news days.',
      answer: (
        <span className="setup-blocks is-numbers">
          {[1, 2, 3].map((count) => (
            <Block
              key={count}
              checked={count === ANSWERS.stories && at(STORY_COUNT)}
              className="tabular"
            >
              {count}
            </Block>
          ))}
        </span>
      ),
    },
    {
      label: 'How should posts reach Buffer?',
      answer: (
        <span className="setup-blocks">
          <Block checked={at(POSTING)} detail="Into your queue, spread through the day.">
            Schedule them
          </Block>
          <Block checked={false} detail="They wait in Buffer for your approval.">
            Save as drafts
          </Block>
        </span>
      ),
    },
  ]
}

/**
 * The setup questions, one at a time. In the demo they follow the timeline; `still` holds one
 * answered question for the step sections.
 */
export function SetupQuestions({
  elapsed = Number.POSITIVE_INFINITY,
  reduced = true,
  still,
}: {
  elapsed?: number
  reduced?: boolean
  still?: number
}) {
  const list = questions(elapsed, reduced)
  const current =
    still ??
    (elapsed >= DONE
      ? list.length
      : QUESTION_STARTS.reduce((last, start, index) => (elapsed >= start ? index : last), 0))
  const question = list[current]
  return (
    <div className="setup-stage" role="group" aria-label="Example question">
      <div className="setup-progress" aria-hidden="true">
        {list.map((_, index) => (
          <span key={index} data-done={elapsed >= ANSWERED[index] || index < current} />
        ))}
      </div>
      {question ? (
        <div key={current} className="setup-question">
          <p className="setup-count">
            Question {current + 1} of {list.length}
            {question.optional ? ', optional' : ''}
          </p>
          <h4 className="setup-title">{question.label}</h4>
          <div className="setup-answer">{question.answer}</div>
          {question.hint ? <p className="setup-hint">{question.hint}</p> : null}
        </div>
      ) : (
        <div key="done" className="setup-question setup-done">
          <Icon kind="check" />
          <h4 className="setup-title">That’s everything.</h4>
          <p className="setup-hint">Check your answers, then create the playbook.</p>
        </div>
      )}
    </div>
  )
}

/** The answers so far, one row per question, filling in as each one is answered. */
export function SetupAnswers({ elapsed = Number.POSITIVE_INFINITY }: { elapsed?: number }) {
  return (
    <dl className="setup-answers" aria-label="Example answers">
      {ANSWER_ROWS.map(([name, value], index) => (
        <div
          key={name}
          data-current={elapsed >= QUESTION_STARTS[index] && elapsed < ANSWERED[index]}
        >
          <dt>{name}</dt>
          <dd
            className="flow-reveal"
            data-revealed={elapsed >= ANSWERED[index]}
            aria-hidden={elapsed < ANSWERED[index] || undefined}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
