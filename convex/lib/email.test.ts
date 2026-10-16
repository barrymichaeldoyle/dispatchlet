import { describe, expect, it } from 'vitest'
import { isValidEmail, normalizeEmail } from './email'

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Sam@Example.COM ')).toBe('sam@example.com')
  })
})

describe('isValidEmail', () => {
  it('accepts ordinary addresses', () => {
    expect(isValidEmail('sam@example.com')).toBe(true)
    expect(isValidEmail('first.last+tag@sub.example.co.uk')).toBe(true)
  })

  it('rejects addresses without a domain or with spaces', () => {
    expect(isValidEmail('sam')).toBe(false)
    expect(isValidEmail('sam@')).toBe(false)
    expect(isValidEmail('sam @example.com')).toBe(false)
    expect(isValidEmail('sam@example')).toBe(false)
  })
})
