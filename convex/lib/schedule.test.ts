import { describe, expect, it } from 'vitest'
import { describeCadence, nextRunAt } from './schedule'

const JHB = 'Africa/Johannesburg'

describe('next run time', () => {
  it('runs later today when the time is still ahead', () => {
    const after = Date.UTC(2026, 9, 28, 5, 0) // 07:00 in Johannesburg
    const next = nextRunAt({ preset: 'daily', time: '08:00', weekday: null }, JHB, after)
    expect(new Date(next).toISOString()).toBe('2026-10-28T06:00:00.000Z')
  })

  it('runs tomorrow when the time has passed', () => {
    const after = Date.UTC(2026, 9, 28, 7, 0) // 09:00 in Johannesburg
    const next = nextRunAt({ preset: 'daily', time: '08:00', weekday: null }, JHB, after)
    expect(new Date(next).toISOString()).toBe('2026-10-29T06:00:00.000Z')
  })

  it('finds the next weekday for weekly runs', () => {
    const after = Date.UTC(2026, 9, 28, 12, 0) // a Wednesday
    const next = nextRunAt(
      { preset: 'weekly', time: '09:00', weekday: 'mon' },
      'Europe/London',
      after,
    )
    expect(new Date(next).toISOString()).toBe('2026-11-02T09:00:00.000Z')
  })

  it('keeps the local time across a clock change', () => {
    const after = Date.UTC(2026, 9, 24, 12, 0) // Saturday before UK clocks go back on 25 Oct
    const next = nextRunAt(
      { preset: 'daily', time: '08:00', weekday: null },
      'Europe/London',
      after,
    )
    expect(new Date(next).toISOString()).toBe('2026-10-25T08:00:00.000Z') // 08:00 GMT, not BST
  })

  it('describes itself', () => {
    expect(describeCadence({ preset: 'daily', time: '08:00', weekday: null })).toBe(
      'Daily at 08:00',
    )
    expect(describeCadence({ preset: 'weekly', time: '09:30', weekday: 'fri' })).toBe(
      'Fridays at 09:30',
    )
  })
})
