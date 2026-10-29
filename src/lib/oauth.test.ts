import { describe, expect, it } from 'vitest'
import { apiTokenOwner, consentUrl, grantedScopes, providerOrigin } from './oauth'

describe('OAuth helpers', () => {
  it('runs the provider only on dispatchlet.com and localhost', () => {
    expect(providerOrigin(new URL('https://dispatchlet.com/mcp'))).toBe('https://dispatchlet.com')
    expect(providerOrigin(new URL('http://localhost:3131/mcp'))).toBe('http://localhost:3131')
    expect(providerOrigin(new URL('https://dispatchlet.barrydoyle18.workers.dev/mcp'))).toBeNull()
    expect(providerOrigin(new URL('http://dispatchlet.com/mcp'))).toBeNull()
  })

  it('carries what the consent page shows, encoded', () => {
    const url = new URL(
      consentUrl('https://dispatchlet.com', {
        handle: 'h1',
        clientName: 'Claude <script>',
        redirectHost: 'claude.ai',
        redirectIsLoopback: false,
        scope: ['read', 'write'],
      }),
    )
    expect(url.pathname).toBe('/oauth/consent')
    expect(url.searchParams.get('client')).toBe('Claude <script>')
    expect(url.searchParams.get('scope')).toBe('read write')
    expect(url.searchParams.has('loopback')).toBe(false)
  })

  it('grants read with write', () => {
    expect(grantedScopes(true)).toEqual(['read', 'write'])
    expect(grantedScopes(false)).toEqual(['read'])
  })

  it('checks a token with the API', async () => {
    const ok = (async () => Response.json({ id: 'u1' })) as unknown as typeof fetch
    const no = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch
    expect(await apiTokenOwner('https://x/v1', 'dl_a', ok)).toBe('u1')
    expect(await apiTokenOwner('https://x/v1', 'dl_a', no)).toBeNull()
  })
})
