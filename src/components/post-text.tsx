import { Fragment } from 'react'

const URL_PATTERN = /https?:\/\/[^\s]+/g

/** A link as the networks show it: the host and the start of the path, not the whole address. */
function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname === '/' ? '' : u.pathname
    const shown = `${u.hostname.replace(/^www\./, '')}${path}`
    return shown.length > 36 ? `${shown.slice(0, 35)}…` : shown
  } catch {
    return url
  }
}

/** Post text with its links shown short and clickable, line breaks kept. */
export function PostText({
  text,
  className = 'app-draft-text',
}: {
  text: string
  className?: string
}) {
  const parts: { kind: 'text' | 'url'; value: string }[] = []
  let last = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0
    if (start > last) parts.push({ kind: 'text', value: text.slice(last, start) })
    parts.push({ kind: 'url', value: match[0] })
    last = start + match[0].length
  }
  if (last < text.length) parts.push({ kind: 'text', value: text.slice(last) })
  return (
    <p className={className}>
      {parts.map((part, i) =>
        part.kind === 'url' ? (
          <a key={i} href={part.value} target="_blank" rel="noreferrer" className="app-post-link">
            {shortUrl(part.value)}
          </a>
        ) : (
          <Fragment key={i}>{part.value}</Fragment>
        ),
      )}
    </p>
  )
}
