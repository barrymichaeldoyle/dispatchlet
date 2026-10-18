const BUFFER_API = 'https://api.buffer.com'

export type BufferAccount = { id: string; email: string | null; name: string | null }

/**
 * The signed-in Buffer account: its ID, email and name, read with the access token from the same
 * sign-in. Returns null on any failure so the caller decides what that means.
 */
export async function fetchBufferAccount(accessToken: string): Promise<BufferAccount | null> {
  try {
    const response = await fetch(BUFFER_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'query DispatchletSignIn { account { id email name } }' }),
    })
    if (!response.ok) return null
    const body = (await response.json()) as {
      data?: { account?: { id: string; email?: string | null; name?: string | null } }
    }
    const account = body.data?.account
    if (!account) return null
    return { id: account.id, email: account.email ?? null, name: account.name ?? null }
  } catch {
    return null
  }
}
