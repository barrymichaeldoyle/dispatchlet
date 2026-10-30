import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

crons.daily('purge waitlist ips', { hourUTC: 3, minuteUTC: 0 }, internal.waitlist.purgeIps)
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
crons.daily(
  'delete the closed waiting list',
  { hourUTC: 3, minuteUTC: 30 },
  internal.waitlist.purgeClosed,
  {},
)
crons.interval('close abandoned runs', { minutes: 10 }, internal.runs.sweepAbandoned, {})

export default crons
