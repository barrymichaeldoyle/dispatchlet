import { describe, expect, test } from 'vitest'
import { environmentFor, isLocalHost, isStaleBuildError, withoutQuery } from './errors'

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

  test('skip the missing files of an old build, which a reload fixes', () => {
    expect(
      isStaleBuildError(
        new TypeError(
          'Failed to fetch dynamically imported module: https://dispatchlet.com/assets/app-CBK65lTy.js',
        ),
      ),
    ).toBe(true)
    expect(isStaleBuildError(new TypeError('error loading dynamically imported module'))).toBe(true)
    expect(isStaleBuildError('Importing a module script failed.')).toBe(true)
    expect(
      isStaleBuildError(new TypeError("Cannot read properties of undefined (reading 'some')")),
    ).toBe(false)
    expect(isStaleBuildError(undefined)).toBe(false)
  })
})
