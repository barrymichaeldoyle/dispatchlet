/**
 * Buffer's call budget. Buffer sends one `ratelimit` header per window (15 minutes, a day, 30
 * days; each grows with the number of accounts that have connected the app), each with the calls
 * left (`r`) and seconds until it resets (`t`), plus a partition key (`pk`) saying whose budget it is. Calls are reserved against the latest numbers
 * before they are made, so two runs at once cannot both spend the last of a window.
 */

export type BudgetWindow = { name: string; limit: number; remaining: number; resetAt: number }

export type Budget = { partition: string | null; windows: BudgetWindow[] }

/** Background work (scheduled runs) leaves this share of every window for the person using the app. */
export const BACKGROUND_RESERVE = 0.2

export type Priority = 'interactive' | 'background'

const UNIT_MS: Record<string, number> = { min: 60_000, hour: 3_600_000, day: 86_400_000 }

/** How long a window named like `15min`, `1day` or `30days` lasts. */
export function windowLength(name: string): number {
  const [, count = '1', unit = 'day'] = name.match(/^(\d+)(min|hour|day)s?$/) ?? []
  return Number(count) * (UNIT_MS[unit] ?? UNIT_MS.day)
}

/** Reads Buffer's rate-limit headers, as `rateLimitFrom` joins them, into windows. */
export function parseRateLimit(raw: string, now = Date.now()): Budget {
  const windows = [...raw.matchAll(/"(\d+)-in-(\w+)";\s*r=(\d+);\s*t=(\d+)/g)].map(
    ([, limit, name, remaining, seconds]) => ({
      name,
      limit: Number(limit),
      remaining: Number(remaining),
      resetAt: now + Number(seconds) * 1000,
    }),
  )
  const partition = raw.match(/pk=:([^:;\s]+):/)?.[1] ?? null
  return { partition, windows }
}

/**
 * Whether `calls` more calls fit in every window. A window past its reset time is full again.
 * Returns the windows after spending them, or when to try again.
 */
export function reserve(
  windows: BudgetWindow[],
  calls: number,
  priority: Priority,
  now = Date.now(),
): { ok: true; windows: BudgetWindow[] } | { ok: false; retryAt: number } {
  let retryAt = 0
  const next = windows.map((window) => {
    const fresh = now >= window.resetAt
    const current = fresh ? window.limit : window.remaining
    const resetAt = fresh ? now + windowLength(window.name) : window.resetAt
    const kept = priority === 'background' ? Math.ceil(window.limit * BACKGROUND_RESERVE) : 0
    if (current - kept < calls) retryAt = Math.max(retryAt, resetAt)
    return { ...window, remaining: current - calls, resetAt }
  })
  return retryAt ? { ok: false, retryAt } : { ok: true, windows: next }
}
