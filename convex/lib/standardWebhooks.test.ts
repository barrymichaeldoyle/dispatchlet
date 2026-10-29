import { describe, expect, it } from 'vitest'
import {
  envelope,
  generateWebhookSecret,
  signWebhook,
  verifyWebhook,
  webhookUrlProblem,
} from './standardWebhooks'

describe('Standard Webhooks signing', () => {
  // The example from the Standard Webhooks spec, so any library verifies what we send.
  const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'
  const id = 'msg_p5jXN8AQM9LWM0D4loKWxJek'
  const timestamp = 1614265330
  const body = '{"test": 2432232314}'

  it('matches the specification vector', async () => {
    expect(await signWebhook(secret, id, timestamp, body)).toBe(
      'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
    )
  })

  it('verifies what it signed, within five minutes', async () => {
    const now = timestamp * 1000 + 60_000
    const signature = await signWebhook(secret, id, timestamp, body)
    const headers = { id, timestamp: String(timestamp), signature }
    expect(await verifyWebhook(secret, headers, body, now)).toBe(true)
    expect(await verifyWebhook(secret, headers, `${body} `, now)).toBe(false)
    expect(await verifyWebhook(secret, headers, body, now + 3_600_000)).toBe(false)
    expect(
      await verifyWebhook(secret, { ...headers, signature: `v1,abc ${signature}` }, body, now),
    ).toBe(true)
    expect(await verifyWebhook('whsec_other', headers, body, now)).toBe(false)
  })

  it('makes a whsec_ secret of 24 bytes and a stable envelope', () => {
    const s = generateWebhookSecret()
    expect(s.startsWith('whsec_')).toBe(true)
    expect(atob(s.slice(6))).toHaveLength(24)
    expect(JSON.parse(envelope('d1', 'ping', 5, { a: 1 }))).toEqual({
      id: 'd1',
      type: 'ping',
      createdAt: 5,
      data: { a: 1 },
    })
  })
})

describe('webhook URL checks', () => {
  it('allows public https and refuses the rest', () => {
    expect(webhookUrlProblem('https://hooks.zapier.com/hooks/catch/1/2')).toBeNull()
    expect(webhookUrlProblem('https://203.0.113.4/x')).toBeNull()
    expect(webhookUrlProblem('http://hooks.zapier.com/x')).toMatch(/https/)
    expect(webhookUrlProblem('https://localhost/x')).toMatch(/not reachable/)
    expect(webhookUrlProblem('https://10.0.0.5/x')).toMatch(/private/)
    expect(webhookUrlProblem('https://172.20.1.1/x')).toMatch(/private/)
    expect(webhookUrlProblem('https://192.168.1.1/x')).toMatch(/private/)
    expect(webhookUrlProblem('https://169.254.169.254/latest')).toMatch(/private/)
    expect(webhookUrlProblem('https://[::1]/x')).toMatch(/private/)
    expect(webhookUrlProblem('https://user:pw@example.com/x')).toMatch(/credentials/)
    expect(webhookUrlProblem('https://intranet/x')).toMatch(/full host/)
    expect(webhookUrlProblem('nope')).toMatch(/not a URL/)
  })
})
