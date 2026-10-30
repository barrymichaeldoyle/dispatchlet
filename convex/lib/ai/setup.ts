import { z } from 'zod'

/** The text services Dispatchlet writes for. Buffer's names, as channel sync stores them. */
export const SERVICES = ['twitter', 'linkedin', 'threads', 'bluesky', 'mastodon'] as const
export type Service = (typeof SERVICES)[number]

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

/** The answers to the seven setup questions, in their order. */
export const SetupAnswers = z.object({
  /** 1. What should it research? */
  research: z.string().trim().min(1).max(300),
  /** 2. Where should it post? The services of the chosen channels, one entry per channel. */
  services: z.array(z.enum(SERVICES)).min(1),
  /** 3. Anything to avoid? */
  avoid: z.string().trim().max(500).default(''),
  /** 4. Sources you prefer? URLs or site names, one per entry. */
  sources: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
  onlyTheseSources: z.boolean().default(false),
  /** 5. When should it run? Local time in the user's zone. */
  cadence: z.object({
    preset: z.enum(['daily', 'weekly']),
    time: z.string().regex(/^\d{2}:\d{2}$/),
    weekday: z.enum(WEEKDAYS).nullable().default(null),
  }),
  /** 6. How many stories a day or a week? */
  maxStories: z.number().int().min(1).max(3).default(3),
  /** 7. How should posts reach Buffer? */
  postingMode: z.enum(['draft', 'queue']).default('draft'),
})
export type SetupAnswers = z.infer<typeof SetupAnswers>

/**
 * Turns "formula1.com", "https://positive.news/feed" or "bbc.co.uk/sport" into the host the web
 * tools' `allowed_domains` takes. Anything that is not a host or URL (a site's name, say) is dropped.
 */
export function hostOf(source: string): string | null {
  const trimmed = source.trim().toLowerCase()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    const host = url.hostname.replace(/^www\./, '')
    if (!host.includes('.') || /\s/.test(host)) return null
    return host
  } catch {
    return null
  }
}
