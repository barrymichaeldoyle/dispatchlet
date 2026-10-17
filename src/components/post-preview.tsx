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
          GN
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
