import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// Every 10 minutes, but it only calls Buffer for posts that can have changed (status.dueForCheck).
crons.interval('poll post statuses', { minutes: 10 }, internal.status.poll, {})
crons.daily('poll post metrics', { hourUTC: 4, minuteUTC: 30 }, internal.status.pollMetrics, {})

crons.daily(
  'purge api tokens and rate windows',
  { hourUTC: 3, minuteUTC: 10 },
  internal.tokens.purge,
  {},
)
crons.daily('purge webhook deliveries', { hourUTC: 3, minuteUTC: 20 }, internal.webhooks.purge, {})
crons.interval('close abandoned runs', { minutes: 10 }, internal.runs.sweepAbandoned, {})
// Emails the owner when one of the jobs above, or the run scheduler, has gone quiet (alerts.checkHealth).
crons.interval('check health', { hours: 6 }, internal.alerts.checkHealth, {})

export default crons
