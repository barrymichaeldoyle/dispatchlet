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

/** Why a channel cannot be used, in words. */
export function channelProblem(problem: string | null, service?: string): string {
  if (problem === 'unsupported')
    return `Dispatchlet can’t post to ${service ? serviceName(service) : 'this network'} yet.`
  if (problem === 'disconnected') return 'Disconnected in Buffer. Reconnect it there, then sync.'
  if (problem === 'locked') return 'Locked in Buffer, usually by the plan’s channel limit.'
  return 'Needs attention in Buffer.'
}

export function errorText(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message.replace(/^.*Uncaught Error: /s, '') : fallback
}

/**
 * Buffer's web app where the post is; the API gives no per-post page. Drafts open on Buffer's
 * drafts tab, which lists every channel's drafts; other posts open on their channel's tab.
 */
export function bufferChannelUrl(channelId: string, status: string): string {
  if (status === 'draft') return 'https://publish.buffer.com/schedule?tab=drafts'
  const tab = status === 'sent' ? 'sent' : 'queue'
  return `https://publish.buffer.com/channel/${channelId}/tab/${tab}`
}

/** The line under "Where should it post?", from what the channel sync found. */
export function channelHint({
  usable,
  blocked,
  others,
  syncing,
  syncError,
}: {
  usable: number
  blocked: number
  others: string[]
  syncing: boolean
  syncError: string | null
}): string {
  const othersLine = others.length ? `Dispatchlet can’t post to ${serviceList(others)} yet.` : ''
  if (usable)
    return `Text channels in your Buffer account. Pick as many as you like. ${othersLine}`.trim()
  if (syncing) return 'Reading your channels from Buffer.'
  if (syncError) return syncError
  if (blocked)
    return 'Buffer won’t let Dispatchlet use these channels yet. Fix them in Buffer, then sync again.'
  return `${othersLine} Connect X, LinkedIn, Threads, Bluesky or Mastodon in Buffer, then sync again.`.trim()
}

/** What a skipped story shows for Buffer Ideas: nothing, a reconnect note, the link, or done. */
export function ideaLinkState(
  saved: boolean,
  ideas: 'off' | 'reconnect' | 'ready',
): 'hidden' | 'reconnect' | 'save' | 'saved' {
  if (saved) return 'saved'
  if (ideas === 'off') return 'hidden'
  return ideas === 'reconnect' ? 'reconnect' : 'save'
}
