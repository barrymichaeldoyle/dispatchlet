import { describe, expect, it } from 'vitest'
import { expiresAtFrom, rateLimitFrom } from './buffer'

describe('Buffer helpers', () => {
  it('reads every rate-limit header into one line', () => {
    const headers = new Headers({
      'RateLimit-Policy': '250;w=86400',
      RateLimit: 'limit=250, remaining=243, reset=3600',
      'Content-Type': 'application/json',
    })
    const line = rateLimitFrom(headers)
    expect(line).toContain('ratelimit: limit=250, remaining=243, reset=3600')
    expect(line).toContain('ratelimit-policy: 250;w=86400')
    expect(line).not.toContain('content-type')
    expect(rateLimitFrom(new Headers())).toBeNull()
  })

  it('treats a token as expired two minutes early', () => {
    expect(expiresAtFrom(3600, 0)).toBe(3_600_000 - 120_000)
    expect(expiresAtFrom(undefined, 0)).toBe(3_600_000 - 120_000)
  })

  it('keeps at least half the life of a short-lived token', () => {
    expect(expiresAtFrom(60, 0)).toBe(30_000)
    expect(expiresAtFrom(300, 0)).toBe(180_000)
    expect(expiresAtFrom('abc', 0)).toBe(3_600_000 - 120_000)
    expect(expiresAtFrom(-5, 0)).toBe(3_600_000 - 120_000)
  })
})
