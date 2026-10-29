import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

crons.daily('purge waitlist ips', { hourUTC: 3, minuteUTC: 0 }, internal.waitlist.purgeIps)
crons.hourly('poll post statuses', { minuteUTC: 17 }, internal.status.poll, {})
crons.daily('poll post metrics', { hourUTC: 4, minuteUTC: 30 }, internal.status.pollMetrics, {})

crons.daily(
  'purge api tokens and rate windows',
  { hourUTC: 3, minuteUTC: 10 },
  internal.tokens.purge,
  {},
)
crons.daily('purge webhook deliveries', { hourUTC: 3, minuteUTC: 20 }, internal.webhooks.purge, {})

export default crons
