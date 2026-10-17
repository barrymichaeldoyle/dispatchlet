import type { ReactNode } from 'react'
import { useOnceInView } from '../lib/use-once-in-view'

export type StepArtKind = 'brief' | 'playbook' | 'research' | 'posts' | 'schedule'

/** Each drawing shows the one thing that step does, in a single line weight with pine marking the change. */
const ART: Record<StepArtKind, ReactNode> = {
  brief: (
    <>
      <rect x="8" y="12" width="48" height="40" pathLength={1} />
      <path d="M16 24h32M16 32h28M16 40h12" pathLength={1} />
      <path className="is-accent" d="M31 36v9" pathLength={1} />
    </>
  ),
  playbook: (
    <>
      <rect x="14" y="8" width="36" height="48" pathLength={1} />
      <path className="is-accent" d="M20 18h24" pathLength={1} />
      <path d="M20 28h5M30 28h14M20 37h5M30 37h12M20 46h5M30 46h9" pathLength={1} />
    </>
  ),
  research: (
    <>
      <circle cx="27" cy="27" r="16" pathLength={1} />
      <path d="M39 39l14 14M19 21h16M19 33h16" pathLength={1} />
      <path className="is-accent" d="M17 27h20" pathLength={1} />
      <path className="is-accent" d="M15 31l24-8" pathLength={1} />
    </>
  ),
  posts: (
    <>
      <rect x="6" y="25" width="18" height="14" pathLength={1} />
      <rect x="40" y="8" width="18" height="14" pathLength={1} />
      <rect x="40" y="42" width="18" height="14" pathLength={1} />
      <path className="is-accent" d="M24 32h6c4 0 4-17 10-17M30 32c4 0 4 17 10 17" pathLength={1} />
    </>
  ),
  schedule: (
    <>
      <path d="M18 8v48" pathLength={1} />
      <path d="M26 16h26M26 32h20M26 48h24" pathLength={1} />
      <circle className="is-accent" cx="18" cy="16" r="3" pathLength={1} />
      <circle className="is-accent" cx="18" cy="32" r="3" pathLength={1} />
      <circle className="is-accent" cx="18" cy="48" r="3" pathLength={1} />
    </>
  ),
}

export function StepArt({ kind }: { kind: StepArtKind }) {
  const [ref, state] = useOnceInView<HTMLSpanElement>()
  return (
    <span ref={ref} className="step-art" data-state={state} aria-hidden="true">
      <svg width="56" height="56" viewBox="0 0 64 64" fill="none">
        {ART[kind]}
      </svg>
    </span>
  )
}
