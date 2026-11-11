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

/**
 * "Today, 09:00", "Tomorrow, 09:00", "Yesterday, 21:15", "Thu, 09:00" within the coming week,
 * then "15 Oct, 09:00". For the home page, where a date alone makes people count days.
 */
export function relativeWhen(at: number, timeZone: string, now = Date.now()): string {
  const time = timeIn(at, timeZone)
  const dayNumber = (t: number) => {
    const [y, m, d] = new Date(t)
      .toLocaleDateString('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .split('-')
      .map(Number)
    return Date.UTC(y!, m! - 1, d!) / 86_400_000
  }
  const days = dayNumber(at) - dayNumber(now)
  if (days === 0) return `Today, ${time}`
  if (days === 1) return `Tomorrow, ${time}`
  if (days === -1) return `Yesterday, ${time}`
  if (days > 1 && days < 7) {
    const weekday = new Date(at).toLocaleDateString('en-GB', { timeZone, weekday: 'short' })
    return `${weekday}, ${time}`
  }
  return `${dateIn(at, timeZone)}, ${time}`
}

/**
 * What "Save as drafts" can promise about email, from the person's notification settings. The
 * approve email only goes out for 'every' or 'drafts', and only with email on (runs.finish).
 */
export function draftEmailNote(prefs: string, emailEnabled: boolean): string {
  if (!emailEnabled)
    return 'Email is off in Settings, so drafts wait for you on Home and in Buffer.'
  if (prefs === 'problems' || prefs === 'never')
    return `Approval emails are off (notifications: ${prefs === 'never' ? 'never' : 'only problems'}), so drafts wait for you on Home and in Buffer.`
  return 'Each run that makes drafts emails you an approve link for each one.'
}

/** relativeWhen in the middle of a sentence: "for tomorrow, 09:00", "sent today, 09:02". */
export function relativeWhenInline(at: number, timeZone: string, now = Date.now()): string {
  const text = relativeWhen(at, timeZone, now)
  return /^(Today|Tomorrow|Yesterday)/.test(text)
    ? text.charAt(0).toLowerCase() + text.slice(1)
    : text
}

/** A time zone as people say it: "Johannesburg time" for Africa/Johannesburg. */
export function zoneName(timeZone: string): string {
  if (!timeZone.includes('/')) return timeZone
  return `${timeZone.split('/').at(-1)!.replaceAll('_', ' ')} time`
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

/**
 * One of Buffer's post metrics in words: "1,200 impressions", "4 reactions", "3.5% engagement
 * rate". Buffer names them in camelCase (engagementRate, totalTimeWatched); older ones use
 * snake_case.
 */
export function metricLabel(m: { type: string; value: number; unit?: string }): string {
  const words = m.type
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .toLowerCase()
  if (m.unit === 'percentage') return `${m.value.toLocaleString('en-GB')}% ${words}`
  return `${m.value.toLocaleString('en-GB')} ${words}`
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
 * The post in Buffer's web app: its own page at /posts/<id> when Buffer gave us an id and it
 * still exists there. Otherwise drafts open on Buffer's drafts tab and other posts on their
 * channel's tab.
 */
export function bufferChannelUrl(
  channelId: string,
  status: string,
  bufferPostId?: string | null,
): string {
  if (bufferPostId && status !== 'deleted')
    return `https://publish.buffer.com/posts/${encodeURIComponent(bufferPostId)}`
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
