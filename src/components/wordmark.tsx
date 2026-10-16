const SIZES = {
  sm: { font: 17, mark: 13.6, tracking: '-0.035em', gap: 0.5 },
  md: { font: 22, mark: 17.6, tracking: '-0.035em', gap: 0.5 },
  lg: { font: 48, mark: 38.4, tracking: '-0.04em', gap: 0 },
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
        height={(s.mark * 15.42) / 16}
        viewBox="0 3.08 16 15.42"
        aria-hidden="true"
        style={{ marginRight: s.gap }}
      >
        <g transform="translate(-2.4 1.7) scale(.8)">
          <path d="M3 3h11l7 9-7 9H3z" fill="currentColor" className="text-pine" />
          <path d="M6.5 6.5h5.8l4.3 5.5-4.3 5.5H6.5z" fill="#fff" />
        </g>
        <path d="M13.2 7.953h2.412V18.5H13.2v-5.1l1.65-2.1-1.65-2.1z" fill="currentColor" />
        <circle cx="14.406" cy="4.789" r="1.709" fill="currentColor" />
      </svg>
      <span>
        spatch<span className="text-pine">let</span>
      </span>
    </span>
  )
}
