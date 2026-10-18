function stream(text: string, elapsed: number, start: number, duration: number, reduced: boolean) {
  return text.slice(
    0,
    Math.floor(
      text.length * Math.min(1, Math.max(0, (elapsed - start) / (reduced ? 1 : duration))),
    ),
  )
}

/** Text that types itself in. A hidden full copy holds the final size, so nothing reflows. */
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
  return (
    <>
      <span className="flow-text" aria-hidden="true">
        <span className="flow-measure">
          {text}
          <span className="flow-caret-space" />
        </span>
        <span className="flow-stream">
          {stream(text, elapsed, start, duration, reduced)}
          {caret ? <span className="flow-caret" /> : null}
        </span>
      </span>
      <span className="sr-only">{text}</span>
    </>
  )
}
