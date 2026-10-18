const BUFFER_API = 'https://api.buffer.com'
const BUFFER_TOKEN_URL = 'https://auth.buffer.com/token'
const BUFFER_REVOCATION_URL = 'https://auth.buffer.com/token/revocation'

export type BufferAccount = { id: string; email: string | null; name: string | null }

export type TokenSet = {
  accessToken: string
  refreshToken: string | null
  expiresAt: number
  scope: string
}

/**
 * Buffer's rate-limit headers from a response, as one line, or null if there are none. Logged on
 * every call so the real budget (250 calls a day per app client, possibly shared) is visible.
 */
export function rateLimitFrom(headers: Headers): string | null {
  const parts: string[] = []
  headers.forEach((value, name) => {
    if (/^(x-)?ratelimit/i.test(name)) parts.push(`${name}: ${value}`)
  })
  return parts.length ? parts.join('; ') : null
}

/** A GraphQL call with a Buffer access token, with the rate-limit headers Buffer sent back. */
export async function bufferRequest<T>(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<{ data: T; rateLimit: string | null }> {
  const response = await fetch(BUFFER_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const rateLimit = rateLimitFrom(response.headers)
  if (rateLimit) console.log(`Buffer rate limit: ${rateLimit}`)
  const body = (await response.json().catch(() => null)) as {
    data?: T
    errors?: { message: string }[]
  } | null
  if (!response.ok || !body?.data || body.errors?.length) {
    const message = body?.errors?.[0]?.message ?? `HTTP ${response.status}`
    throw new BufferApiError(message, response.status, rateLimit)
  }
  return { data: body.data, rateLimit }
}

/** A GraphQL call with a Buffer access token. Throws with Buffer's message on any error. */
export async function bufferGraphql<T>(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  return (await bufferRequest<T>(accessToken, query, variables)).data
}

export class BufferApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly rateLimit: string | null = null,
  ) {
    super(message)
  }
}

/**
 * The signed-in Buffer account: its ID, email and name, read with the access token from the same
 * sign-in. Returns null on any failure so the caller decides what that means.
 */
export async function fetchBufferAccount(accessToken: string): Promise<BufferAccount | null> {
  try {
    const data = await bufferGraphql<{
      account?: { id: string; email?: string | null; name?: string | null }
    }>(accessToken, 'query DispatchletSignIn { account { id email name } }')
    const account = data.account
    if (!account) return null
    return { id: account.id, email: account.email ?? null, name: account.name ?? null }
  } catch {
    return null
  }
}

/** When an access token should be treated as expired: two minutes early, so calls never race it. */
export function expiresAtFrom(expiresIn: unknown, now = Date.now()): number {
  const seconds = Number(expiresIn)
  return now + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000 - 120_000
}

/**
 * Exchanges a refresh token for a new pair. Buffer's refresh tokens are single-use: the old one
 * stops working the moment this succeeds, and reusing it revokes the whole grant. Only call this
 * while holding the connection's refresh lock.
 */
export async function refreshBufferTokens(refreshToken: string): Promise<TokenSet> {
  const response = await fetch(BUFFER_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.BUFFER_CLIENT_ID ?? '',
      client_secret: process.env.BUFFER_CLIENT_SECRET ?? '',
    }),
  })
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok || typeof body.access_token !== 'string') {
    throw new BufferApiError(String(body.error ?? `HTTP ${response.status}`), response.status)
  }
  return {
    accessToken: body.access_token,
    // Never fall back to the old token: it is spent, and reusing it would revoke the grant.
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    expiresAt: expiresAtFrom(body.expires_in),
    scope: typeof body.scope === 'string' ? body.scope : '',
  }
}

/**
 * Revokes a Buffer token (RFC 7009). Revoking the refresh token ends the whole grant, so the
 * user sees Dispatchlet removed from their Buffer account. Failures are reported, not thrown.
 */
export async function revokeBufferToken(
  token: string,
  hint: 'refresh_token' | 'access_token',
): Promise<boolean> {
  const response = await fetch(BUFFER_REVOCATION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      token,
      token_type_hint: hint,
      client_id: process.env.BUFFER_CLIENT_ID ?? '',
      client_secret: process.env.BUFFER_CLIENT_SECRET ?? '',
    }),
  }).catch(() => null)
  return response?.ok ?? false
}
