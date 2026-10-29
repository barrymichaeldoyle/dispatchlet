/**
 * A button label that changes while work is in progress without changing the button's size.
 * Both labels sit in one grid cell, so the button is always as wide as the longer one; the label
 * not in use is hidden but keeps its space. Pass `busy` and give the button `aria-busy` too.
 */
export function BusyLabel({
  busy,
  idle,
  working,
}: {
  busy: boolean
  idle: string
  working: string
}) {
  return (
    <span className="busy-label" data-busy={busy}>
      <span aria-hidden={busy}>{idle}</span>
      <span aria-hidden={!busy}>{working}</span>
    </span>
  )
}
