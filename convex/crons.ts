import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

crons.daily('purge waitlist ips', { hourUTC: 3, minuteUTC: 0 }, internal.waitlist.purgeIps)

export default crons
