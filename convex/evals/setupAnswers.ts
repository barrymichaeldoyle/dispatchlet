import type { SetupAnswers } from '../lib/ai/setup'

/**
 * Accounts written as answers to the setup questions (SPEC §36). Rows 1 to 3 measure the cost
 * of a research run; all of them check playbook and research quality. `mustGetRight` is the bar
 * the blind judge in benchmark.ts scores against.
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
  {
    id: 11,
    answers: {
      research:
        "Other builders' Buffer Commit hackathon projects: build-in-public posts, demos and write-ups about what they are making with the Buffer API",
      services: ['twitter', 'linkedin'],
      avoid:
        'Dispatchlet itself, guesses about judging or winners, posts that do not name the builder',
      sources: ['buffer.com', 'bsky.app', 'dev.to', 'github.com', 'linkedin.com'],
      onlyTheseSources: false,
      cadence: { preset: 'daily', time: '09:00', weekday: null },
      maxStories: 3,
      postingMode: 'draft',
    },
    mustGetRight:
      'Credits the builder by name and links their own post or repo; never presents their project as Dispatchlet; nothing about judging',
  },
  {
    id: 12,
    answers: {
      research: 'Space missions: launches, landings, probe and telescope results from the agencies',
      services: ['bluesky'],
      avoid: 'Space tourism hype, UFOs, launch date speculation',
      sources: ['nasa.gov', 'esa.int', 'spacenews.com', 'planetary.org'],
      onlyTheseSources: false,
      cadence: { preset: 'daily', time: '07:00', weekday: null },
      maxStories: 2,
      postingMode: 'queue',
    },
    mustGetRight:
      'Agency or mission team as the source for results; exact mission names and dates; a scrubbed launch is not a launch',
  },
  {
    id: 13,
    answers: {
      research:
        'UK personal finance rule changes: tax thresholds, ISA and pension rules, benefit rates',
      services: ['linkedin', 'threads'],
      avoid: 'Product promotions, investment tips, predictions',
      sources: ['gov.uk', 'moneysavingexpert.com', 'which.co.uk'],
      onlyTheseSources: true,
      cadence: { preset: 'weekly', time: '08:00', weekday: 'thu' },
      maxStories: 2,
      postingMode: 'draft',
    },
    mustGetRight:
      'Every figure and date exactly as gov.uk gives it; a proposal is not a rule; no advice on what to do',
  },
  {
    id: 14,
    answers: {
      research:
        'Open-weight AI model releases: new models, licences and benchmark results from the labs',
      services: ['twitter', 'bluesky'],
      avoid: 'Leaks, funding rounds, "this changes everything" takes',
      sources: ['huggingface.co', 'github.com', 'arxiv.org'],
      onlyTheseSources: false,
      cadence: { preset: 'daily', time: '09:00', weekday: null },
      maxStories: 3,
      postingMode: 'draft',
    },
    mustGetRight:
      'Names the lab, the model and its licence; benchmark numbers only as the lab reports them, credited; no hype words',
  },
]
