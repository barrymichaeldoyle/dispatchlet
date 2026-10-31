import { describe, expect, test } from 'vitest'
import { environmentFor, isLocalHost, withoutQuery } from './errors'

describe('browser error reports', () => {
  test('tell production from everything else', () => {
    expect(environmentFor('dispatchlet.com')).toBe('production')
    expect(environmentFor('localhost')).toBe('development')
    expect(environmentFor('dispatchlet.barrydoyle18.workers.dev')).toBe('development')
  })

  test('are never sent from a local dev server', () => {
    expect(isLocalHost('localhost')).toBe(true)
    expect(isLocalHost('127.0.0.1')).toBe(true)
    expect(isLocalHost('dispatchlet.com')).toBe(false)
    expect(isLocalHost('dispatchlet.barrydoyle18.workers.dev')).toBe(false)
  })

  test('never carry a query or fragment, where tokens live', () => {
    expect(withoutQuery('https://dispatchlet.com/oauth/consent?handle=abc#x')).toBe(
      'https://dispatchlet.com/oauth/consent',
    )
    expect(withoutQuery('https://dispatchlet.com/app')).toBe('https://dispatchlet.com/app')
  })
})
