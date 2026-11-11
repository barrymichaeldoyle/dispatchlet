import { convexTest } from 'convex-test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.*s')

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('email delivery', () => {
  it('fails visibly when email is not configured', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    const tc = convexTest(schema, modules)
    await expect(tc.action(internal.email.sendErrorAlert, {})).rejects.toThrow(
      'RESEND_API_KEY is not set',
    )
  })

  it('skips quietly on a local deployment', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('SITE_URL', 'http://localhost:3131')
    const tc = convexTest(schema, modules)
    await expect(tc.action(internal.email.sendErrorAlert, {})).resolves.toBeNull()
  })
})
