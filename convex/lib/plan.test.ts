import { describe, expect, it } from 'vitest'
import {
  datedSlots,
  datedTargets,
  describePlan,
  freeSlots,
  normalPlan,
  planProblem,
  planSlots,
  postingDates,
  type QueueSchedule,
  WEEKDAYS,
} from './plan'

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

  it('keeps the run’s own weekday a week on when the clocks go back during the week', () => {
    // Monday 19 Oct 10:00 in London (BST); the clocks go back on Sunday 25 Oct.
    const start = Date.parse('2026-10-19T09:00:00Z')
    const slots = planSlots(everyDay, 'Europe/London', start)
    expect(slots).toHaveLength(7)
    expect(local(slots[0]!, 'Europe/London')).toBe('Tue 20 Oct, 09:00')
    expect(local(slots[6]!, 'Europe/London')).toBe('Mon 26 Oct, 09:00')
  })

  it('stays seven slots when the clocks go forward during the week', () => {
    // Monday 23 Mar 2026 10:00 in London (GMT); the clocks go forward on Sunday 29 Mar.
    const start = Date.parse('2026-03-23T10:00:00Z')
    const slots = planSlots(everyDay, 'Europe/London', start)
    expect(slots).toHaveLength(7)
    expect(local(slots[6]!, 'Europe/London')).toBe('Mon 30 Mar, 09:00')
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

const JHB = 'Africa/Johannesburg'
const queue = (timezone = JHB, over: Partial<QueueSchedule> = {}): QueueSchedule => ({
  timezone,
  paused: false,
  days: WEEKDAYS.map((day) => ({
    day,
    times: day === 'sun' ? [] : ['11:10', '08:02'],
    paused: day === 'sat',
  })),
  ...over,
})
const hm = (at: number, zone = JHB) =>
  new Date(at).toLocaleString('en-GB', {
    timeZone: zone,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

describe('datedSlots', () => {
  it('uses the queue times of that weekday, in order', () => {
    // Thursday 12 November 2026.
    expect(datedSlots(queue(), '2026-11-12', JHB).map((at) => hm(at))).toEqual([
      '12 Nov, 08:02',
      '12 Nov, 11:10',
    ])
  })

  it('borrows the usual times on a paused or empty day, and has fallbacks with no queue', () => {
    expect(datedSlots(queue(), '2026-11-14', JHB).map((at) => hm(at))).toEqual([
      '14 Nov, 08:02',
      '14 Nov, 11:10',
    ])
    expect(datedSlots(null, '2026-11-14', JHB).map((at) => hm(at))).toEqual([
      '14 Nov, 09:00',
      '14 Nov, 12:00',
      '14 Nov, 15:00',
    ])
  })

  it('keeps the slots of a channel in another zone that fall on the account date', () => {
    // 23:30 in London is 01:30 the next day in Johannesburg.
    const late = queue('Europe/London', {
      days: WEEKDAYS.map((day) => ({ day, times: ['07:00', '23:30'], paused: false })),
    })
    expect(datedSlots(late, '2026-11-12', JHB).map((at) => hm(at))).toEqual([
      '12 Nov, 01:30',
      '12 Nov, 09:00',
    ])
  })
})

const at = (iso: string) => Date.parse(iso)

describe('postingDates', () => {
  it('targets today when a queue time is still ahead, otherwise tomorrow', () => {
    // Daily run at 06:00 local, next at 06:00 tomorrow.
    expect(
      postingDates([queue()], JHB, at('2026-11-12T04:30:00Z'), at('2026-11-13T04:30:00Z')),
    ).toEqual(['2026-11-12'])
    // Daily run at 20:00 local.
    expect(
      postingDates([queue()], JHB, at('2026-11-12T18:30:00Z'), at('2026-11-13T18:30:00Z')),
    ).toEqual(['2026-11-13'])
  })

  it('covers every posting day until the next weekly run', () => {
    expect(
      postingDates([null], JHB, at('2026-11-16T04:30:00Z'), at('2026-11-23T04:30:00Z')),
    ).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ])
  })
})

describe('datedTargets', () => {
  it('takes the next posting date when the next run would come first', () => {
    // 19:44 on Wednesday, next daily run at 08:00 tomorrow, first queue time 08:02.
    const from = at('2026-11-11T18:14:00Z')
    expect(datedTargets([queue()], JHB, from, at('2026-11-12T06:30:00Z'))).toEqual(['2026-11-12'])
    expect(datedTargets([queue()], JHB, from, null)).toEqual(['2026-11-12'])
  })
})
