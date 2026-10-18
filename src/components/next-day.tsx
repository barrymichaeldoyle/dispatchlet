import type { CSSProperties } from 'react'
import { Icon } from './flow-icon'
import { NEXT_DAY, TIMING } from '../lib/example-run'

const { NEXT_ROW_START, NEXT_ROW_INTERVAL, NEXT_RECEIPT, NEXT_CLOSING } = TIMING

/**
 * The second run, the morning after: the part that makes this more than a post writer. In the
 * demo it follows the timeline; left without a time it shows the finished run.
 */
export function NextDay({
  elapsed = Number.POSITIVE_INFINITY,
  onBack,
}: {
  elapsed?: number
  onBack?: () => void
}) {
  const reveal = (time: number) => ({
    'data-revealed': elapsed >= time,
    'aria-hidden': elapsed < time || undefined,
  })
  return (
    <div className="next-day">
      <p className="next-day-kicker">The next morning, 08:00</p>
      <h3 className="next-day-title">It ran again without you.</h3>
      <ul className="next-day-stories">
        {NEXT_DAY.map(([title, status, source], index) => (
          <li
            key={title}
            className={`flow-reveal ${index < 2 ? 'is-new' : 'is-skipped'}`}
            style={{ '--step-index': index } as CSSProperties}
            {...reveal(NEXT_ROW_START + index * NEXT_ROW_INTERVAL)}
          >
            <Icon kind={index < 2 ? 'check' : 'skip'} />
            <span className="next-day-story">
              <span className="next-day-source">{source}</span>
              <strong>{title}</strong>
            </span>
            <span className="next-day-status">{status}</span>
          </li>
        ))}
      </ul>
      <p className="next-day-receipt flow-reveal" {...reveal(NEXT_RECEIPT)}>
        Only 2 stories were new, so it scheduled 4 posts instead of 6.
      </p>
      <p className="next-day-closing flow-reveal" {...reveal(NEXT_CLOSING)}>
        Your answers were the only part you did. It runs like this every day.
      </p>
      {onBack ? (
        <button
          type="button"
          className="next-day-back flow-reveal"
          onClick={onBack}
          {...reveal(NEXT_CLOSING)}
        >
          See the first run again
        </button>
      ) : null}
    </div>
  )
}
