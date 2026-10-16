import { useSyncExternalStore } from 'react'
import { getTheme, subscribeTheme, toggleTheme } from '../lib/theme'

const serverTheme = () => null

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, serverTheme)
  const label = theme === 'dark' ? 'Light' : 'Dark'

  return (
    <button
      type="button"
      onClick={toggleTheme}
      disabled={theme === null}
      aria-label={theme === null ? 'Switch theme' : `Switch to ${label.toLowerCase()} mode`}
      className="h-10 w-12 shrink-0 bg-transparent text-ink underline-offset-3 hover:underline disabled:cursor-default"
    >
      {theme === null ? 'Theme' : label}
    </button>
  )
}
