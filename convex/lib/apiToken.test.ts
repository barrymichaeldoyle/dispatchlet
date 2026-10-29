import { describe, expect, it } from 'vitest'
import {
  bearerFrom,
  displayPrefix,
  generateSecret,
  hashSecret,
  HOOK_PREFIX,
  looksLikeSecret,
  TOKEN_PREFIX,
} from './apiToken'

describe('API tokens', () => {
  it('generates a dl_ token of 46 characters that only it recognises', () => {
    const token = generateSecret(TOKEN_PREFIX)
    expect(token).toHaveLength(46)
    expect(looksLikeSecret(token, TOKEN_PREFIX)).toBe(true)
    expect(looksLikeSecret(token, HOOK_PREFIX)).toBe(false)
    expect(looksLikeSecret('dl_short', TOKEN_PREFIX)).toBe(false)
    expect(looksLikeSecret(`${token}!`, TOKEN_PREFIX)).toBe(false)
    expect(generateSecret(TOKEN_PREFIX)).not.toBe(token)
  })

  it('hashes to a stable 64-character hex digest', async () => {
    expect(await hashSecret('dl_abc')).toBe(await hashSecret('dl_abc'))
    expect(await hashSecret('dl_abc')).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashSecret('dl_abc')).not.toBe(await hashSecret('dl_abd'))
  })

  it('shows the prefix and eight characters', () => {
    expect(displayPrefix('dl_ABCDEFGHIJKLMNOP', TOKEN_PREFIX)).toBe('dl_ABCDEFGH')
    expect(displayPrefix('dlh_ABCDEFGHIJKLMNOP', HOOK_PREFIX)).toBe('dlh_ABCDEFGH')
  })

  it('reads a bearer token from the header and nothing else', () => {
    expect(bearerFrom('Bearer dl_x')).toBe('dl_x')
    expect(bearerFrom('bearer dl_x')).toBe('dl_x')
    expect(bearerFrom('Basic abc')).toBeNull()
    expect(bearerFrom(null)).toBeNull()
    expect(bearerFrom('Bearer')).toBeNull()
  })
})
