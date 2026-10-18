import { describe, expect, it } from 'vitest'
import { parseRateLimit, reserve, windowLength } from './budget'

// Copied from a real Buffer response (rateLimitFrom's output), 18 Oct 2026.
const RAW =
  'ratelimit: "100-in-15min"; r=98; t=900; ratelimit: "250-in-1day"; r=237; t=79089; ratelimit: "7500-in-30days"; r=7487; t=2584689; ratelimit-policy: "100-in-15min"; q=100; w=900; pk=:NGIyYmYwZGM4YzUx:; ratelimit-policy: "250-in-1day"; q=250; w=86400; pk=:NGIyYmYwZGM4YzUx:; x-ratelimit-limit: 7500; x-ratelimit-remaining: 7487; x-ratelimit-reset: 1794931756'

describe('the Buffer call budget', () => {
  it('reads every window and the partition from the headers', () => {
    const budget = parseRateLimit(RAW, 0)
    expect(budget.partition).toBe('NGIyYmYwZGM4YzUx')
    expect(budget.windows).toEqual([
      { name: '15min', limit: 100, remaining: 98, resetAt: 900_000 },
      { name: '1day', limit: 250, remaining: 237, resetAt: 79_089_000 },
      { name: '30days', limit: 7500, remaining: 7487, resetAt: 2_584_689_000 },
    ])
  })

  it('knows how long each window lasts', () => {
    expect(windowLength('15min')).toBe(900_000)
    expect(windowLength('1day')).toBe(86_400_000)
    expect(windowLength('30days')).toBe(2_592_000_000)
  })

  it('spends calls from every window', () => {
    const result = reserve(parseRateLimit(RAW, 0).windows, 3, 'interactive', 0)
    expect(result.ok && result.windows.map((w) => w.remaining)).toEqual([95, 234, 7484])
  })

  it('refuses when a window is spent and says when to try again', () => {
    const windows = [{ name: '1day', limit: 250, remaining: 2, resetAt: 5_000 }]
    expect(reserve(windows, 3, 'interactive', 0)).toEqual({ ok: false, retryAt: 5_000 })
  })

  it('makes scheduled work leave a fifth of each window for the person using the app', () => {
    const windows = [{ name: '1day', limit: 250, remaining: 52, resetAt: 5_000 }]
    expect(reserve(windows, 3, 'background', 0).ok).toBe(false)
    expect(reserve(windows, 3, 'interactive', 0).ok).toBe(true)
  })

  it('treats a window past its reset as full and starts the next one', () => {
    const windows = [{ name: '15min', limit: 100, remaining: 0, resetAt: 1_000 }]
    const result = reserve(windows, 1, 'background', 2_000)
    expect(result).toEqual({
      ok: true,
      windows: [{ name: '15min', limit: 100, remaining: 99, resetAt: 902_000 }],
    })
  })
})
