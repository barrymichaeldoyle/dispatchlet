export type ThemePreference = 'light' | 'dark' | 'system'
type Theme = 'light' | 'dark'

const STORAGE_KEY = 'dispatchlet-theme'
const CHANGE_EVENT = 'dispatchlet:theme'

/** Apply a saved choice before paint, while keeping system preference as the default. */
export const THEME_SCRIPT = `(() => {
  try {
    const theme = localStorage.getItem('${STORAGE_KEY}');
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.dataset.theme = theme;
      document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
        meta.content = theme === 'dark' ? '#161616' : '#f4f4f1';
      });
    }
  } catch {}
})();`

export function getPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
  } catch {
    return preferenceFromDocument()
  }
  return preferenceFromDocument()
}

function preferenceFromDocument(): ThemePreference {
  const saved = document.documentElement.dataset.theme
  if (saved === 'light' || saved === 'dark') return saved
  return 'system'
}

function getTheme(): Theme {
  const preference = getPreference()
  if (preference === 'light' || preference === 'dark') return preference
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function subscribeTheme(onChange: () => void): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const onSystemChange = () => {
    updateBrowserTheme()
    onChange()
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return
    if (event.newValue === 'light' || event.newValue === 'dark') {
      document.documentElement.dataset.theme = event.newValue
    } else {
      delete document.documentElement.dataset.theme
    }
    updateBrowserTheme()
    onChange()
  }
  media.addEventListener('change', onSystemChange)
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    media.removeEventListener('change', onSystemChange)
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onStorage)
  }
}

function updateBrowserTheme() {
  const color = getTheme() === 'dark' ? '#161616' : '#f4f4f1'
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = color
  }
}

export function setTheme(preference: ThemePreference): void {
  if (preference === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = preference
  updateBrowserTheme()
  try {
    localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // Switching still works when browser storage is unavailable.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}
