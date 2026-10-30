import { z } from 'zod'
import type { Playbook } from '../playbook'
import { SERVICE_NAMES } from '../playbook'
import type { Service } from './setup'
import type { Candidate } from './research'

/** What each service accepts. X is 280 unless the channel is Premium; Mastodon servers vary. */
export const SERVICE_LIMITS: Record<
  Service,
  { maxLength: number; threads: boolean; linkCard: boolean }
> = {
  twitter: { maxLength: 280, threads: true, linkCard: false },
  linkedin: { maxLength: 3000, threads: false, linkCard: true },
  threads: { maxLength: 500, threads: true, linkCard: true },
  bluesky: { maxLength: 300, threads: true, linkCard: true },
  mastodon: { maxLength: 500, threads: true, linkCard: false },
}

export type TargetChannel = {
  channelId: string
  service: Service
  name: string
  /** The channel's own limit when Buffer reports one (Premium X, a Mastodon server). */
  maxLength: number | null
}

export const PostDraft = z.object({
  storyUrl: z.string().describe("The story's canonicalUrl, exactly as given"),
  channelId: z.string().describe('The channel id, exactly as given'),
  text: z.string().describe('The post. For a thread, the first part.'),
  thread: z.array(z.string()).nullable().describe('The remaining parts of a thread, or null'),
  linkAttachment: z
    .object({ url: z.string(), title: z.string(), description: z.string() })
    .nullable()
    .describe('A link card for channels that show one, or null'),
})
export type PostDraft = z.infer<typeof PostDraft>

export const WriteResult = z.object({ posts: z.array(PostDraft) })
export type WriteResult = z.infer<typeof WriteResult>

export const WRITE_SYSTEM = `You are the writer of Dispatchlet, a scheduled agent that turns researched stories into social posts for the user's Buffer channels. Nobody edits what you write before it is saved, so it must be ready as it is.

Rules:
- Write one post per story per channel, in the voice and format the playbook gives for that channel.
- Count characters. Each post, and each thread part, must fit the limit given for its channel, and the brief gives a target below it: write to the target, not to the limit. A post that stops early is fine; one that runs over is thrown away. When a story will not fit, cut words, not facts.
- Only state what is in the story's key facts and summary. Never add numbers, names, quotes or dates that are not there. Never speculate.
- If you credit a source ("per X", "X reports", "according to X"), credit the outlet whose link goes with the post, given as "link outlet". Readers check the credit against the link. Name another outlet only alongside it, as in "Al Jazeera, citing Reuters", and only when the key facts say so.
- Use a thread only on channels that allow one, and only when the story needs more than one post. Most do not.
- Never put a URL in the text. On channels that show a link card, give a linkAttachment. On the others the story's link is added after your text by the system, and the limit you are given already allows for it.
- No hashtags unless the playbook allows them. No emoji unless the playbook allows them. No exclamation marks. Plain words. Never say "exciting", "game-changer", "heartwarming" or the like.
- Write every post, even when several stories go to the same channel.`

const URL_PATTERN = /https?:\/\/\S+/g
/** X wraps every link in t.co, so a URL counts as 23 characters there whatever its length. */
const X_LINK_LENGTH = 23

/** How many characters a service will count the text as. */
export function measuredLength(text: string, service: Service): number {
  if (service === 'twitter') return [...text.replace(URL_PATTERN, 'x'.repeat(X_LINK_LENGTH))].length
  return [...text].length
}

/** A link on X counts as 23 plus the blank line before it; other services count it as written. */
const LINK_ALLOWANCE = 2 + X_LINK_LENGTH

/** The limit for the writer's own text: the channel's, less room for the link the system adds. */
export function textLimitFor(channel: TargetChannel, playbook: Playbook): number {
  const limit = limitFor(channel, playbook)
  return SERVICE_LIMITS[channel.service].linkCard ? limit : limit - LINK_ALLOWANCE
}

/** What the writer aims for: well under the limit, since the models overshoot a target by about a tenth. */
export function targetFor(channel: TargetChannel, playbook: Playbook): number {
  return Math.max(80, Math.round(textLimitFor(channel, playbook) * 0.75))
}

/** Adds the story's link after the text on channels that have no link card, unless it is there. */
export function withLink(post: PostDraft, channel: TargetChannel): PostDraft {
  if (SERVICE_LIMITS[channel.service].linkCard) return post
  const parts = [post.text, ...(post.thread ?? [])]
  if (parts.some((p) => p.includes(post.storyUrl))) return post
  if (post.thread?.length)
    return {
      ...post,
      thread: [...post.thread.slice(0, -1), `${post.thread.at(-1)}\n\n${post.storyUrl}`],
    }
  return { ...post, text: `${post.text.trimEnd()}\n\n${post.storyUrl}` }
}

/** The limit a channel's posts must fit. The playbook may tighten it, never loosen it. */
export function limitFor(channel: TargetChannel, playbook: Playbook): number {
  const base = channel.maxLength ?? SERVICE_LIMITS[channel.service].maxLength
  const format = playbook.formats.find((f) => f.service === channel.service)
  return format?.maxLength ? Math.min(base, format.maxLength) : base
}

export function writeUserMessage(
  playbook: Playbook,
  stories: Candidate[],
  channels: TargetChannel[],
): string {
  const lines = [
    `Playbook: ${playbook.name}`,
    `About: ${playbook.about}`,
    '',
    'Voice:',
    playbook.voice.tone,
  ]
  if (playbook.voice.notes) lines.push(playbook.voice.notes)
  if (playbook.voice.avoidSaying.length)
    lines.push(`Never use these words: ${playbook.voice.avoidSaying.join(', ')}.`)
  lines.push(
    `Emoji: ${playbook.voice.emoji}. Hashtags: ${playbook.voice.hashtags}.`,
    '',
    'Channels:',
  )
  for (const c of channels) {
    const format = playbook.formats.find((f) => f.service === c.service)
    const limits = SERVICE_LIMITS[c.service]
    const bits = [
      `- channelId ${c.channelId}: ${SERVICE_NAMES[c.service]} (${c.name}). Your text may be ${textLimitFor(c, playbook)} characters at most; aim for ${targetFor(c, playbook)}.`,
      limits.threads && format?.thread ? 'Threads allowed.' : 'No threads.',
      limits.linkCard ? 'Shows a link card.' : 'No link card; the link is added after your text.',
    ]
    if (format?.style) bits.push(`Style: ${format.style}`)
    if (format?.linkBack) bits.push(`Link: ${format.linkBack}`)
    lines.push(bits.join(' '))
  }
  lines.push('', 'Stories:')
  stories.forEach((s, i) => {
    lines.push(
      `${i + 1}. ${s.title}`,
      `   canonicalUrl: ${s.canonicalUrl}`,
      `   source: ${s.source}, published ${s.publishedAt}`,
      `   link outlet: ${linkHost(s.canonicalUrl) ?? s.source}`,
      `   summary: ${s.summary}`,
      `   why it matters: ${s.whyItMatters}`,
      `   key facts: ${s.keyFacts.map((f) => `• ${f}`).join(' ')}`,
    )
  })
  lines.push('', `Write ${stories.length * channels.length} posts: every story for every channel.`)
  return lines.join('\n')
}

/** The host of a story's link without www, such as aljazeera.com, or null if it is not a URL. */
export function linkHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** Letters and digits only, lower-cased: "The Race" and the-race.com both become "therace". */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Second-level labels that are not the outlet's name, so bbc.co.uk compares as bbc. */
const NOT_A_NAME = new Set(['co', 'com', 'org', 'net', 'gov', 'ac'])

/** Names an outlet goes by that its domain does not spell. */
const ALIASES: Record<string, string[]> = {
  formula1: ['f1', 'formula1', 'formulaone'],
  apnews: ['ap', 'associatedpress'],
  nytimes: ['newyorktimes', 'nyt'],
  theguardian: ['guardian'],
  ft: ['financialtimes'],
  wsj: ['wallstreetjournal'],
}

/** Whether an outlet's name refers to the site at this host. */
export function nameMatchesHost(name: string, host: string): boolean {
  const n = squash(name.replace(/^the\s+/i, ''))
  if (!n) return true
  const labels = host.split('.').filter((l) => !NOT_A_NAME.has(l))
  const site = squash(labels.at(-2) ?? labels[0] ?? host)
  const whole = squash(host)
  const known = ALIASES[site] ?? []
  return (
    whole.includes(n) ||
    n.includes(site) ||
    site.includes(n) ||
    known.includes(n) ||
    known.some((a) => n.startsWith(a))
  )
}

/**
 * The outlets a post credits: "per X", "according to X", "X reports", "X reported", "via X".
 * Not "X said": that is how a post quotes a team or a driver, not an outlet.
 * X is a run of capitalised words (and digits, as in PlanetF1). Conservative on purpose: a false
 * match costs a rewrite.
 */
export function creditedOutlets(text: string): string[] {
  // A word may carry a domain ending (Motorsport.com) but a full stop ends the name.
  const word = String.raw`[\w&'-]*(?:\.[a-z]{2,})*`
  const name = String.raw`((?:The\s+)?[A-Z]${word}(?:\s+[A-Z0-9]${word}){0,3})`
  const patterns = [
    new RegExp(String.raw`\b(?:[Pp]er|[Aa]ccording to|[Vv]ia)\s+${name}`, 'g'),
    new RegExp(String.raw`${name}\s+(?:reports|reported)\b`, 'g'),
  ]
  const out: string[] = []
  for (const p of patterns) for (const m of text.matchAll(p)) out.push(m[1]!.replace(/[.,]$/, ''))
  return out
}

export type Checked = { ok: true; post: PostDraft } | { ok: false; post: PostDraft; reason: string }

/** The checks a post must pass before it reaches Buffer, with the reason the run log shows. */
export function checkPost(
  post: PostDraft,
  channel: TargetChannel,
  playbook: Playbook,
  storyUrls: Set<string>,
): Checked {
  const limit = limitFor(channel, playbook)
  const limits = SERVICE_LIMITS[channel.service]
  const format = playbook.formats.find((f) => f.service === channel.service)
  if (!storyUrls.has(post.storyUrl))
    return { ok: false, post, reason: 'The post is for a story that was not in the run.' }
  if (!post.text.trim()) return { ok: false, post, reason: 'The post was empty.' }
  const parts = [post.text, ...(post.thread ?? [])]
  const long = parts.find((p) => [...p].length > limit)
  if (long)
    return {
      ok: false,
      post,
      reason: `Too long for ${SERVICE_NAMES[channel.service]}: ${[...long].length} characters, the limit is ${limit}.`,
    }
  if (post.thread?.length && !(limits.threads && format?.thread))
    return { ok: false, post, reason: `Threads are not allowed on ${channel.name}.` }
  if (post.linkAttachment && !limits.linkCard)
    return { ok: true, post: { ...post, linkAttachment: null } }
  if (playbook.voice.hashtags === 'none' && /(^|\s)#\w/.test(parts.join(' ')))
    return { ok: false, post, reason: 'It used a hashtag and the playbook says none.' }
  // A credit that names an outlet must name the one whose link goes with the post.
  const host = linkHost(post.storyUrl)
  const credits = creditedOutlets(parts.map((p) => p.replace(URL_PATTERN, '')).join(' '))
  if (host && credits.length && !credits.some((c) => nameMatchesHost(c, host)))
    return {
      ok: false,
      post,
      reason: `It credits ${credits[0]} but the link is to ${host}. Credit the outlet of the link.`,
    }
  return { ok: true, post }
}

/** A second, narrower ask for the posts that missed their limit: same posts, cut to fit. */
export function repairUserMessage(
  failed: {
    post: PostDraft
    channel: TargetChannel
    limit: number
    reason: string
    over: number
  }[],
): string {
  const lines = [
    'These posts did not pass. Rewrite each one so it does, keeping the facts. Do not include a URL; the link is added after your text. Return only these posts, with the same storyUrl and channelId.',
    '',
  ]
  failed.forEach((f, i) => {
    lines.push(
      `${i + 1}. channelId ${f.channel.channelId} (${SERVICE_NAMES[f.channel.service]}). Your text may be ${f.limit} characters at most; write it in ${Math.min(Math.round(f.limit * 0.75), Math.max(80, f.limit - f.over - 40))} or fewer${f.over > 0 ? `, since this one is ${f.over} over` : ''}. Drop a sentence rather than trim words. Problem: ${f.reason}`,
      `   storyUrl: ${f.post.storyUrl}`,
      `   text: ${f.post.text}`,
      ...(f.post.thread?.length ? [`   thread: ${f.post.thread.join(' || ')}`] : []),
    )
  })
  return lines.join('\n')
}

/** Strips the link the system adds, so a post can go back to the writer as it wrote it. */
export function withoutLink(post: PostDraft): PostDraft {
  const escaped = post.storyUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const strip = (t: string) => t.replace(new RegExp(`\\s*${escaped}\\s*$`), '')
  return {
    ...post,
    text: strip(post.text),
    thread: post.thread ? post.thread.map(strip) : post.thread,
  }
}

/** How far a post's longest part is over its channel's limit, in characters, or 0. */
export function overBy(post: PostDraft, channel: TargetChannel, playbook: Playbook): number {
  const limit = limitFor(channel, playbook)
  return Math.max(
    0,
    ...[post.text, ...(post.thread ?? [])].map((p) => measuredLength(p, channel.service) - limit),
  )
}
