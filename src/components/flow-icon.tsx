export function Icon({
  kind,
}: {
  kind:
    | 'play'
    | 'pause'
    | 'replay'
    | 'check'
    | 'arrow'
    | 'close'
    | 'skip'
    | 'brief'
    | 'playbook'
    | 'research'
    | 'posts'
}) {
  return (
    <svg
      className={kind === 'check' ? 'flow-check' : undefined}
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
      {kind === 'play' ? <path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none" /> : null}
      {kind === 'pause' ? <path d="M9 5v14M16 5v14" /> : null}
      {kind === 'replay' ? (
        <>
          <path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" />
        </>
      ) : null}
      {kind === 'check' ? <path d="m5 12 4 4L19 6" /> : null}
      {kind === 'close' ? <path d="m6 6 12 12M6 18 18 6" /> : null}
      {kind === 'skip' ? (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="m6.5 17.5 11-11" />
        </>
      ) : null}
      {kind === 'skip' ? (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="m6.5 17.5 11-11" />
        </>
      ) : null}
      {kind === 'brief' ? <path d="M3.5 5h17v14h-17zM7.5 10h9M7.5 14h5" /> : null}
      {kind === 'playbook' ? <path d="M5 3h14v18H5zM8.5 8h7M8.5 12h7M8.5 16h4" /> : null}
      {kind === 'research' ? (
        <>
          <circle cx="10.5" cy="10.5" r="6" />
          <path d="m15 15 5 5" />
        </>
      ) : null}
      {kind === 'posts' ? (
        <path d="M3 9.5h5v5H3zM16 3.5h5v5h-5zM16 15.5h5v5h-5zM8 12h2.5c2.5 0 2.5-6 5.5-6M10.5 12c2.5 0 2.5 6 5.5 6" />
      ) : null}
      {kind === 'arrow' ? <path d="M5 12h14m-5-5 5 5-5 5" /> : null}
    </svg>
  )
}
