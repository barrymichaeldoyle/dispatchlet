import type { CSSProperties } from 'react'
import { ChannelMark } from './brand-icons'
import { CANDIDATES } from '../lib/example-run'

/** The stories the example run turned down, word for word from the demo. */
const SKIPPED = CANDIDATES.filter(([, status]) => status.endsWith('skipped'))

/**
 * Every channel Dispatchlet can post to through Buffer, as listed in the FAQ. The example run posts
 * to X and LinkedIn, as its caption says, so only those light up; `at` is when the pulse reaches
 * each, in seconds into its cycle.
 */
const CHANNELS = [
  { channel: 'X', at: 0.25 },
  { channel: 'LinkedIn', at: 1.8 },
  { channel: 'Threads' },
  { channel: 'Bluesky' },
  { channel: 'Mastodon' },
]

/**
 * The stories the example run skipped, stacked behind the post it wrote. Purely visual, so it is
 * hidden from assistive tech; the figure's receipt line already says how many were skipped.
 */
export function HeroField() {
  return (
    <div className="hero-field" aria-hidden="true">
      {SKIPPED.map(([title, status], index) => (
        <div key={title} className="hero-slip" data-slip={index}>
          <s>{title}</s>
          <span>{status.replace(', skipped', '')}</span>
        </div>
      ))}
    </div>
  )
}

/** The channels, fed from the run above: a pulse runs down and along to the ones it posted to. */
export function HeroFan() {
  return (
    <div className="hero-fan" aria-hidden="true">
      <div className="hero-fan-inner">
        <span className="hero-fan-pulse" />
        {CHANNELS.map(({ channel, at }) => (
          <span
            key={channel}
            className="hero-fan-channel"
            data-posted={at === undefined ? undefined : 'true'}
            style={at === undefined ? undefined : ({ '--at': `${at}s` } as CSSProperties)}
          >
            <ChannelMark channel={channel} size={17} />
          </span>
        ))}
      </div>
    </div>
  )
}
