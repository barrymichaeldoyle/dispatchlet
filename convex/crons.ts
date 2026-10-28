import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

crons.daily('purge waitlist ips', { hourUTC: 3, minuteUTC: 0 }, internal.waitlist.purgeIps)
crons.hourly('poll post statuses', { minuteUTC: 17 }, internal.status.poll, {})
crons.daily('poll post metrics', { hourUTC: 4, minuteUTC: 30 }, internal.status.pollMetrics, {})

export default crons
