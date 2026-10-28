export type Cadence = {
  preset: 'daily' | 'weekly'
  /** Local time, HH:MM. */
  time: string
  /** mon to sun, for weekly. */
  weekday: string | null
}

/** The wall-clock parts of an instant in a zone. */
function partsIn(zone: string, at: Date) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  })
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]))
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: p.weekday!.toLowerCase().slice(0, 3),
  }
}

/** The instant of a local wall-clock time in a zone, found by correcting a UTC guess twice (DST). */
function instantOf(zone: string, y: number, m: number, d: number, hh: number, mm: number): number {
  let guess = Date.UTC(y, m - 1, d, hh, mm)
  for (let i = 0; i < 2; i++) {
    const p = partsIn(zone, new Date(guess))
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
    guess += Date.UTC(y, m - 1, d, hh, mm) - asUtc
  }
  return guess
}

/**
 * The next time this cadence fires after `after`, in the zone. Daily finds the next day whose
 * local time is still ahead; weekly the next matching weekday. DST is handled by the zone.
 */
export function nextRunAt(cadence: Cadence, zone: string, after = Date.now()): number {
  const [hh = 9, mm = 0] = cadence.time.split(':').map(Number)
  const start = partsIn(zone, new Date(after))
  for (let offset = 0; offset < 9; offset++) {
    const day = new Date(Date.UTC(start.year, start.month - 1, start.day + offset))
    const candidate = instantOf(
      zone,
      day.getUTCFullYear(),
      day.getUTCMonth() + 1,
      day.getUTCDate(),
      hh,
      mm,
    )
    if (candidate <= after) continue
    if (cadence.preset === 'weekly' && cadence.weekday) {
      if (partsIn(zone, new Date(candidate)).weekday !== cadence.weekday) continue
    }
    return candidate
  }
  throw new Error('No run time found')
}

/** "Daily at 08:00" or "Mondays at 09:00", for the UI and emails. */
export function describeCadence(cadence: Cadence): string {
  if (cadence.preset === 'daily') return `Daily at ${cadence.time}`
  const names: Record<string, string> = {
    mon: 'Mondays',
    tue: 'Tuesdays',
    wed: 'Wednesdays',
    thu: 'Thursdays',
    fri: 'Fridays',
    sat: 'Saturdays',
    sun: 'Sundays',
  }
  return `${names[cadence.weekday ?? 'mon']} at ${cadence.time}`
}

/** Runs a month at this cadence, sized for a 31-day month so a plan never runs short. */
export function runsPerMonth(cadence: Cadence): number {
  return cadence.preset === 'daily' ? 31 : 5
}
