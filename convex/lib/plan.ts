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
  const end = start + PLAN_HORIZON_MS
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
