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
  it('fails visibly when confirmation email is not configured', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    const tc = convexTest(schema, modules)
    await expect(
      tc.action(internal.email.sendConfirm, { email: 'a@example.com', token: 'test' }),
    ).rejects.toThrow('RESEND_API_KEY is not set')
  })

  it('leaves launch recipients eligible when email cannot be sent', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    const tc = convexTest(schema, modules)
    const { token } = await tc.mutation(internal.waitlist.add, {
      email: 'a@example.com',
      source: 'direct',
    })
    await tc.mutation(internal.waitlist.confirm, { token })
    await expect(tc.action(internal.email.sendLaunch, {})).rejects.toThrow('RESEND_API_KEY')
    const batch = await tc.query(internal.waitlist.nextLaunchBatch, { limit: 50 })
    expect(batch).toHaveLength(1)
  })

  it('does not mark a failed delivery as sent', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unavailable', { status: 503 })))
    const tc = convexTest(schema, modules)
    const { token } = await tc.mutation(internal.waitlist.add, {
      email: 'a@example.com',
      source: 'direct',
    })
    await tc.mutation(internal.waitlist.confirm, { token })
    await expect(tc.action(internal.email.sendLaunch, {})).rejects.toThrow('503')
    expect(await tc.query(internal.waitlist.nextLaunchBatch, { limit: 50 })).toHaveLength(1)
  })
})
