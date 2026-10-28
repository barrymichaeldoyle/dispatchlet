/**
 * What a model call costs, from the usage the API reports. Prices are US dollars per million
 * tokens from platform.claude.com/pricing (checked 2026-10-19 and 2026-10-28). Web search is
 * billed per search on top of the tokens its results add; web fetch is free apart from those tokens.
 */

export type ModelId = 'claude-sonnet-5-5' | 'claude-opus-5-5' | 'claude-haiku-5-5'

type Prices = { input: number; output: number; cacheWrite: number; cacheRead: number }

export const PRICES: Record<ModelId, Prices> = {
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
}

export const WEB_SEARCH_USD = 0.01

/** The parts of the API's `usage` object that cost money, flattened and never null. */
export type Usage = {
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  webSearches: number
  webFetches: number
}

export const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  webSearches: 0,
  webFetches: 0,
}

export function isKnownModel(model: string): model is ModelId {
  return model in PRICES
}

/** Cost in US dollars, rounded to a tenth of a cent. Unknown models are priced as Opus, the dearest. */
export function costOf(model: string, usage: Usage): number {
  const p = PRICES[isKnownModel(model) ? model : 'claude-opus-5-5']
  const perMillion =
    usage.inputTokens * p.input +
    usage.outputTokens * p.output +
    usage.cacheWriteTokens * p.cacheWrite +
    usage.cacheReadTokens * p.cacheRead
  const usd = perMillion / 1_000_000 + usage.webSearches * WEB_SEARCH_USD
  return Math.round(usd * 10_000) / 10_000
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    webSearches: a.webSearches + b.webSearches,
    webFetches: a.webFetches + b.webFetches,
  }
}
