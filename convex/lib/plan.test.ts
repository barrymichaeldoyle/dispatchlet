import { describe, expect, it } from 'vitest'
import { describePlan, freeSlots, normalPlan, planProblem, planSlots, WEEKDAYS } from './plan'

const everyDay = { time: '09:00', weekdays: [...WEEKDAYS] }
const local = (at: number, zone: string) =>
  new Date(at).toLocaleString('en-GB', {
    timeZone: zone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

describe('planSlots', () => {
  it('gives seven daily slots when the run is before the posting time', () => {
    // Monday 07:00 in Johannesburg (UTC+2).
    const start = Date.parse('2026-11-16T05:00:00Z')
    const slots = planSlots(everyDay, 'Africa/Johannesburg', start)
    expect(slots.map((s) => local(s, 'Africa/Johannesburg'))).toEqual([
      'Mon 16 Nov, 09:00',
      'Tue 17 Nov, 09:00',
      'Wed 18 Nov, 09:00',
      'Thu 19 Nov, 09:00',
      'Fri 20 Nov, 09:00',
      'Sat 21 Nov, 09:00',
      'Sun 22 Nov, 09:00',
    ])
  })

  it('starts tomorrow and ends a week later when the run is after the posting time', () => {
    const start = Date.parse('2026-11-16T10:00:00Z') // Monday 12:00 local
    const slots = planSlots(everyDay, 'Africa/Johannesburg', start)
    expect(slots).toHaveLength(7)
    expect(local(slots[0]!, 'Africa/Johannesburg')).toBe('Tue 17 Nov, 09:00')
    expect(local(slots[6]!, 'Africa/Johannesburg')).toBe('Mon 23 Nov, 09:00')
  })

  it('keeps only the chosen weekdays', () => {
    const start = Date.parse('2026-11-16T05:00:00Z')
    const slots = planSlots(
      { time: '18:30', weekdays: ['mon', 'wed', 'fri'] },
      'Africa/Johannesburg',
      start,
    )
    expect(slots.map((s) => local(s, 'Africa/Johannesburg'))).toEqual([
      'Mon 16 Nov, 18:30',
      'Wed 18 Nov, 18:30',
      'Fri 20 Nov, 18:30',
    ])
  })

  it('stays at the local time across a daylight-saving change', () => {
    // Europe/London moves from BST to GMT on Sunday 25 October 2026.
    const start = Date.parse('2026-10-22T06:00:00Z') // Thursday 07:00 BST
    const slots = planSlots(everyDay, 'Europe/London', start)
    expect(slots.map((s) => local(s, 'Europe/London'))).toEqual([
      'Thu 22 Oct, 09:00',
      'Fri 23 Oct, 09:00',
      'Sat 24 Oct, 09:00',
      'Sun 25 Oct, 09:00',
      'Mon 26 Oct, 09:00',
      'Tue 27 Oct, 09:00',
      'Wed 28 Oct, 09:00',
    ])
    expect(new Date(slots[2]!).toISOString()).toBe('2026-10-24T08:00:00.000Z')
    expect(new Date(slots[3]!).toISOString()).toBe('2026-10-25T09:00:00.000Z')
  })

  it('is deterministic for the same input', () => {
    const start = Date.parse('2026-11-16T05:00:00Z')
    expect(planSlots(everyDay, 'America/New_York', start)).toEqual(
      planSlots(everyDay, 'America/New_York', start),
    )
  })
})

describe('freeSlots', () => {
  it('drops slots that are too close or already taken', () => {
    const start = Date.parse('2026-11-16T05:00:00Z')
    const all = planSlots(everyDay, 'Africa/Johannesburg', start)
    // 08:55 local on Monday: Monday's 09:00 slot is inside the lead time.
    const now = Date.parse('2026-11-16T06:55:00Z')
    const free = freeSlots(everyDay, 'Africa/Johannesburg', start, now, [all[2]!])
    expect(free).toEqual([all[1], all[3], all[4], all[5], all[6]])
  })
})

describe('plan validation and wording', () => {
  it('accepts sensible plans and normalises day order', () => {
    expect(planProblem({ time: '09:00', weekdays: ['fri', 'mon'] })).toBeNull()
    expect(normalPlan({ time: '09:00', weekdays: ['fri', 'mon'] }).weekdays).toEqual(['mon', 'fri'])
  })

  it('rejects bad times and days', () => {
    expect(planProblem({ time: '9am', weekdays: ['mon'] })).toMatch(/time/)
    expect(planProblem({ time: '24:00', weekdays: ['mon'] })).toMatch(/time/)
    expect(planProblem({ time: '09:00', weekdays: [] })).toMatch(/at least one/)
    expect(planProblem({ time: '09:00', weekdays: ['mon', 'mon'] })).toMatch(/once/)
    expect(planProblem({ time: '09:00', weekdays: ['funday'] })).toMatch(/mon to sun/)
  })

  it('describes plans briefly', () => {
    expect(describePlan(everyDay)).toBe('Every day at 09:00')
    expect(describePlan({ time: '08:15', weekdays: ['fri', 'tue', 'wed', 'thu', 'mon'] })).toBe(
      'Weekdays at 08:15',
    )
    expect(describePlan({ time: '18:00', weekdays: ['sat', 'mon'] })).toBe('Mon, Sat at 18:00')
  })
})
