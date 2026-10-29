/** The free allowance: runs and dry runs per account until the person adds their own key. */

const num = (name: string, fallback: number) => {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback
}

export type Allowance = {
  ownKey: boolean
  runsLeft: number | null
  dryRunsLeft: number | null
}

export function allowanceFor(user: {
  anthropicKeyEnc?: string
  freeRunsUsed?: number
  freeDryRunsUsed?: number
}): Allowance {
  if (user.anthropicKeyEnc) return { ownKey: true, runsLeft: null, dryRunsLeft: null }
  return {
    ownKey: false,
    runsLeft: Math.max(0, num('FREE_RUNS_PER_USER', 10) - (user.freeRunsUsed ?? 0)),
    dryRunsLeft: Math.max(0, num('FREE_DRY_RUNS_PER_USER', 3) - (user.freeDryRunsUsed ?? 0)),
  }
}

/** Live automations per account, and playbooks written a day on Dispatchlet's key. */
export function automationCap(): number {
  return num('AUTOMATIONS_PER_USER', 10)
}
export function generationsPerDay(): number {
  return num('GENERATIONS_PER_DAY', 10)
}

/** The most a day of runs may cost across every account, before scheduled runs are skipped. */
export function globalDailyCapUsd(): number {
  return num('GLOBAL_DAILY_USD_CAP', 15)
}
