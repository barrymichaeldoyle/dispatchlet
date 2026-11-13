import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

async function load(build: string) {
  vi.resetModules()
  vi.stubGlobal('__BUILD_ID__', build)
  vi.stubEnv('DEV', false)
  return await import('./build-version')
}

function liveBuild(build: string) {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ build })))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('checkForNewBuild', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('waits an interval after loading before it asks', async () => {
    const { checkForNewBuild } = await load('a')
    const fetch = liveBuild('b')
    expect(await checkForNewBuild()).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10 * 60_000)
    expect(await checkForNewBuild()).toBe(true)
  })

  it('says behind only when the live build differs', async () => {
    const { checkForNewBuild } = await load('a')
    liveBuild('a')
    vi.advanceTimersByTime(60_000)
    expect(await checkForNewBuild(true)).toBe(false)
  })

  it('asks at most every 30 seconds even when forced', async () => {
    const { checkForNewBuild } = await load('a')
    const fetch = liveBuild('a')
    vi.advanceTimersByTime(60_000)
    await checkForNewBuild(true)
    await checkForNewBuild(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('treats a failed request as not behind', async () => {
    const { checkForNewBuild } = await load('a')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline'))),
    )
    vi.advanceTimersByTime(60_000)
    expect(await checkForNewBuild(true)).toBe(false)
  })

  it('never asks from a dev server', async () => {
    vi.resetModules()
    vi.stubGlobal('__BUILD_ID__', 'a')
    vi.stubEnv('DEV', true)
    const { checkForNewBuild } = await import('./build-version')
    const fetch = liveBuild('b')
    vi.advanceTimersByTime(60 * 60_000)
    expect(await checkForNewBuild(true)).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('reloadOntoNewBuild', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('reloads once per live build, so a mismatch a reload cannot fix does not loop', async () => {
    vi.useFakeTimers()
    const { checkForNewBuild, reloadOntoNewBuild } = await load('a')
    liveBuild('b')
    const store = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    })
    const assign = vi.fn()
    vi.stubGlobal('window', { location: { href: '/app', assign } })
    expect(reloadOntoNewBuild()).toBe(false)
    vi.advanceTimersByTime(60_000)
    await checkForNewBuild(true)
    expect(reloadOntoNewBuild('/app/settings')).toBe(true)
    expect(assign).toHaveBeenCalledWith('/app/settings')
    expect(reloadOntoNewBuild()).toBe(false)
  })
})
