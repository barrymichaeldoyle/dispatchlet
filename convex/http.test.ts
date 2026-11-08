import { convexTest } from 'convex-test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import schema from './schema'

const modules = import.meta.glob('./**/*.*s')

beforeEach(() => {
  vi.stubEnv('SITE_URL', 'https://dispatchlet.com')
  vi.stubEnv('ALERTS_SECRET', '')
})

describe('pages served from the Convex origin', () => {
  it('carry locked-down security headers', async () => {
    const t = convexTest(schema, modules)
    const res = await t.fetch('/approve?token=nope')
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const csp = res.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("form-action 'self'")
    expect(csp).toMatch(/script-src 'nonce-[0-9a-f-]+'/)
    expect(await res.text()).not.toContain('onsubmit')
  })
})

describe('POST /alerts/errors', () => {
  it('is open when no secret is set', async () => {
    const t = convexTest(schema, modules)
    expect((await t.fetch('/alerts/errors', { method: 'POST' })).status).toBe(202)
  })

  it('needs the shared secret when one is set', async () => {
    vi.stubEnv('ALERTS_SECRET', 's3cret')
    const t = convexTest(schema, modules)
    expect((await t.fetch('/alerts/errors', { method: 'POST' })).status).toBe(401)
    const wrong = await t.fetch('/alerts/errors', {
      method: 'POST',
      headers: { 'X-Alerts-Secret': 's3cre' },
    })
    expect(wrong.status).toBe(401)
    expect(await t.run((ctx) => ctx.db.query('alertsSent').collect())).toHaveLength(0)
    const right = await t.fetch('/alerts/errors', {
      method: 'POST',
      headers: { 'X-Alerts-Secret': 's3cret' },
    })
    expect(right.status).toBe(202)
    expect(await t.run((ctx) => ctx.db.query('alertsSent').collect())).toHaveLength(1)
  })
})
