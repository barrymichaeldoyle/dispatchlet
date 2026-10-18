import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAllowlisted, isSignupOpen } from './allowlist'

afterEach(() => vi.unstubAllEnvs())

describe('who gets in', () => {
  it('lets in only allowlisted accounts while sign-up is closed', () => {
    vi.stubEnv('ALLOWED_EMAILS', 'owner@example.com')
    vi.stubEnv('ALLOWED_BUFFER_IDS', 'abc123')
    vi.stubEnv('SIGNUP_OPEN', '')
    expect(isAllowlisted(null, 'Owner@Example.com')).toBe(true)
    expect(isAllowlisted('ABC123', null)).toBe(true)
    expect(isAllowlisted('other', 'someone@example.com')).toBe(false)
    expect(isSignupOpen()).toBe(false)
  })

  it('lets everyone in once SIGNUP_OPEN is true, and only then', () => {
    vi.stubEnv('SIGNUP_OPEN', 'yes')
    expect(isAllowlisted('other', 'someone@example.com')).toBe(false)
    vi.stubEnv('SIGNUP_OPEN', ' TRUE ')
    expect(isAllowlisted('other', 'someone@example.com')).toBe(true)
    expect(isAllowlisted(null, null)).toBe(true)
  })
})
