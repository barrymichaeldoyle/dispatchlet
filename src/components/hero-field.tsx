import type { CSSProperties } from 'react'
import { ChannelMark } from './brand-icons'
import { CANDIDATES } from '../lib/example-run'

/** The stories the example run turned down, word for word from the demo. */
const SKIPPED = CANDIDATES.filter(([, status]) => status.endsWith('skipped'))

/** Every channel Dispatchlet can post to through Buffer, as listed in the FAQ. */
const CHANNELS = ['X', 'LinkedIn', 'Threads', 'Bluesky', 'Mastodon']

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

/** The channels a run posts to, lit in turn as a pulse runs along their rail. */
export function HeroFan() {
  return (
    <div className="hero-fan" aria-hidden="true">
      <div className="hero-fan-inner">
        <span className="hero-fan-pulse" />
        {CHANNELS.map((channel, index) => (
          <span
            key={channel}
            className="hero-fan-channel"
            style={{ '--i': index } as CSSProperties}
          >
            <ChannelMark channel={channel} size={17} />
          </span>
        ))}
      </div>
    </div>
  )
}
