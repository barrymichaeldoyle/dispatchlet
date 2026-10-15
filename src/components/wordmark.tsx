const SIZES = {
  sm: { font: 17, mark: 12.5, tracking: '-0.035em', gap: -0.5 },
  md: { font: 22, mark: 16, tracking: '-0.035em', gap: -0.5 },
  lg: { font: 48, mark: 35, tracking: '-0.04em', gap: -1 },
} as const

export function Wordmark({ size = 'sm' }: { size?: keyof typeof SIZES }) {
  const s = SIZES[size]
  return (
    <span
      role="img"
      aria-label="Dispatchlet"
      className="inline-flex items-baseline font-semibold leading-none"
      style={{ fontSize: s.font, letterSpacing: s.tracking }}
    >
      <svg
        width={s.mark}
        height={s.mark}
        viewBox="3 3 18 18"
        aria-hidden="true"
        style={{ marginRight: s.gap }}
      >
        <path d="M3 3h11l7 9-7 9H3z" fill="currentColor" className="text-pine" />
      </svg>
      ispatchlet
    </span>
  )
}
