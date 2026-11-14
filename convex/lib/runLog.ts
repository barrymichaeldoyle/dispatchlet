/**
 * What the run log says about the research step's own searches and page opens, in plain words.
 * The API's error codes (url_not_allowed, max_uses_exceeded) mean nothing to the person reading.
 */

/** One search or page open the research step made, with how it went once the result is in. */
export type ToolEvent = {
  tool: 'web_search' | 'web_fetch'
  /** The query, for a search; the URL, for a page open. */
  input: string
  /** The API's error code when it failed, else null. */
  error: string | null
}

/** Codes about a page itself, which say the source is a problem rather than this one attempt. */
export const SOURCE_FAILURES = new Set(['url_not_allowed', 'url_not_accessible'])

/** A URL as a person would say it: host and path, no scheme, no www, no trailing slash. */
export function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/$/, '')
    const short = `${u.hostname.replace(/^www\./, '')}${path}`
    return short.length > 70 ? `${short.slice(0, 67)}…` : short
  } catch {
    return url.length > 70 ? `${url.slice(0, 67)}…` : url
  }
}

/** The host of a URL without www, or null. */
export function hostOfUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** Pulls the query or URL out of a tool call's input, whatever shape the model gave it. */
export function toolInput(tool: string, input: unknown): string {
  const o = (input ?? {}) as { query?: unknown; url?: unknown }
  const value = tool === 'web_fetch' ? (o.url ?? o.query) : (o.query ?? o.url)
  return typeof value === 'string' ? value : ''
}

/** The log line for one search or page open, or null for a failure not worth a line. */
export function toolNote(e: ToolEvent): string | null {
  const what = e.tool === 'web_search' ? `“${e.input}”` : shortUrl(e.input)
  if (!e.error) return e.tool === 'web_search' ? `Searched ${what}.` : `Read ${what}.`
  switch (e.error) {
    case 'max_uses_exceeded':
      return e.tool === 'web_search'
        ? 'Used every search this run allows, so it stopped searching.'
        : 'Opened every page this run allows, so it stopped reading.'
    case 'url_not_allowed':
      return `Could not open ${what}: the site does not allow automated readers.`
    case 'url_not_accessible':
      return `Could not open ${what}: the page did not load.`
    case 'unsupported_content_type':
      return `Could not read ${what}: it is not a web page.`
    case 'too_many_requests':
      return `${e.tool === 'web_search' ? 'Search' : 'The site'} asked it to slow down, so it moved on.`
    // A guessed link, or a query passed as a URL: the model's slip, not something to fix.
    case 'url_not_in_prior_context':
    case 'invalid_input':
    case 'invalid_tool_input':
      return null
    default:
      return `A ${e.tool === 'web_search' ? 'search' : 'page open'} did not work, so it moved on.`
  }
}

/** Why a good story was left out because the run already had as many as the person set. */
export function limitReason(limit: number): string {
  return `Over your limit of ${limit} ${limit === 1 ? 'story' : 'stories'} a run.`
}
