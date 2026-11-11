import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const reload = vi.fn()

beforeEach(() => {
  vi.resetModules()
  reload.mockClear()
  const store = new Map<string, string>()
  vi.stubGlobal('window', { location: { reload } })
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('isStaleBuildError', () => {
  test('knows each browser’s message for a module that did not load', async () => {
    const { isStaleBuildError } = await import('./stale-build')
    for (const message of [
      'Failed to fetch dynamically imported module: https://dispatchlet.com/assets/app-CBK65lTy.js',
      'error loading dynamically imported module: https://dispatchlet.com/assets/app-CBK65lTy.js',
      'Importing a module script failed.',
      'Unable to preload CSS for /assets/app-BEScBL7c.css',
    ]) {
      expect(isStaleBuildError(new TypeError(message))).toBe(true)
    }
    expect(isStaleBuildError(new Error('Run not found'))).toBe(false)
    expect(isStaleBuildError(undefined)).toBe(false)
  })
})

describe('reloadForNewBuild', () => {
  test('reloads once, then holds back for a minute so it cannot loop', async () => {
    vi.useFakeTimers()
    const first = await import('./stale-build')
    expect(first.reloadForNewBuild()).toBe(true)
    expect(first.reloadForNewBuild()).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)

    // The reloaded page is a new document with the same session storage.
    vi.resetModules()
    const second = await import('./stale-build')
    vi.advanceTimersByTime(5_000)
    expect(second.reloadForNewBuild()).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(60_000)
    expect(second.reloadForNewBuild()).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  test('does not reload without session storage', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('SecurityError')
      },
    })
    const { reloadForNewBuild } = await import('./stale-build')
    expect(reloadForNewBuild()).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})
