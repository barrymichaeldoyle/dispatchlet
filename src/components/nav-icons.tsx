import { useState, type ReactNode } from 'react'

type NavIconKind = 'home' | 'new' | 'settings' | 'feedback'

/** Line icons for the app's side navigation, drawn in the current text colour. */
export function NavIcon({ kind }: { kind: NavIconKind }) {
  return (
    <svg
      className="app-nav-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === 'home' ? (
        <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1Z" />
      ) : null}
      {kind === 'new' ? (
        <>
          <rect x="4" y="4" width="16" height="16" rx="4" />
          <path d="M12 8.5v7M8.5 12h7" />
        </>
      ) : null}
      {kind === 'settings' ? (
        <>
          <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
          <circle cx="15" cy="7" r="2" />
          <circle cx="9" cy="17" r="2" />
        </>
      ) : null}
      {kind === 'feedback' ? (
        <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4.5 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
      ) : null}
    </svg>
  )
}

/**
 * A round profile picture from Buffer. Without one, or when it fails to load, the fallback
 * (a network mark or an initial) sits in the same circle so rows keep their alignment.
 */
export function Avatar({
  src,
  size,
  badge = false,
  children,
}: {
  src: string | null | undefined
  size: number
  /** Keep the fallback as a small badge on the picture, as channels do with their network. */
  badge?: boolean
  children: ReactNode
}) {
  const [failed, setFailed] = useState<string | null>(null)
  const showImage = Boolean(src) && failed !== src
  return (
    <span className="app-avatar" style={{ width: size, height: size }}>
      {showImage ? (
        <img
          src={src ?? undefined}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(src ?? null)}
        />
      ) : null}
      {!showImage ? <span className="app-avatar-fallback">{children}</span> : null}
      {showImage && badge ? <span className="app-avatar-badge">{children}</span> : null}
    </span>
  )
}
