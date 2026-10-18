import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SECURITY_HEADERS } from './security-headers'

function staticHeaders(): Record<string, string> {
  const lines = readFileSync('public/_headers', 'utf8').split('\n')
  const headers: Record<string, string> = {}
  for (const line of lines) {
    const match = /^\s+([A-Za-z-]+):\s(.+)$/.exec(line)
    if (match) headers[match[1]] = match[2]
  }
  return headers
}

describe('security headers', () => {
  it('serves the same headers on prerendered pages as on Worker responses', () => {
    expect(staticHeaders()).toEqual(SECURITY_HEADERS)
  })

  it('stops the site being framed and limits where it can connect', () => {
    const csp = SECURITY_HEADERS['Content-Security-Policy']
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain('https://*.convex.site')
  })
})
