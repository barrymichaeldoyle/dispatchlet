/**
 * OAuth for MCP clients that cannot take a pasted token, such as claude.ai connectors (SPEC §44.7).
 *
 * The provider issues its own access tokens. Each grant holds, encrypted in its props, a
 * Dispatchlet API token that the person made on the consent page; the MCP handler calls the API
 * with it. Revoking that token in settings ends the grant's access on the next call. Pasted
 * `dl_` tokens keep working on /mcp through `resolveExternalToken`.
 */

export type GrantProps = { apiToken: string; userId: string }

export const OAUTH_SCOPES = ['read', 'write'] as const

/** Hosts that run the OAuth provider: production and local dev. Others get bearer-only MCP. */
export function providerOrigin(url: URL): string | null {
  if (url.protocol === 'https:' && url.hostname === 'dispatchlet.com') return url.origin
  if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))
    return url.origin
  return null
}

/** The consent page's address, carrying what it must show. Everything here came from the client. */
export function consentUrl(
  origin: string,
  details: {
    handle: string
    clientName: string
    clientDomain?: string
    redirectHost: string
    redirectIsLoopback: boolean
    scope: string[]
  },
): string {
  const params = new URLSearchParams({
    handle: details.handle,
    client: details.clientName.slice(0, 120),
    redirect: details.redirectHost,
  })
  if (details.clientDomain) params.set('domain', details.clientDomain)
  if (details.redirectIsLoopback) params.set('loopback', '1')
  if (details.scope.length) params.set('scope', details.scope.join(' '))
  return `${origin}/oauth/consent?${params}`
}

/** The scopes to grant for what the person ticked: write includes read. */
export function grantedScopes(write: boolean): string[] {
  return write ? ['read', 'write'] : ['read']
}

/** Checks an API token against the API and returns whose it is, or null when it is not valid. */
export async function apiTokenOwner(
  apiBase: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const response = await fetchImpl(`${apiBase}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) return null
  const me = (await response.json()) as { id?: string }
  return typeof me.id === 'string' ? me.id : null
}
