import { useSyncExternalStore, type Ref } from 'react'
import { getPreference, setTheme, subscribeTheme, type ThemePreference } from '../lib/theme'

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

const serverPreference = () => null

export function ThemeToggle({ name, ref }: { name: string; ref?: Ref<HTMLDivElement> }) {
  const preference = useSyncExternalStore(subscribeTheme, getPreference, serverPreference)

  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Theme" ref={ref}>
      {OPTIONS.map(({ value, label }) => (
        <label key={value}>
          <input
            type="radio"
            name={name}
            value={value}
            checked={preference === value}
            disabled={preference === null}
            onChange={() => setTheme(value)}
          />
          <ThemeIcon preference={value} />
          <span className="sr-only">{label}</span>
        </label>
      ))}
    </div>
  )
}

function ThemeIcon({ preference }: { preference: ThemePreference }) {
  return (
    <svg
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
      {preference === 'light' ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2.2M12 19.3v2.2M4.4 4.4l1.6 1.6M18 18l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.4 19.6 6 18M18 6l1.6-1.6" />
        </>
      ) : null}
      {preference === 'dark' ? <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 7 7 0 1 0 20 14.5z" /> : null}
      {preference === 'system' ? (
        <>
          <rect x="3" y="4" width="18" height="12" rx="1.5" />
          <path d="M8 20h8M12 16v4" />
        </>
      ) : null}
    </svg>
  )
}
