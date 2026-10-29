/** JSON responses, errors and the small path matcher the API router uses (SPEC §44.3). */

export type RateHeaders = { limit: number; remaining: number; reset: number }

export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid'
  | 'conflict'
  | 'allowance'
  | 'rate_limited'
  | 'buffer'
  | 'unavailable'

export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
  'Access-Control-Max-Age': '86400',
}

function withRate(headers: Headers, rate?: RateHeaders) {
  if (!rate) return
  headers.set('X-RateLimit-Limit', String(rate.limit))
  headers.set('X-RateLimit-Remaining', String(rate.remaining))
  headers.set('X-RateLimit-Reset', String(rate.reset))
}

export function jsonResponse(
  status: number,
  body: unknown,
  opts: { rate?: RateHeaders; headers?: Record<string, string> } = {},
): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', ...CORS })
  withRate(headers, opts.rate)
  for (const [k, v] of Object.entries(opts.headers ?? {})) headers.set(k, v)
  return new Response(JSON.stringify(body), { status, headers })
}

export function textResponse(
  status: number,
  body: string,
  contentType: string,
  opts: { rate?: RateHeaders } = {},
): Response {
  const headers = new Headers({ 'Content-Type': contentType, ...CORS })
  withRate(headers, opts.rate)
  return new Response(body, { status, headers })
}

export function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  opts: { rate?: RateHeaders; field?: string; line?: number; retryAfter?: number } = {},
): Response {
  const error: Record<string, unknown> = { code, message }
  if (opts.field) error.field = opts.field
  if (opts.line !== undefined) error.line = opts.line
  return jsonResponse(
    status,
    { error },
    {
      rate: opts.rate,
      headers: opts.retryAfter ? { 'Retry-After': String(opts.retryAfter) } : undefined,
    },
  )
}

/** Thrown inside a route to end it with an API error. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    message: string,
    public field?: string,
  ) {
    super(message)
  }
}

/**
 * Turns an app error ("Automation not found", "No free runs left…") into the API's codes. The
 * app's messages are written for people, so they are passed through as the message.
 */
export function fromAppError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  const message = error instanceof Error ? error.message : String(error)
  // Convex wraps thrown errors; keep the part after its prefix.
  const text = message.replace(/^.*Uncaught Error:\s*/s, '').split('\n')[0] ?? message
  if (/not found/i.test(text)) return new ApiError(404, 'not_found', text)
  // A malformed id fails the function's `v.id()` validator; to the caller that is an unknown id.
  if (/Validator: v\.id\(|Expected ID for table/.test(message))
    return new ApiError(404, 'not_found', 'No such id.')
  if (/already going/i.test(text)) return new ApiError(409, 'conflict', text)
  if (/No (free |dry )?runs left/i.test(text)) return new ApiError(402, 'allowance', text)
  if (/Buffer/.test(text) && /did not|refused|lost|ended|Sign in with Buffer/i.test(text))
    return new ApiError(502, 'buffer', text)
  if (
    /not ready|Pick at least|Between 1 and 3|one short sentence|not a time zone|not one of/i.test(
      text,
    )
  )
    return new ApiError(400, 'invalid', text)
  if (/ArgumentValidationError|Validator error|does not match validator/i.test(message))
    return new ApiError(400, 'invalid', 'The request body does not match the schema.')
  return new ApiError(500, 'unavailable', 'Something went wrong on our side.')
}

export type Params = Record<string, string>

/** Matches "/automations/:id/runs" against a path, giving the named parts. */
export function matchPath(pattern: string, path: string): Params | null {
  const want = pattern.split('/').filter(Boolean)
  const have = path.split('/').filter(Boolean)
  if (want.length !== have.length) return null
  const params: Params = {}
  for (let i = 0; i < want.length; i++) {
    const w = want[i]!
    const h = have[i]!
    if (w.startsWith(':')) params[w.slice(1)] = decodeURIComponent(h)
    else if (w !== h) return null
  }
  return params
}

/** The JSON body as an object, or {} when there is none. Anything else is a 400. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get('content-type') ?? ''
  const raw = await req.text()
  if (!raw.trim()) return {}
  if (!type.includes('json') && !raw.trim().startsWith('{'))
    throw new ApiError(400, 'invalid', 'Send a JSON object body.')
  try {
    const value: unknown = JSON.parse(raw)
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      throw new ApiError(400, 'invalid', 'The body must be a JSON object.')
    return value as Record<string, unknown>
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(400, 'invalid', 'The body is not valid JSON.')
  }
}
