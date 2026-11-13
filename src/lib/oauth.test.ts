import { describe, expect, it } from 'vitest'
import {
  apiTokenOwner,
  apiTokenRefused,
  consentUrl,
  grantScope,
  grantedScopes,
  providerOrigin,
  requestedWrite,
} from './oauth'

const status = (s: number) =>
  (async () => new Response('{}', { status: s })) as unknown as typeof fetch

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

  it('reads whether the client asked to write', () => {
    expect(requestedWrite('read write')).toBe(true)
    expect(requestedWrite('read')).toBe(false)
    expect(requestedWrite(null)).toBe(false)
    expect(requestedWrite(['write'])).toBe(true)
  })

  it('never grants more than the client asked for', () => {
    expect(grantScope(['read', 'write'], true)).toEqual(['read', 'write'])
    expect(grantScope(['read'], true)).toEqual(['read'])
    expect(grantScope(['read', 'write'], false)).toEqual(['read'])
    expect(grantScope([], true)).toEqual(['read'])
    expect(grantScope(['write'], true)).toEqual(['read', 'write'])
  })

  it('checks a token with the API', async () => {
    const ok = (async () =>
      Response.json({ id: 'u1', tokenScope: 'read' })) as unknown as typeof fetch
    const no = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch
    expect(await apiTokenOwner('https://x/v1', 'dl_a', ok)).toEqual({ userId: 'u1', write: false })
    expect(await apiTokenOwner('https://x/v1', 'dl_a', no)).toBeNull()
  })

  it('only calls a token refused when the API says so, not when it is busy or down', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    expect(await apiTokenRefused('https://x/v1', 'dl_a', status(200))).toBe(false)
    expect(await apiTokenRefused('https://x/v1', 'dl_a', status(401))).toBe(true)
    expect(await apiTokenRefused('https://x/v1', 'dl_a', status(403))).toBe(true)
    expect(await apiTokenRefused('https://x/v1', 'dl_a', status(429))).toBeNull()
    expect(await apiTokenRefused('https://x/v1', 'dl_a', status(503))).toBeNull()
    expect(await apiTokenRefused('https://x/v1', 'dl_a', down)).toBeNull()
  })
})
