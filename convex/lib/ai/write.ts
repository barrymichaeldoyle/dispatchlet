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
- Count characters. Each post, and each thread part, must fit the limit given for its channel. URLs count as written. When a story will not fit, cut words, not facts.
- Only state what is in the story's key facts and summary. Never add numbers, names, quotes or dates that are not there. Never speculate.
- Use a thread only on channels that allow one, and only when the story needs more than one post. Most do not.
- Put the link where the format says. On channels that show a link card, give a linkAttachment and keep the URL out of the text unless the format asks for it.
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
      `- channelId ${c.channelId}: ${SERVICE_NAMES[c.service]} (${c.name}). Limit ${limitFor(c, playbook)} characters.`,
      limits.threads && format?.thread ? 'Threads allowed.' : 'No threads.',
      limits.linkCard ? 'Shows a link card.' : 'No link card; the URL goes in the text.',
      c.service === 'twitter' ? 'A URL counts as 23 characters whatever its length.' : '',
    ].filter(Boolean)
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
      `   summary: ${s.summary}`,
      `   why it matters: ${s.whyItMatters}`,
      `   key facts: ${s.keyFacts.map((f) => `• ${f}`).join(' ')}`,
    )
  })
  lines.push('', `Write ${stories.length * channels.length} posts: every story for every channel.`)
  return lines.join('\n')
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
  return { ok: true, post }
}

/** A second, narrower ask for the posts that missed their limit: same posts, cut to fit. */
export function repairUserMessage(
  failed: { post: PostDraft; channel: TargetChannel; limit: number; reason: string }[],
): string {
  const lines = [
    'These posts did not pass. Rewrite each one so it does, keeping the facts and the link. Return only these posts, with the same storyUrl and channelId.',
    '',
  ]
  failed.forEach((f, i) => {
    lines.push(
      `${i + 1}. channelId ${f.channel.channelId} (${SERVICE_NAMES[f.channel.service]}), limit ${f.limit} characters${f.channel.service === 'twitter' ? ', a URL counts as 23' : ''}. Problem: ${f.reason}`,
      `   storyUrl: ${f.post.storyUrl}`,
      `   text: ${f.post.text}`,
      ...(f.post.thread?.length ? [`   thread: ${f.post.thread.join(' || ')}`] : []),
    )
  })
  return lines.join('\n')
}
