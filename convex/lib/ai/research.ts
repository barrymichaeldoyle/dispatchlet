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
})
export type Candidate = z.infer<typeof Candidate>

export const ResearchResult = z.object({
  candidates: z.array(Candidate),
  searchesRun: z.array(z.string()),
  notes: z.string().describe('What you looked at and why anything notable was left out'),
})
export type ResearchResult = z.infer<typeof ResearchResult>

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
    sources: answers.sources,
    onlyTheseSources: answers.onlyTheseSources,
    freshnessHours: freshnessFor(answers.cadence.preset),
    maxCandidates: answers.maxStories,
  }
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
    maxCandidates: Math.min(settings.maxPostsPerRun + 2, 5),
  }
}

/** Per-run ceilings on the tool loop. Together with caching they bound what a run can cost. */
export const RESEARCH_LIMITS = {
  maxSearches: 6,
  maxFetches: 8,
  maxFetchTokens: 6_000,
  coveredShown: 100,
} as const

export const RESEARCH_SYSTEM = `You are the research step of Dispatchlet, a scheduled agent that finds genuinely new stories in one niche and hands them to a writer who turns them into social posts. You run unattended; nobody reads your notes but the log.

How to work:
- You have a small budget of searches and page opens, stated in the brief. Spend it one or two at a time and read what comes back before going on. Do not fire every search at once.
- Start by opening the source pages marked [open first]: a publisher's own latest-news page lists today's stories with dates, which search engines rarely do. Then run the brief's searches, then anything else reliable the brief allows.
- When a preferred source does not show up in results, search it directly with site:host and the topic.
- Open the article itself, not a tag or archive page, when a snippet is not enough to be sure of the facts or the date. A page that fails to open still costs an open; move on rather than retry it.
- A candidate must be a specific story published or materially updated inside the freshness window. Previews, evergreen explainers, listicles, press releases dressed as news and "sources say" rumours do not count unless the brief asks for them.
- Prefer primary sources and named journalists. Give the page's own URL, never a search or home page, and never a URL you did not see.
- Keep facts to what the pages say. keyFacts is the writer's whole evidence; put dates, names, numbers and quotes there.
- Never return a story in the covered list or a retelling of one from another outlet.
- Fewer, better candidates beat many weak ones. Returning none is correct when nothing worthwhile happened, but only after you have opened the sources and run the brief's searches. Returning none without looking is wrong.
- When a listing shows a story as recent but you cannot pin the exact time, open it. If it is still unclear, include it with a confidence of about 0.5 and say why in notes, rather than drop it. Dropping a real story costs more than one uncertain candidate.`

export type ResearchContext = {
  now: Date
  timezone: string
  /** Titles and URLs already posted or scheduled, newest first. */
  covered: { title: string; url: string }[]
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
  const lines = [
    `Brief: ${brief.name}`,
    `Now: ${when} (${context.timezone}).`,
    `Research: ${brief.topic}`,
    `Freshness: published or materially updated in the last ${hours} hours.${
      hours > brief.freshnessHours
        ? ' This is the first run, so it looks back further than usual.'
        : ''
    }`,
  ]
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
  lines.push(
    `Budget: ${RESEARCH_LIMITS.maxSearches} searches and ${RESEARCH_LIMITS.maxFetches} page opens.`,
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
 * The web tools for a research call. The newer variants filter results with code and cut tokens,
 * but their filtering can fail mid-run and spend the allowance on retries; RESEARCH_TOOLS=basic
 * switches to the plain variants for comparison.
 */
export function researchTools(
  domains: string[] | undefined,
  variant: 'filtered' | 'basic' = process.env.RESEARCH_TOOLS === 'basic' ? 'basic' : 'filtered',
) {
  const scope = domains ? { allowed_domains: domains } : {}
  return [
    {
      type:
        variant === 'basic' ? ('web_search_20250305' as const) : ('web_search_20260209' as const),
      name: 'web_search' as const,
      max_uses: RESEARCH_LIMITS.maxSearches,
      ...scope,
    },
    {
      type: variant === 'basic' ? ('web_fetch_20250910' as const) : ('web_fetch_20260209' as const),
      name: 'web_fetch' as const,
      max_uses: RESEARCH_LIMITS.maxFetches,
      max_content_tokens: RESEARCH_LIMITS.maxFetchTokens,
      ...scope,
    },
  ]
}
