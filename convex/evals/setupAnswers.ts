import type { SetupAnswers } from '../lib/ai/setup'

/**
 * Ten accounts written as answers to the setup questions (SPEC §36). Rows 1 to 3 measure the cost
 * of a research run; all ten check playbook and research quality. `mustGetRight` is judged by eye.
 */
export type Fixture = { id: number; answers: SetupAnswers; mustGetRight: string }

export const FIXTURES: Fixture[] = [
  {
    id: 1,
    answers: {
      research: 'F1 news: race results, driver and team news, rule changes',
      services: ['twitter'],
      avoid: 'Rumours without a named source, betting',
      sources: ['formula1.com', 'the-race.com', 'autosport.com'],
      onlyTheseSources: false,
      cadence: { preset: 'daily', time: '08:00', weekday: null },
      maxStories: 3,
      postingMode: 'queue',
    },
    mustGetRight:
      'Prefer official and named-journalist sources; skip "sources say" pieces; on race weekends find session results, not week-old previews',
  },
  {
    id: 2,
    answers: {
      research: 'Positive stories about conservation and communities (Good News Today)',
      services: ['twitter', 'linkedin'],
      avoid: 'Company PR and politics',
      sources: ['positive.news', 'goodnewsnetwork.org', 'bbc.co.uk', 'theguardian.com'],
      onlyTheseSources: false,
      cadence: { preset: 'daily', time: '08:00', weekday: null },
      maxStories: 3,
      postingMode: 'queue',
    },
    mustGetRight:
      'Warm, factual, no hype; LinkedIn post longer than X; never repeat a story covered by another outlet',
  },
  {
    id: 3,
    answers: {
      research:
        'Weekly roundup of notable programming news: language releases, major framework releases, security advisories',
      services: ['bluesky', 'mastodon'],
      avoid: 'Vendor marketing, funding announcements',
      sources: [],
      onlyTheseSources: false,
      cadence: { preset: 'weekly', time: '09:00', weekday: 'mon' },
      maxStories: 3,
      postingMode: 'draft',
    },
    mustGetRight:
      'Week-scale freshness, not 24h; primary sources (release notes, advisories); Mastodon within 500 characters',
  },
  {
    id: 4,
    answers: {
      research: "What's new in Bristol's food scene: openings, closures, markets, seasonal menus",
      services: ['threads', 'twitter'],
      avoid: 'Chains and paid promotions',
      sources: ['bristol247.com', 'bristolpost.co.uk'],
      onlyTheseSources: false,
      cadence: { preset: 'weekly', time: '12:00', weekday: 'fri' },
      maxStories: 2,
      postingMode: 'draft',
    },
    mustGetRight:
      'Local sources only, no national food news; skip sponsored content; a quiet week gives fewer posts, not padding',
  },
  {
    id: 5,
    answers: {
      research: 'Releases and notable changes in the Rust HTTP ecosystem (hyper, reqwest, axum)',
      services: ['twitter', 'bluesky'],
      avoid: 'Rumours, benchmarks without methodology',
      sources: ['github.com', 'blog.rust-lang.org'],
      onlyTheseSources: true,
      cadence: { preset: 'weekly', time: '10:00', weekday: 'tue' },
      maxStories: 3,
      postingMode: 'draft',
    },
    mustGetRight:
      'With "only these sources" ticked, cite nothing else; link the release notes; thread only when a release needs it',
  },
  {
    id: 6,
    answers: {
      research:
        'Championship football club fan account (Sheffield Wednesday): previews, results, confirmed transfers',
      services: ['twitter', 'threads'],
      avoid: 'Betting, abuse, unconfirmed transfer rumours',
      sources: ['swfc.co.uk', 'bbc.co.uk/sport'],
      onlyTheseSources: false,
      cadence: { preset: 'daily', time: '18:00', weekday: null },
      maxStories: 2,
      postingMode: 'queue',
    },
    mustGetRight: 'Only confirmed transfers; schedule around match days; no betting odds anywhere',
  },
  {
    id: 7,
    answers: {
      research: 'Conservation news relevant to a Kenyan wildlife charity',
      services: ['linkedin'],
      avoid: 'Graphic content, politics',
      sources: ['kws.go.ke', 'mongabay.com'],
      onlyTheseSources: false,
      cadence: { preset: 'weekly', time: '08:00', weekday: 'wed' },
      maxStories: 2,
      postingMode: 'draft',
    },
    mustGetRight:
      "Warm but factual, no exclamation marks; say it can't research the charity's own field updates; LinkedIn length used well",
  },
  {
    id: 8,
    answers: {
      research: 'E-ink hardware and small games for e-ink devices',
      services: ['twitter', 'mastodon'],
      avoid: 'Generic gaming news',
      sources: ['usetrmnl.com', 'itch.io'],
      onlyTheseSources: false,
      cadence: { preset: 'weekly', time: '10:00', weekday: 'sat' },
      maxStories: 2,
      postingMode: 'draft',
    },
    mustGetRight:
      'Niche sources over general tech sites; posts nothing rather than off-topic e-reader deals',
  },
  {
    id: 9,
    answers: {
      research: 'Product and industry news for a B2B scheduling software company',
      services: ['linkedin'],
      avoid: 'Competitor product launches',
      sources: [],
      onlyTheseSources: false,
      cadence: { preset: 'daily', time: '07:30', weekday: null },
      maxStories: 1,
      postingMode: 'draft',
    },
    mustGetRight:
      'Industry news, not competitor promotion; one strong story a day; professional voice',
  },
  {
    id: 10,
    answers: {
      research: 'Lighthouse preservation in Cornwall',
      services: ['mastodon'],
      avoid: '',
      sources: [],
      onlyTheseSources: false,
      cadence: { preset: 'daily', time: '09:00', weekday: null },
      maxStories: 3,
      postingMode: 'draft',
    },
    mustGetRight:
      'Slow-news check: most days nothing new; the run should post 0 or 1, say why, and not repeat or pad',
  },
]
