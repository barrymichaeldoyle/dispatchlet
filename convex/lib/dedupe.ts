/**
 * The two checks that keep a story from being posted twice, in code so they are the same on every
 * run: the page's canonical URL, then the title's word overlap with everything already kept.
 */

const TRACKING = /^(utm_|fbclid|gclid|mc_|ref$|source$|igshid)/i

export function canonicalUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return raw.trim().toLowerCase()
  }
  url.hash = ''
  url.hostname = url.hostname.toLowerCase().replace(/^(www|amp|m)\./, '')
  const keys = Array.from(url.searchParams.keys())
  for (const key of keys) if (TRACKING.test(key)) url.searchParams.delete(key)
  url.searchParams.sort()
  let path = url.pathname.replace(/\/amp\/?$/, '').replace(/\/+$/, '')
  if (!path) path = ''
  const query = url.searchParams.toString()
  return `${url.protocol === 'http:' ? 'https:' : url.protocol}//${url.hostname}${path}${query ? `?${query}` : ''}`
}

const STOP = new Set([
  'a',
  'an',
  'the',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'and',
  'or',
  'as',
  'is',
  'are',
  'with',
  'by',
  'from',
  'after',
  'over',
  'its',
  'it',
  'his',
  'her',
  'their',
])

export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[’']s\b/g, '')
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !STOP.has(t)),
  )
}

export function titleSimilarity(a: string, b: string): number {
  const ta = titleTokens(a)
  const tb = titleTokens(b)
  if (!ta.size || !tb.size) return 0
  let both = 0
  for (const t of ta) if (tb.has(t)) both++
  return both / (ta.size + tb.size - both)
}

export const DUPLICATE_SIMILARITY = 0.6

export type Covered = { title: string; canonicalUrl: string }

/** Why a candidate is a repeat of something already covered, or null when it is new. */
export function duplicateOf<T extends Covered>(
  candidate: { title: string; canonicalUrl: string },
  covered: T[],
): { match: T; by: 'url' | 'title'; similarity: number } | null {
  const url = canonicalUrl(candidate.canonicalUrl)
  for (const c of covered) if (c.canonicalUrl === url) return { match: c, by: 'url', similarity: 1 }
  let best: { match: T; similarity: number } | null = null
  for (const c of covered) {
    const similarity = titleSimilarity(candidate.title, c.title)
    if (similarity >= DUPLICATE_SIMILARITY && (!best || similarity > best.similarity))
      best = { match: c, similarity }
  }
  return best ? { ...best, by: 'title' } : null
}
