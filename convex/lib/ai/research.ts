import { z } from 'zod'
import type { Playbook } from '../playbook'
import { hostOf, type SetupAnswers } from './setup'

/**
 * Everything the research step needs to know, whether it comes straight from the setup answers
 * (the first dry run, the evals) or from a saved playbook.
 */
export type ResearchBrief = {
  name: string
  topic: string
  include: string[]
  exclude: string[]
  sources: string[]
  onlyTheseSources: boolean
  freshnessHours: number
  maxCandidates: number
}

/** A story the research step found. `canonicalUrl` is the page itself, never a search page. */
export const Candidate = z.object({
  title: z.string(),
  canonicalUrl: z.string(),
  source: z.string().describe('The site or publisher, such as formula1.com'),
  publishedAt: z.string().describe('ISO 8601 date or date-time, as precise as the page says'),
  summary: z.string().describe('At most 60 words, factual, no hype'),
  whyItMatters: z.string().describe('One sentence on why the audience cares'),
  confidence: z.number().min(0).max(1).describe('How sure you are this is new, real and on topic'),
  keyFacts: z.array(z.string()).describe('Facts a post may state. Nothing else may be claimed.'),
  eventDate: z
    .string()
    .nullable()
    .describe(
      'Historical research only: when the event itself happened, YYYY-MM-DD, or YYYY-MM or YYYY when sources give no more. Null for recent news.',
    ),
  forDate: z
    .string()
    .nullable()
    .describe(
      'On-this-day research only: the target date from the brief, YYYY-MM-DD, that this anniversary is for. Otherwise null.',
    ),
})
export type Candidate = z.infer<typeof Candidate>

export const ResearchResult = z.object({
  candidates: z.array(Candidate),
  searchesRun: z.array(z.string()),
  notes: z.string().describe('What you looked at and why anything notable was left out'),
})
export type ResearchResult = z.infer<typeof ResearchResult>

/**
 * What a run looks for. `recent` is news inside the freshness window, as before. `archive` is
 * historical or evergreen material, where publication age does not matter but the event's date
 * must be verified. `anniversary` is "on this day": events whose date matches a posting date.
 */
export type ResearchMode = 'recent' | 'archive' | 'anniversary'
export const RESEARCH_MODES: readonly ResearchMode[] = ['recent', 'archive', 'anniversary']

const DATE = /^(\d{4})(?:-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?)?$/

/**
 * Why a historical candidate cannot be used, or null. Checked by the server, not left to the
 * model: a missing, malformed or future event date, or an anniversary that does not fall on
 * one of the run's target dates, is dropped rather than posted.
 */
export function historicalProblem(
  c: Pick<Candidate, 'eventDate' | 'forDate'>,
  mode: ResearchMode,
  targets: string[],
  today: string,
): string | null {
  if (mode === 'recent') return null
  const event = c.eventDate?.trim() ?? ''
  const parts = DATE.exec(event)
  if (!parts) return 'No verified date for the event, so it was left out.'
  if (event > today) return `The event date, ${event}, is in the future.`
  if (mode === 'archive') return null
  if (!parts[3]) return 'An on-this-day post needs the exact day of the event.'
  const target = c.forDate?.trim() ?? ''
  if (!targets.includes(target)) return 'It was not for one of this run’s posting dates.'
  if (event.slice(5) !== target.slice(5))
    return `The event (${event}) is not on the same day of the year as its posting date (${target}).`
  if (Number(event.slice(0, 4)) >= Number(target.slice(0, 4)))
    return 'An anniversary needs at least a year between the event and the post.'
  return null
}

/** Whole years from an event to the day it is remembered, for the writer to state as a fact. */
export function yearsSince(eventDate: string, onDate: string): number {
  return Number(onDate.slice(0, 4)) - Number(eventDate.slice(0, 4))
}

/** Daily runs look two days back; weekly runs eight, so a Monday run sees the whole week. */
export function freshnessFor(preset: 'daily' | 'weekly'): number {
  return preset === 'daily' ? 48 : 8 * 24
}

/** The brief a first run uses before any playbook exists: the setup answers, nothing inferred. */
export function briefFromSetup(answers: SetupAnswers): ResearchBrief {
  return {
    name: answers.research,
    topic: answers.research,
    include: [],
    exclude: answers.avoid
      .split(/[.;,\n]/)
      .map((s) => s.trim())
      .filter(Boolean),
    // Real runs give research full URLs from the playbook, and the fetch tool only opens a URL it
    // has already seen. A bare "formula1.com" here made the model guess a page and be refused, so
    // the eval read worse than real runs. Name the site's front page instead.
    sources: answers.sources.map((s) => {
      const host = hostOf(s)
      return host && !/^https?:\/\//i.test(s.trim()) && !s.includes('/') ? `https://${host}/` : s
    }),
    onlyTheseSources: answers.onlyTheseSources,
    freshnessHours: freshnessFor(answers.cadence.preset),
    maxCandidates: answers.maxStories,
  }
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const MONTH = MONTHS.join('|')
const DAY_MONTH = new RegExp(String.raw`\b([0-3]?\d)(?:st|nd|rd|th)?(\s+)(${MONTH})\b`, 'g')
const MONTH_DAY = new RegExp(String.raw`\b(${MONTH})([\s_]+)([0-3]?\d)(?:st|nd|rd|th)?\b`, 'g')

/**
 * Moves any day and month written into a playbook line ("10 November", "November 10",
 * wiki/November_10) to the run's own date. Playbooks are reused every run, but the generator
 * used to write the day it was made into on-this-day searches, so later runs kept searching it.
 */
export function redate(text: string, isoDate: string): string {
  const day = String(Number(isoDate.slice(8, 10)))
  const month = MONTHS[Number(isoDate.slice(5, 7)) - 1]
  if (!month || day === 'NaN') return text
  return text
    .replace(DAY_MONTH, (_m, _d, gap: string) => `${day}${gap}${month}`)
    .replace(MONTH_DAY, (_m, _mo, gap: string) => `${month}${gap}${day}`)
}

/** The brief a run uses once a playbook exists; the automation's own settings fill the rest. */
export function briefFromPlaybook(
  playbook: Playbook,
  settings: { onlyTheseSources: boolean; maxPostsPerRun: number },
): ResearchBrief {
  return {
    name: playbook.name,
    topic: playbook.about,
    include: playbook.include,
    exclude: playbook.exclude,
    sources: [
      ...playbook.sources.map((s) =>
        s.url
          ? `${s.url}${s.note ? ` (${s.note})` : ''}${s.priority === 'high' ? ' [open first]' : ''}`
          : s.label,
      ),
      ...playbook.searchQueries.map((q) => `search: "${q}"`),
    ],
    onlyTheseSources: settings.onlyTheseSources,
    freshnessHours: playbook.freshnessHours,
    maxCandidates: candidatesFor(settings.maxPostsPerRun),
  }
}

/** A few spare candidates beyond the stories wanted, so duplicates and weak ones can be dropped. */
export function candidatesFor(stories: number): number {
  return stories > 3 ? Math.min(stories + 3, 10) : Math.min(stories + 2, 5)
}

/** Per-run ceilings on the tool loop. Together with caching they bound what a run can cost. */
export const RESEARCH_LIMITS = {
  maxSearches: 6,
  /** Unfiltered search results cost about 2.5k input tokens each, so fewer of them. */
  maxBasicSearches: 4,
  maxFetches: 8,
  maxFetchTokens: 6_000,
  coveredShown: 100,
} as const

/**
 * A weekly batch of more than three stories needs more looking: these replace the per-run
 * ceilings above. About twice the tool use, for up to seven stories instead of three.
 */
export const RESEARCH_BATCH_LIMITS = {
  maxSearches: 10,
  maxBasicSearches: 7,
  maxFetches: 14,
} as const

/** The tool ceilings for a run that may return this many candidates. */
export function researchLimitsFor(maxCandidates: number) {
  const batch = maxCandidates > 5
  return {
    maxSearches: batch ? RESEARCH_BATCH_LIMITS.maxSearches : RESEARCH_LIMITS.maxSearches,
    maxBasicSearches: batch
      ? RESEARCH_BATCH_LIMITS.maxBasicSearches
      : RESEARCH_LIMITS.maxBasicSearches,
    maxFetches: batch ? RESEARCH_BATCH_LIMITS.maxFetches : RESEARCH_LIMITS.maxFetches,
  }
}

export const RESEARCH_SYSTEM = `You are the research step of Dispatchlet, a scheduled agent that finds genuinely new stories in one niche and hands them to a writer who turns them into social posts. You run unattended; nobody reads your notes but the log.

How to work:
- You have a small budget of searches and page opens, stated in the brief. Spend it one or two at a time and read what comes back before going on. Do not fire every search at once.
- Start by opening the source pages marked [open first]: a publisher's own latest-news page lists today's stories with dates, which search engines rarely do. Then run the brief's searches, then anything else reliable the brief allows.
- When a preferred source does not show up in results, search it directly with site:host and the topic.
- web_search takes a query, such as site:host and the topic. web_fetch takes a full URL that already appears in this brief, in a search result or in a page you opened. A guessed URL fails, and a query in the wrong tool fails, and both still use up the budget.
- Open the article itself, not a tag or archive page, when a snippet is not enough to be sure of the facts or the date. A page that fails to open still costs an open; move on rather than retry it.
- A candidate must be a specific story published or materially updated inside the freshness window. Previews, evergreen explainers, listicles, press releases dressed as news and "sources say" rumours do not count unless the brief asks for them.
- Prefer primary sources and named journalists. Give the page's own URL, never a search or home page, and never a URL you did not see.
- Keep facts to what the pages say. keyFacts is the writer's whole evidence; put dates, names, numbers and quotes there.
- Never return a story in the covered list or a retelling of one from another outlet.
- Fewer, better candidates beat many weak ones. Returning none is correct when nothing worthwhile happened, but only after you have opened the sources and run the brief's searches. Returning none without looking is wrong.
- When a listing shows a story as recent but you cannot pin the exact time, open it. If it is still unclear, include it with a confidence of about 0.5 and say why in notes, rather than drop it. Dropping a real story costs more than one uncertain candidate.`

/**
 * The historical variant swaps the rules about recency for rules about verification. It is a
 * separate fixed prompt so each variant stays cacheable.
 */
export const RESEARCH_SYSTEM_HISTORICAL = RESEARCH_SYSTEM.replace(
  'finds genuinely new stories in one niche',
  'finds well-documented stories from the history of one niche',
)
  .replace(
    /- A candidate must be a specific story published or materially updated inside the freshness window\.[^\n]*/,
    '- A candidate is a specific, documented event from the past. When the source was published does not matter; old archives, official records, contemporary reports and reputable histories all count. Give eventDate, the date the event happened, as precisely as the sources confirm. Rumours, legends and unsourced "fun facts" do not count.',
  )
  .replace(
    /- When a listing shows a story as recent but you cannot pin the exact time[^\n]*/,
    '- Confirm the event date on the page you cite, or on a second reliable page. If sources disagree or you cannot confirm it, leave the story out and say why in notes. A wrong date is worse than a missing story.',
  )
  .replace(
    "a publisher's own latest-news page lists today's stories with dates, which search engines rarely do",
    'archives and records pages list events with their dates',
  )

export function researchSystemFor(mode: ResearchMode): string {
  return mode === 'recent' ? RESEARCH_SYSTEM : RESEARCH_SYSTEM_HISTORICAL
}

export type ResearchContext = {
  now: Date
  timezone: string
  /** Titles and URLs already posted or scheduled, newest first. */
  covered: { title: string; url: string }[]
  /** A story the caller asked this run to cover (API, inbound hook, MCP). */
  requested?: { title: string; url?: string; notes?: string } | null
  /** A planned batch: its stories are posted one a day over this many days. */
  batch?: { days: number; stories: number } | null
  mode?: ResearchMode
  /** Anniversary mode: the local posting dates (YYYY-MM-DD) to find events for. */
  targetDates?: string[]
}

/** The first run of an automation has nothing covered yet, so it looks back twice as far. */
export function lookbackHours(freshnessHours: number, coveredCount: number): number {
  return coveredCount ? freshnessHours : Math.min(freshnessHours * 2, 14 * 24)
}

/** The user message, the part of the prompt that changes every run, so it goes after the cache point. */
export function researchUserMessage(brief: ResearchBrief, context: ResearchContext): string {
  const when = context.now.toLocaleString('en-GB', {
    timeZone: context.timezone,
    dateStyle: 'full',
    timeStyle: 'short',
  })
  const hours = lookbackHours(brief.freshnessHours, context.covered.length)
  const mode = context.mode ?? 'recent'
  const lines = [
    `Brief: ${brief.name}`,
    `Now: ${when} (${context.timezone}).`,
    `Research: ${brief.topic}`,
    mode === 'recent'
      ? `Freshness: published or materially updated in the last ${hours} hours.${
          hours > brief.freshnessHours
            ? ' This is the first run, so it looks back further than usual.'
            : ''
        }`
      : mode === 'archive'
        ? 'Period: history. Find documented past events; there is no freshness window. Give each eventDate; set forDate to null.'
        : `Period: on this day. Find documented past events that happened on the same day and month as these posting dates, in an earlier year: ${(context.targetDates ?? []).join(', ')}.${context.batch ? ' At most one story per date.' : ''} Give each eventDate as YYYY-MM-DD and forDate as the posting date it matches. A date with no well-documented event is better left empty.`,
  ]
  if (context.requested) {
    const r = context.requested
    lines.push(
      `Asked for: the person wants this story covered in this run: "${r.title}"${r.url ? ` (${r.url})` : ''}.${r.notes ? ` Their notes: ${r.notes}` : ''} ${r.url ? 'Open that URL and' : 'Search for it and'} return it as a candidate with full confidence, in the person's own framing; the freshness window does not apply to it. Still skip it if it is in the covered list.`,
    )
  }
  if (context.batch)
    lines.push(
      `Batch: these stories are posted one a day over the next ${context.batch.days} days, so look for up to ${context.batch.stories} distinct stories and prefer ones that will still be worth reading later in the week. Do not return several angles on the same story to fill the batch; fewer is fine.`,
    )
  if (brief.include.length) lines.push(`Worth posting: ${brief.include.join('; ')}.`)
  if (brief.exclude.length) lines.push(`Skip: ${brief.exclude.join('; ')}.`)
  if (brief.sources.length) {
    lines.push(
      brief.onlyTheseSources
        ? `Sources, and only these: ${brief.sources.join(', ')}.`
        : `Preferred sources: ${brief.sources.join(', ')}. Other reliable sources are fine too.`,
    )
  }
  const covered = context.covered.slice(0, RESEARCH_LIMITS.coveredShown)
  lines.push(
    covered.length
      ? `Already covered, do not return these or near-duplicates:\n${covered.map((c) => `- ${c.title} (${c.url})`).join('\n')}`
      : 'Nothing has been covered yet.',
  )
  const limits = researchLimitsFor(brief.maxCandidates)
  lines.push(
    `Budget: ${process.env.RESEARCH_TOOLS === 'filtered' ? limits.maxSearches : limits.maxBasicSearches} searches and ${limits.maxFetches} page opens.`,
    `Return at most ${brief.maxCandidates} candidates.`,
  )
  return lines.join('\n')
}

/** The hosts the web tools may touch when the user ticked "only these sources", else none. */
export function allowedDomains(brief: ResearchBrief): string[] | undefined {
  if (!brief.onlyTheseSources) return undefined
  const hosts = [...new Set(brief.sources.map(hostOf).filter((h): h is string => h !== null))]
  return hosts.length ? hosts : undefined
}

/**
 * The web tools for a research call. The basic variants are the default: the newer ones filter
 * results with code and cut tokens, but on the 28 Oct eval their filtering failed mid-run and the
 * retries spent the allowance, while the basic ones were twice as fast and found more. Basic search
 * results are large, so searches are capped lower. RESEARCH_TOOLS=filtered switches back.
 */
export function researchTools(
  domains: string[] | undefined,
  variant: 'filtered' | 'basic' = process.env.RESEARCH_TOOLS === 'filtered' ? 'filtered' : 'basic',
  maxCandidates = 5,
) {
  const scope = domains ? { allowed_domains: domains } : {}
  const limits = researchLimitsFor(maxCandidates)
  return [
    {
      type:
        variant === 'basic' ? ('web_search_20250305' as const) : ('web_search_20260209' as const),
      name: 'web_search' as const,
      max_uses: variant === 'basic' ? limits.maxBasicSearches : limits.maxSearches,
      ...scope,
    },
    {
      type: variant === 'basic' ? ('web_fetch_20250910' as const) : ('web_fetch_20260209' as const),
      name: 'web_fetch' as const,
      max_uses: limits.maxFetches,
      max_content_tokens: RESEARCH_LIMITS.maxFetchTokens,
      ...scope,
    },
  ]
}
