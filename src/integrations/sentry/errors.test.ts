import { describe, expect, test } from 'vitest'
import {
  environmentFor,
  isLocalHost,
  isOfflineSessionRenewal,
  isStaleBuildError,
  withoutQuery,
} from './errors'

/** A fetch that failed below HTTP, thrown from the given call site. */
const offline = (message: string, stack: string) =>
  Object.assign(new TypeError(message), { stack: `TypeError: ${message}\n${stack}` })

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

  test('skip a session renewal that could not reach the network', () => {
    const renewal = '    at Object.unauthenticatedCall (/assets/react-hMGrvkly.js:1:100)'
    expect(isOfflineSessionRenewal(offline('Failed to fetch', renewal))).toBe(true)
    expect(
      isOfflineSessionRenewal(offline('NetworkError when attempting to fetch resource.', renewal)),
    ).toBe(true)
    expect(isOfflineSessionRenewal(offline('Load failed', renewal))).toBe(true)
    // Our own fetches failing still report, and so does anything else the renewal throws.
    expect(
      isOfflineSessionRenewal(offline('Failed to fetch', '    at submit (/assets/app.js:1:5)')),
    ).toBe(false)
    expect(isOfflineSessionRenewal(new Error('InvalidRefreshToken'))).toBe(false)
    expect(isOfflineSessionRenewal(undefined)).toBe(false)
  })
})
