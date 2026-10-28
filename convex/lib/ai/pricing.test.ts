import { describe, expect, it } from 'vitest'
import { addUsage, costOf, EMPTY_USAGE, isKnownModel } from './pricing'

describe('model pricing', () => {
  it('prices a plain Sonnet call from its tokens', () => {
    const usd = costOf('claude-sonnet-5-5', {
      ...EMPTY_USAGE,
      inputTokens: 10_000,
      outputTokens: 1_000,
    })
    expect(usd).toBe(0.03)
  })

  it('charges cache writes more and cache reads less than fresh input', () => {
    const fresh = costOf('claude-sonnet-5-5', { ...EMPTY_USAGE, inputTokens: 100_000 })
    const written = costOf('claude-sonnet-5-5', { ...EMPTY_USAGE, cacheWriteTokens: 100_000 })
    const read = costOf('claude-sonnet-5-5', { ...EMPTY_USAGE, cacheReadTokens: 100_000 })
    expect(written).toBeGreaterThan(fresh)
    expect(read).toBeLessThan(fresh)
  })

  it('adds a cent per web search and nothing per fetch', () => {
    expect(costOf('claude-haiku-5-5', { ...EMPTY_USAGE, webSearches: 6, webFetches: 3 })).toBe(0.06)
  })

  it('prices an unknown model as Opus so a mistake costs more, not less', () => {
    const usage = { ...EMPTY_USAGE, inputTokens: 1_000_000 }
    expect(isKnownModel('claude-next')).toBe(false)
    expect(costOf('claude-next', usage)).toBe(costOf('claude-opus-5-5', usage))
  })

  it('sums usage field by field', () => {
    const a = { ...EMPTY_USAGE, inputTokens: 1, webSearches: 2 }
    const b = { ...EMPTY_USAGE, inputTokens: 3, outputTokens: 4 }
    expect(addUsage(a, b)).toEqual({
      ...EMPTY_USAGE,
      inputTokens: 4,
      outputTokens: 4,
      webSearches: 2,
    })
  })
})
