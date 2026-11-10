function typed(text: string, elapsed: number, start: number, duration: number, reduced: boolean) {
  return Math.floor(
    text.length * Math.min(1, Math.max(0, (elapsed - start) / (reduced ? 1 : duration))),
  )
}

/**
 * Text that types itself in. The words still to come are already laid out, invisibly, after the
 * typed ones, so every line breaks where it finally will: a word never starts on one line and
 * jumps to the next as it grows, and nothing reflows.
 */
export function StreamText({
  text,
  elapsed,
  start,
  duration,
  reduced,
  caret = false,
}: {
  text: string
  elapsed: number
  start: number
  duration: number
  reduced: boolean
  caret?: boolean
}) {
  const count = typed(text, elapsed, start, duration, reduced)
  return (
    <>
      <span className="flow-text" aria-hidden="true">
        <span className="flow-stream">{text.slice(0, count)}</span>
        {caret ? <span className="flow-caret" /> : null}
        <span className="flow-rest">{text.slice(count)}</span>
      </span>
      <span className="sr-only">{text}</span>
    </>
  )
}
