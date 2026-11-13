import { useEffect, useRef, useState } from 'react'
import { BufferMark } from './brand-icons'

/**
 * The signing-in loader: the mark dispatches small arrows toward Buffer, and the line under it
 * says which part is running. Clicking the mark sends one more. With reduced motion the arrows
 * stay put.
 *
 * The server sends this same loader for /app until the script runs (see `BootPlaceholder`), so
 * that `pickUp` lets the app's copy carry on the placeholder's arrows from where they are, rather
 * than starting them over. The placeholder has no steps yet; the app's line fades in.
 */
export function SigningInLoader({
  steps = [],
  pickUp = false,
}: {
  steps?: string[]
  pickUp?: boolean
}) {
  const [step, setStep] = useState(0)
  const [shots, setShots] = useState<number[]>([])
  const [elapsed] = useState(() => (pickUp ? placeholderElapsed() : 0))
  const nextShot = useRef(0)
  useEffect(() => {
    if (steps.length < 2) return
    const timer = window.setInterval(
      () => setStep((value) => Math.min(value + 1, steps.length - 1)),
      1100,
    )
    return () => window.clearInterval(timer)
  }, [steps])
  const dispatch = () => {
    const id = nextShot.current++
    setShots((value) => [...value, id])
  }
  return (
    <>
      <div className="signin-dispatch" aria-hidden="true" onPointerDown={dispatch}>
        <svg className="signin-mark" width="56" height="56" viewBox="0 0 24 24">
          <path
            fillRule="evenodd"
            d="M3 3h11l7 9-7 9H3zM6.5 6.5v11h5.8l4.3-5.5-4.3-5.5z"
            fill="var(--color-pine)"
          />
        </svg>
        <div className="signin-lane">
          {[0, 1, 2].map((index) => (
            <Arrow key={index} className="is-loop" delay={index * 0.5 - elapsed} />
          ))}
          {shots.map((id) => (
            <Arrow
              key={`shot-${id}`}
              className="is-shot"
              onDone={() => setShots((value) => value.filter((shot) => shot !== id))}
            />
          ))}
        </div>
        <span className="signin-buffer">
          <BufferMark size={22} />
        </span>
      </div>
      <p className="signin-steps" aria-live="polite">
        {steps.length ? (
          steps.map((text, index) => (
            <span key={text} data-active={index === step} aria-hidden={index !== step}>
              {text}
            </span>
          ))
        ) : (
          // Holds the line's height, so the steps arrive without moving anything.
          <span aria-hidden="true">{' '}</span>
        )}
      </p>
    </>
  )
}

/** How far, in seconds, the server's placeholder has got through its arrows, if it is showing. */
function placeholderElapsed() {
  const arrow = document.querySelector('.boot-placeholder .signin-arrow.is-loop')
  const time = arrow?.getAnimations?.()[0]?.currentTime
  return typeof time === 'number' ? time / 1000 : 0
}

function Arrow({
  className,
  delay = 0,
  onDone,
}: {
  className: string
  delay?: number
  onDone?: () => void
}) {
  return (
    <svg
      className={`signin-arrow ${className}`}
      width="14"
      height="16"
      viewBox="0 0 14 16"
      style={{ animationDelay: `${delay}s` }}
      onAnimationEnd={onDone}
    >
      <path d="M1 1h6l5 7-5 7H1z" fill="var(--color-pine)" />
    </svg>
  )
}
