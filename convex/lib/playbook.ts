import { z } from 'zod'
import { SERVICES, type Service } from './ai/setup'

/**
 * The editorial half of an automation: what to watch, what counts, how to write. The schedule,
 * channels, story count and posting mode are answers to the setup questions and live on the
 * automation itself, so there is one place for each setting.
 *
 * The text view (renderPlaybook / parsePlaybook) is a deterministic round trip of this shape.
 */
export const PlaybookSource = z.object({
  label: z.string().describe('The site or publisher as a person would name it'),
  url: z
    .string()
    .nullable()
    .describe('A page to open on every run, or null when unsure of the exact URL'),
  note: z.string().describe('What this source is good for, one short sentence or empty'),
  priority: z.enum(['high', 'normal']),
})

export const PlaybookFormat = z.object({
  service: z.enum(SERVICES),
  style: z.string().describe('How a post reads on this channel, one or two sentences'),
  maxLength: z
    .number()
    .int()
    .nullable()
    .describe('A tighter limit than the service allows, or null'),
  thread: z.boolean().describe('Whether a story may become a thread here'),
  linkBack: z.string().nullable().describe('Where the link goes and how it is introduced, or null'),
})

export const Playbook = z.object({
  name: z.string().max(60),
  about: z.string().describe('The beat and its readers, one paragraph'),
  sources: z.array(PlaybookSource),
  searchQueries: z.array(z.string()).describe('Concrete web searches to run'),
  freshnessHours: z
    .number()
    .int()
    .min(6)
    .max(24 * 14),
  include: z.array(z.string()).describe('What counts as worth posting, one sentence each'),
  exclude: z.array(z.string()).describe('What to skip, one sentence each'),
  voice: z.object({
    tone: z.string(),
    notes: z.string().describe('Anything else about how it should sound, or empty'),
    avoidSaying: z.array(z.string()),
    emoji: z.enum(['none', 'light', 'free']),
    hashtags: z.enum(['none', 'few', 'many']),
  }),
  formats: z.array(PlaybookFormat),
})
export type Playbook = z.infer<typeof Playbook>

export const SERVICE_NAMES: Record<Service, string> = {
  twitter: 'X',
  linkedin: 'LinkedIn',
  threads: 'Threads',
  bluesky: 'Bluesky',
  mastodon: 'Mastodon',
}
const SERVICE_BY_NAME = Object.fromEntries(
  (Object.entries(SERVICE_NAMES) as [Service, string][]).map(([s, n]) => [n.toLowerCase(), s]),
) as Record<string, Service>

const SECTIONS = ['About', 'Sources', 'Searches', 'Post about', 'Skip', 'Tone', 'Formats'] as const
type Section = (typeof SECTIONS)[number]

const freshnessLine = (hours: number) =>
  hours % 24 === 0
    ? `Only stories from the last ${hours / 24 === 1 ? 'day' : `${hours / 24} days`}.`
    : `Only stories from the last ${hours} hours.`

/** The playbook as the text the user edits. Deterministic: the same playbook gives the same text. */
export function renderPlaybook(p: Playbook): string {
  const out: string[] = [`# ${p.name}`, '', '## About', p.about, '']
  out.push('## Sources')
  for (const s of p.sources) {
    const parts = [s.url ? s.url.replace(/^https?:\/\//, '') : s.label]
    if (s.note) parts.push(s.note)
    out.push(`${parts.join(', ')}${s.priority === 'high' ? ' Check first.' : ''}`)
  }
  out.push('', '## Searches')
  for (const q of p.searchQueries) out.push(`Search the web for "${q}".`)
  out.push('', '## Post about')
  out.push(freshnessLine(p.freshnessHours))
  for (const i of p.include) out.push(i)
  out.push('', '## Skip')
  for (const e of p.exclude) out.push(e)
  out.push('', '## Tone')
  out.push(p.voice.tone)
  if (p.voice.notes) out.push(p.voice.notes)
  if (p.voice.avoidSaying.length) out.push(`Avoid saying: ${p.voice.avoidSaying.join(', ')}.`)
  out.push(`Emoji: ${p.voice.emoji}. Hashtags: ${p.voice.hashtags}.`)
  out.push('', '## Formats')
  for (const f of p.formats) {
    const bits = [f.style]
    if (f.maxLength) bits.push(`Up to ${f.maxLength} characters.`)
    if (f.thread) bits.push('A thread when the story needs one.')
    if (f.linkBack) bits.push(`Link: ${f.linkBack}`)
    out.push(`${SERVICE_NAMES[f.service]}: ${bits.join(' ')}`)
  }
  return out.join('\n').trimEnd() + '\n'
}

export type ParseResult =
  | { ok: true; playbook: Playbook }
  | { ok: false; line: number; message: string }

const sentences = (lines: string[]) => lines.map((l) => l.trim()).filter(Boolean)

function parseSource(line: string): Playbook['sources'][number] {
  let priority: 'high' | 'normal' = 'normal'
  let rest = line.trim()
  if (/check first\.?$/i.test(rest)) {
    priority = 'high'
    rest = rest.replace(/\s*check first\.?$/i, '').trim()
  }
  const parts = rest
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const first = parts[0] ?? ''
  const isUrl = /^(https?:\/\/|[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$))/i.test(first)
  if (isUrl) {
    const url = first.includes('://') ? first : `https://${first}`
    const label = first
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]!
    return { label, url, note: parts.slice(1).join(', '), priority }
  }
  return { label: first, url: null, note: parts.slice(1).join(', '), priority }
}

function parseFreshness(text: string): number | null {
  const m = text.match(/last (\d+|a|one) (hour|day|week)s?/i)
  if (!m) return text.includes('last day') ? 24 : null
  const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : 1
  const unit = m[2]!.toLowerCase()
  return n * (unit === 'hour' ? 1 : unit === 'day' ? 24 : 24 * 7)
}

/**
 * Reads the text back into a playbook. The first problem stops the parse and names its line, so
 * the editor can say "Line 14: format not understood." and keep the last good version.
 */
export function parsePlaybook(text: string): ParseResult {
  const lines = text.split(/\r?\n/)
  const fail = (line: number, message: string): ParseResult => ({ ok: false, line, message })
  const first = lines.findIndex((l) => l.trim())
  if (first < 0 || !lines[first]!.startsWith('# '))
    return fail(first + 1 || 1, 'Start with "# " and a name.')
  const name = lines[first]!.slice(2).trim()
  if (!name || name.length > 60) return fail(first + 1, 'The name must be 1 to 60 characters.')
  const body: Record<Section, string[]> = {
    About: [],
    Sources: [],
    Searches: [],
    'Post about': [],
    Skip: [],
    Tone: [],
    Formats: [],
  }
  let current: Section | null = null
  for (let i = first + 1; i < lines.length; i++) {
    const line = lines[i]!
    if (line.startsWith('## ')) {
      const heading = line.slice(3).trim()
      const known = SECTIONS.find((s) => s.toLowerCase() === heading.toLowerCase())
      if (!known) return fail(i + 1, `Unknown section "${heading}". Use ${SECTIONS.join(', ')}.`)
      current = known
      continue
    }
    if (line.startsWith('#')) return fail(i + 1, 'Only "## " headings are allowed after the name.')
    if (!line.trim()) continue
    if (!current) return fail(i + 1, 'Put this under a "## " heading.')
    body[current].push(line)
  }
  const about = sentences(body.About).join(' ')
  const sources = sentences(body.Sources).map(parseSource)
  const searchQueries: string[] = []
  for (const l of sentences(body.Searches)) {
    const m = l.match(/^search the web for ["“](.+?)["”]\.?$/i)
    if (!m) return fail(lines.indexOf(l) + 1, 'Write searches as: Search the web for "query".')
    searchQueries.push(m[1]!)
  }
  let freshnessHours = 48
  const include: string[] = []
  for (const l of sentences(body['Post about'])) {
    const hours = /^only stories from the last/i.test(l) ? parseFreshness(l) : null
    if (hours) freshnessHours = hours
    else include.push(l)
  }
  const exclude = sentences(body.Skip)
  const toneLines = sentences(body.Tone)
  const avoidSaying: string[] = []
  let emoji: Playbook['voice']['emoji'] = 'none'
  let hashtags: Playbook['voice']['hashtags'] = 'none'
  const prose: string[] = []
  for (const l of toneLines) {
    const avoid = l.match(/^avoid saying:\s*(.+?)\.?$/i)
    const style = l.match(/^emoji:\s*(none|light|free)\.\s*hashtags:\s*(none|few|many)\.?$/i)
    if (avoid)
      avoidSaying.push(
        ...avoid[1]!
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
    else if (style) {
      emoji = style[1]!.toLowerCase() as typeof emoji
      hashtags = style[2]!.toLowerCase() as typeof hashtags
    } else prose.push(l)
  }
  const formats: Playbook['formats'] = []
  for (const l of sentences(body.Formats)) {
    const m = l.match(/^([A-Za-z]+):\s*(.*)$/)
    const service = m ? SERVICE_BY_NAME[m[1]!.toLowerCase()] : undefined
    if (!m || !service)
      return fail(
        lines.indexOf(l) + 1,
        'Start each format with X:, LinkedIn:, Threads:, Bluesky: or Mastodon:.',
      )
    let style = m[2]!
    const max = style.match(/\bup to (\d+) characters\.?/i)
    const maxLength = max ? Number(max[1]) : null
    if (max) style = style.replace(max[0], '').trim()
    const thread = /\bthread\b/i.test(style)
    style = style.replace(/\s*a thread when the story needs one\.?/i, '').trim()
    const link = style.match(/\blink:\s*(.+)$/i)
    const linkBack = link ? link[1]!.trim() : null
    if (link) style = style.replace(link[0], '').trim()
    formats.push({ service, style, maxLength, thread, linkBack })
  }
  const playbook: Playbook = {
    name,
    about,
    sources,
    searchQueries,
    freshnessHours,
    include,
    exclude,
    voice: { tone: prose[0] ?? '', notes: prose.slice(1).join(' '), avoidSaying, emoji, hashtags },
    formats,
  }
  const checked = Playbook.safeParse(playbook)
  if (!checked.success) return fail(1, checked.error.issues[0]?.message ?? 'Not a valid playbook.')
  return { ok: true, playbook: checked.data }
}
