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

  it('sends a test copy of the launch email without marking anyone as sent', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const tc = convexTest(schema, modules)
    const { token } = await tc.mutation(internal.waitlist.add, {
      email: 'a@example.com',
      source: 'direct',
    })
    await tc.mutation(internal.waitlist.confirm, { token })
    await tc.action(internal.email.sendLaunchTest, { email: ' A@Example.com ' })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    const sent = JSON.parse(init.body)
    expect(sent.to).toBe('a@example.com')
    expect(sent.subject).toBe('Dispatchlet is open')
    expect(sent.text).toContain(`/waitlist/unsubscribe?token=${token}`)
    expect(await tc.query(internal.waitlist.nextLaunchBatch, { limit: 50 })).toHaveLength(1)
    await expect(
      tc.action(internal.email.sendLaunchTest, { email: 'b@example.com' }),
    ).rejects.toThrow('not on the waiting list')
  })
})

describe('the launch email', () => {
  it('says how to start, what is free and why it was sent, in both versions', async () => {
    const { launchMessage } = await import('./email')
    const message = launchMessage('a@example.com', 'tok')
    for (const body of [message.text, message.html]) {
      expect(body).toContain('Sign in with your Buffer account')
      expect(body).toContain('Your first 10 runs are on me.')
      expect(body).toContain('reply and tell me what broke')
      expect(body).not.toContain('/terms')
      expect(body).toContain('joined the Dispatchlet waiting list')
      expect(body).toContain('/waitlist/unsubscribe?token=tok')
    }
  })
})
