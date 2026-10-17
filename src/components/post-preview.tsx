import type { ReactNode } from 'react'
import { ChannelMark } from './brand-icons'

/** A post as it will look on its channel: who posts it, where, and the words. */
export function PostPreview({
  channel,
  length,
  children,
}: {
  channel: string
  length: number
  children: ReactNode
}) {
  return (
    <div className="flow-post-preview">
      <div className="flow-post-head">
        <span className="flow-avatar" aria-hidden="true">
          {/* The example account's profile picture: a sun coming up over the horizon. */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M6.5 16.5a5.5 5.5 0 0 1 11 0z" fill="currentColor" />
            <path
              d="M3.5 19.5h17M12 5v2.5M5.6 8.1l1.7 1.7M18.4 8.1l-1.7 1.7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <span className="flow-post-author">
          <strong>Good News Today</strong>
          <span>{channel === 'X' ? '@goodnewstoday' : 'Page'}</span>
        </span>
        {channel === 'X' ? <span className="flow-count">{length} of 280</span> : null}
        <span className="flow-channel">
          <ChannelMark channel={channel} />
        </span>
      </div>
      <p>{children}</p>
    </div>
  )
}
