import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const sdk = vi.hoisted(() => ({ init: vi.fn(), capture: vi.fn() }))
vi.mock('posthog-js/dist/module.slim', () => ({ default: sdk }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubGlobal('window', {})
  vi.stubEnv('VITE_POSTHOG_KEY', 'test-public-token')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('deferred analytics', () => {
  test('preserves early funnel events and initializes once', async () => {
    const { track, initializeAnalytics } = await import('./track')
    track('waitlist_viewed')
    track('waitlist_submitted', { position: 7 })
    expect(sdk.capture).not.toHaveBeenCalled()
    await Promise.all([initializeAnalytics(), initializeAnalytics()])
    expect(sdk.init).toHaveBeenCalledTimes(1)
    expect(sdk.capture.mock.calls).toEqual([
      ['waitlist_viewed', undefined],
      ['waitlist_submitted', { position: 7 }],
    ])
    track('waitlist_confirmed')
    expect(sdk.capture).toHaveBeenLastCalledWith('waitlist_confirmed', undefined)
  })

  test('does not load analytics when unconfigured', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', '')
    const { track, initializeAnalytics } = await import('./track')
    track('waitlist_viewed')
    await initializeAnalytics()
    expect(sdk.init).not.toHaveBeenCalled()
    expect(sdk.capture).not.toHaveBeenCalled()
  })

  test('an analytics failure cannot reject into the UI and can be retried', async () => {
    sdk.init.mockImplementationOnce(() => {
      throw new Error('Analytics unavailable')
    })
    const { initializeAnalytics } = await import('./track')
    await expect(initializeAnalytics()).resolves.toBeUndefined()
    await initializeAnalytics()
    expect(sdk.init).toHaveBeenCalledTimes(2)
  })
})
