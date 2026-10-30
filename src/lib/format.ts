/** Times as "08:31", dates as "15 Oct", in the automation's zone (SPEC §23.2). */

export function timeIn(at: number, timeZone: string): string {
  return new Date(at).toLocaleTimeString('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
}

function dateIn(at: number, timeZone: string): string {
  return new Date(at).toLocaleDateString('en-GB', { timeZone, day: 'numeric', month: 'short' })
}

/** "15 Oct at 08:31", or just the time when it is today. */
export function whenIn(at: number, timeZone: string, now = Date.now()): string {
  const sameDay = dateIn(at, timeZone) === dateIn(now, timeZone)
  return sameDay ? timeIn(at, timeZone) : `${dateIn(at, timeZone)} at ${timeIn(at, timeZone)}`
}

export function usd(amount: number): string {
  return amount < 0.01 && amount > 0 ? 'under $0.01' : `$${amount.toFixed(2)}`
}

const SERVICE_NAMES: Record<string, string> = {
  twitter: 'X',
  linkedin: 'LinkedIn',
  threads: 'Threads',
  bluesky: 'Bluesky',
  mastodon: 'Mastodon',
}

/** Networks Buffer supports that Dispatchlet cannot post to yet. */
const OTHER_SERVICE_NAMES: Record<string, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  pinterest: 'Pinterest',
  tiktok: 'TikTok',
  googlebusiness: 'Google Business Profile',
  youtube: 'YouTube',
  startPage: 'Start Page',
}

export function serviceName(service: string): string {
  return SERVICE_NAMES[service] ?? OTHER_SERVICE_NAMES[service] ?? service
}

/** "Instagram", "Instagram or TikTok", "Facebook, Instagram or TikTok". */
export function serviceList(services: string[]): string {
  const names = services.map(serviceName)
  if (names.length < 2) return names.join('')
  return `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`
}

/** Why Buffer will not let a channel be used, in words. */
export function channelProblem(problem: string | null): string {
  if (problem === 'disconnected') return 'Disconnected in Buffer. Reconnect it there, then sync.'
  if (problem === 'locked') return 'Locked in Buffer, usually by the plan’s channel limit.'
  return 'Needs attention in Buffer.'
}

export function errorText(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message.replace(/^.*Uncaught Error: /s, '') : fallback
}

/** Buffer's web app, at the channel's drafts or queue tab; the API gives no per-post page. */
export function bufferChannelUrl(channelId: string, status: string): string {
  const tab = status === 'draft' ? 'drafts' : status === 'sent' ? 'sent' : 'queue'
  return `https://publish.buffer.com/channel/${channelId}/tab/${tab}`
}
