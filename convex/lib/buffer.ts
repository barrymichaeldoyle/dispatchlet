const BUFFER_API = 'https://api.buffer.com'
const BUFFER_TOKEN_URL = 'https://auth.buffer.com/token'

export type BufferAccount = { id: string; email: string | null; name: string | null }

export type TokenSet = {
  accessToken: string
  refreshToken: string | null
  expiresAt: number
  scope: string
}

/** A GraphQL call with a Buffer access token. Throws with Buffer's message on any error. */
export async function bufferGraphql<T>(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(BUFFER_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const body = (await response.json().catch(() => null)) as {
    data?: T
    errors?: { message: string }[]
  } | null
  if (!response.ok || !body?.data || body.errors?.length) {
    const message = body?.errors?.[0]?.message ?? `HTTP ${response.status}`
    throw new BufferApiError(message, response.status)
  }
  return body.data
}

export class BufferApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
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
