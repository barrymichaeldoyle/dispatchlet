import { convexTest } from 'convex-test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { internal } from './_generated/api'
import { ERROR_ALERT_GAP, ERROR_ALERTS_PER_DAY } from './alerts'
import schema from './schema'

const modules = import.meta.glob('./**/*.*s')

afterEach(() => vi.useRealTimers())

describe('error alerts', () => {
  it('sends at most one email every 10 minutes', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    expect(await t.mutation(internal.alerts.claimErrorAlert, {})).toBe(true)
    expect(await t.mutation(internal.alerts.claimErrorAlert, {})).toBe(false)
    vi.advanceTimersByTime(ERROR_ALERT_GAP + 1)
    expect(await t.mutation(internal.alerts.claimErrorAlert, {})).toBe(true)
  })

  it('stops after 20 in a day, and starts again the next day', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    for (let i = 0; i < ERROR_ALERTS_PER_DAY; i++) {
      expect(await t.mutation(internal.alerts.claimErrorAlert, {})).toBe(true)
      vi.advanceTimersByTime(ERROR_ALERT_GAP + 1)
    }
    expect(await t.mutation(internal.alerts.claimErrorAlert, {})).toBe(false)
    vi.advanceTimersByTime(24 * 60 * 60_000)
    expect(await t.mutation(internal.alerts.claimErrorAlert, {})).toBe(true)
  })

  it('the endpoint accepts any body and never echoes it into the email', async () => {
    const t = convexTest(schema, modules)
    const response = await t.fetch('/alerts/errors', {
      method: 'POST',
      body: JSON.stringify({ name: '<script>phish</script>' }),
    })
    expect(response.status).toBe(202)
    const { errorAlertMessage } = await import('./email')
    const message = errorAlertMessage('owner@example.com')
    expect(message.text).not.toContain('phish')
    expect(message.subject).toBe('New error on Dispatchlet')
  })
})
