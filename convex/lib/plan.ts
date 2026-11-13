import { instantOf, partsIn } from './schedule'

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type Weekday = (typeof WEEKDAYS)[number]

/**
 * When a planned batch publishes: one story per selected local day, at one local time, in the
 * account's time zone. Every selected channel gets that story's post at the same time.
 */
export type PublicationPlan = { time: string; weekdays: string[] }

/** The plan covers the seven days from the start of the run that prepares it. */
export const PLAN_HORIZON_DAYS = 7
export const PLAN_HORIZON_MS = PLAN_HORIZON_DAYS * 86_400_000
/** A slot needs this much time between sending to Buffer and its publication time. */
export const PLAN_LEAD_MS = 10 * 60_000
/** Slots counted when choosing how many stories a run keeps: research and writing take a while. */
export const PLAN_SELECTION_LEAD_MS = 30 * 60_000
export const MAX_PLANNED_STORIES = 7

const DAY_NAMES: Record<string, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
}

export function planProblem(plan: PublicationPlan): string | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(plan.time)) return 'Use a posting time like 09:00.'
  if (!plan.weekdays.length) return 'Choose at least one posting day.'
  if (new Set(plan.weekdays).size !== plan.weekdays.length) return 'Each posting day once.'
  if (!plan.weekdays.every((d) => (WEEKDAYS as readonly string[]).includes(d)))
    return 'Posting days are mon to sun.'
  return null
}

/** Weekdays in calendar order, so equal plans compare and display the same. */
export function normalPlan(plan: PublicationPlan): PublicationPlan {
  return {
    time: plan.time,
    weekdays: WEEKDAYS.filter((d) => plan.weekdays.includes(d)),
  }
}

/** "Every day at 09:00" or "Mon, Wed, Fri at 09:00". */
export function describePlan(plan: PublicationPlan): string {
  const days = normalPlan(plan).weekdays
  const which =
    days.length === 7
      ? 'Every day'
      : days.length === 5 && !days.includes('sat') && !days.includes('sun')
        ? 'Weekdays'
        : days.map((d) => DAY_NAMES[d]).join(', ')
  return `${which} at ${plan.time}`
}

/**
 * Every slot of the plan in [start, start + 7 days), ascending. Local wall-clock times are
 * converted per day, so a slot stays at 09:00 local across a daylight-saving change.
 */
export function planSlots(plan: PublicationPlan, zone: string, start: number): number[] {
  const [hh = 9, mm = 0] = plan.time.split(':').map(Number)
  const first = partsIn(zone, new Date(start))
  // A week of local days, not of hours: across a clock change, start + 7 × 24h falls an hour off
  // and would leave out (or let in) the slot on the run's own weekday.
  const end =
    instantOf(
      zone,
      first.year,
      first.month,
      first.day + PLAN_HORIZON_DAYS,
      first.hour,
      first.minute,
    ) +
    (start % 60_000)
  const slots: number[] = []
  // Eight local dates cover any seven-day window, whatever the start time of day.
  for (let offset = 0; offset <= PLAN_HORIZON_DAYS; offset++) {
    const day = new Date(Date.UTC(first.year, first.month - 1, first.day + offset))
    const at = instantOf(
      zone,
      day.getUTCFullYear(),
      day.getUTCMonth() + 1,
      day.getUTCDate(),
      hh,
      mm,
    )
    if (at < start || at >= end) continue
    if (!plan.weekdays.includes(partsIn(zone, new Date(at)).weekday)) continue
    slots.push(at)
  }
  return slots
}

/**
 * Slots a batch can still use: inside the run's horizon, far enough ahead to schedule, and not
 * already holding a post from this automation (an overlapping or earlier batch).
 */
export function freeSlots(
  plan: PublicationPlan,
  zone: string,
  horizonStart: number,
  now: number,
  occupied: Iterable<number>,
  lead = PLAN_LEAD_MS,
): number[] {
  const taken = new Set(occupied)
  return planSlots(plan, zone, horizonStart).filter((at) => at >= now + lead && !taken.has(at))
}

/** The local calendar date of an instant, YYYY-MM-DD. */
export function localDate(at: number, zone: string): string {
  const p = partsIn(zone, new Date(at))
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/**
 * A channel's Buffer queue: local posting times per weekday, in the channel's own zone. Dated
 * stories (on this day) outside a publication plan are scheduled at these times on their date.
 */
export type QueueSchedule = {
  timezone: string
  paused: boolean
  days: { day: string; times: string[]; paused: boolean }[]
}

/** Times used when a channel's queue is unknown or has no times at all. */
export const FALLBACK_POST_TIMES = ['09:00', '12:00', '15:00']

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

// oxlint-disable-next-line unicorn/no-array-sort -- filter returns a fresh array
const validTimes = (times: string[]) => times.filter((t) => TIME.test(t)).sort()

/** The local times a queue posts on one weekday; an empty or paused day borrows the queue's earliest day. */
function queueTimes(queue: QueueSchedule | null, weekday: string): string[] {
  if (!queue) return FALLBACK_POST_TIMES
  const own = queue.days.find((d) => d.day === weekday)
  if (own && !own.paused && validTimes(own.times).length) return validTimes(own.times)
  for (const day of WEEKDAYS) {
    const other = queue.days.find((d) => d.day === day)
    if (other && !other.paused && validTimes(other.times).length) return validTimes(other.times)
  }
  return FALLBACK_POST_TIMES
}

/**
 * The instants a channel posts on one local date of the account's zone, ascending. Never empty:
 * a day without queue times gets the channel's usual times, or the fallback times.
 */
export function datedSlots(queue: QueueSchedule | null, date: string, zone: string): number[] {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const channelZone = queue?.timezone || zone
  const out: number[] = []
  // The channel's zone may be a day ahead or behind the account's, so look one day either side.
  for (let offset = -1; offset <= 1; offset++) {
    const day = new Date(Date.UTC(y, m - 1, d + offset))
    const noon = instantOf(
      channelZone,
      day.getUTCFullYear(),
      day.getUTCMonth() + 1,
      day.getUTCDate(),
      12,
      0,
    )
    for (const time of queueTimes(queue, partsIn(channelZone, new Date(noon)).weekday)) {
      const [hh = 9, mm = 0] = time.split(':').map(Number)
      const at = instantOf(
        channelZone,
        day.getUTCFullYear(),
        day.getUTCMonth() + 1,
        day.getUTCDate(),
        hh,
        mm,
      )
      if (localDate(at, zone) === date) out.push(at)
    }
  }
  // oxlint-disable-next-line unicorn/no-array-sort -- a fresh copy
  return [...new Set(out)].sort((a, b) => a - b)
}

/**
 * The local dates whose posts this run prepares: every date with a posting time, on any channel,
 * in [from, to). `to` is the next run's own start, so consecutive runs never cover the same time.
 */
export function postingDates(
  queues: (QueueSchedule | null)[],
  zone: string,
  from: number,
  to: number,
): string[] {
  const channels = queues.length ? queues : [null]
  const first = partsIn(zone, new Date(from))
  const dates: string[] = []
  for (let offset = 0; offset <= Math.ceil((to - from) / 86_400_000) + 1; offset++) {
    const day = new Date(Date.UTC(first.year, first.month - 1, first.day + offset))
    const date = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}`
    const open = channels.some((q) => datedSlots(q, date, zone).some((at) => at >= from && at < to))
    if (open) dates.push(date)
  }
  return dates
}

/**
 * The dates an on-this-day run without a plan researches: those with a posting time before the
 * next scheduled run (null when none is booked). A run started by hand just before its own next
 * date, or on an automation that is not running on a schedule, takes the next posting date.
 */
export function datedTargets(
  queues: (QueueSchedule | null)[],
  zone: string,
  from: number,
  nextRun: number | null,
): string[] {
  const covered = nextRun === null ? [] : postingDates(queues, zone, from, nextRun)
  return covered.length
    ? covered
    : postingDates(queues, zone, from, from + PLAN_HORIZON_MS + 86_400_000).slice(0, 1)
}
