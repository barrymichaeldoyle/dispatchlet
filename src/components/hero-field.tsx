import { ChannelMark } from './brand-icons'
import { CANDIDATES } from '../lib/example-run'

/** The stories the example run turned down, word for word from the demo. */
const SKIPPED = CANDIDATES.filter(([, status]) => status.endsWith('skipped'))

/**
 * Where one run's posts go: each channel sits at the end of a line from the run.
 * `x` is in the 360-wide viewBox (the column scales it); `y` is in pixels.
 */
const CHANNELS = [
  { channel: 'X', x: 70, y: 150, path: 'M14 8 C 14 90, 40 150, 70 150' },
  { channel: 'LinkedIn', x: 140, y: 64, path: 'M14 8 C 30 50, 90 64, 140 64' },
  { channel: 'Threads', x: 200, y: 168, path: 'M14 8 C 40 120, 130 168, 200 168' },
  { channel: 'Bluesky', x: 262, y: 96, path: 'M14 8 C 60 70, 180 96, 262 96' },
  { channel: 'Mastodon', x: 326, y: 176, path: 'M14 8 C 80 150, 250 176, 326 176' },
]

/**
 * Decoration for the hero's example run: the stories it skipped, pushed behind the post it wrote,
 * and the run fanning out to every channel Buffer can post to. Purely visual, so it is hidden from
 * assistive tech; the run itself is described in the figure's text.
 */
export function HeroField() {
  return (
    <div className="hero-field" aria-hidden="true">
      <div className="hero-field-grid" />
      {SKIPPED.map(([title, status, source], index) => (
        <div key={title} className="hero-slip" data-slip={index}>
          <span className="hero-slip-source">{source}</span>
          <s>{title}</s>
          <span className="hero-slip-status">{status}</span>
        </div>
      ))}
      <div className="hero-fan">
        <svg className="hero-fan-lines" viewBox="0 0 360 210" preserveAspectRatio="none">
          {CHANNELS.map(({ channel, path }, index) => (
            <path
              key={channel}
              d={path}
              style={{ animationDelay: `${index * -1.3}s` }}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        <span className="hero-fan-origin" />
        {CHANNELS.map(({ channel, x, y }, index) => (
          <span
            key={channel}
            className="hero-fan-channel"
            style={{
              left: `${(x / 360) * 100}%`,
              top: `${y}px`,
              animationDelay: `${index * -1.7}s, ${index * 1.6}s`,
            }}
          >
            <ChannelMark channel={channel} size={17} />
          </span>
        ))}
      </div>
    </div>
  )
}
