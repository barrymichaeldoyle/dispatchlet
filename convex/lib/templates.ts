import type { SetupAnswers } from './ai/setup'

/**
 * Ready-made answers to the setup questions, so the first automation is one click plus a channel.
 * The playbook is still written from scratch for the person's channels and time zone.
 */
export type Template = {
  id: string
  name: string
  line: string
  answers: Omit<SetupAnswers, 'services'>
}

export const TEMPLATES: Template[] = [
  {
    id: 'f1',
    name: 'F1 news',
    line: 'Race results, driver and team news, rule changes.',
    answers: {
      research: 'F1 news: race results, driver and team news, rule changes',
      avoid: 'Rumours without a named source, betting',
      sources: ['formula1.com', 'the-race.com', 'autosport.com'],
      onlyTheseSources: false,
      cadence: { preset: 'daily', time: '08:00', weekday: null },
      maxStories: 3,
      postingMode: 'draft',
    },
  },
  {
    id: 'good-news',
    name: 'Good news',
    line: 'Positive, verified stories about conservation and communities.',
    answers: {
      research: 'Positive stories about conservation and communities',
      avoid: 'Company PR and politics',
      sources: ['positive.news', 'goodnewsnetwork.org', 'bbc.co.uk', 'theguardian.com'],
      onlyTheseSources: false,
      cadence: { preset: 'daily', time: '08:00', weekday: null },
      maxStories: 3,
      postingMode: 'draft',
    },
  },
  {
    id: 'dev-weekly',
    name: 'Programming weekly',
    line: 'Language and framework releases, security advisories, once a week.',
    answers: {
      research:
        'Weekly roundup of notable programming news: language releases, major framework releases, security advisories',
      avoid: 'Vendor marketing, funding announcements',
      sources: ['github.com/advisories', 'lwn.net'],
      onlyTheseSources: false,
      cadence: { preset: 'weekly', time: '09:00', weekday: 'mon' },
      maxStories: 3,
      postingMode: 'draft',
    },
  },
  {
    id: 'local-food',
    name: 'Local food scene',
    line: 'Openings, closures, markets and menus in one city. Change the city.',
    answers: {
      research: "What's new in Bristol's food scene: openings, closures, markets, seasonal menus",
      avoid: 'Chains and paid promotions',
      sources: ['bristol247.com', 'bristolpost.co.uk'],
      onlyTheseSources: false,
      cadence: { preset: 'weekly', time: '12:00', weekday: 'fri' },
      maxStories: 2,
      postingMode: 'draft',
    },
  },
  {
    id: 'charity',
    name: 'Charity news',
    line: 'Field news in your cause, written warmly. Change the cause.',
    answers: {
      research: 'Conservation news relevant to a Kenyan wildlife charity',
      avoid: 'Graphic content, politics',
      sources: ['kws.go.ke', 'mongabay.com'],
      onlyTheseSources: false,
      cadence: { preset: 'weekly', time: '08:00', weekday: 'wed' },
      maxStories: 2,
      postingMode: 'draft',
    },
  },
  {
    id: 'industry',
    name: 'Industry news for a company',
    line: 'What your customers read, not your competitors. Change the industry.',
    answers: {
      research: 'Product and industry news for a B2B scheduling software company',
      avoid: 'Competitor product launches',
      sources: [],
      onlyTheseSources: false,
      cadence: { preset: 'daily', time: '07:30', weekday: null },
      maxStories: 1,
      postingMode: 'draft',
    },
  },
]
