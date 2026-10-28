import { describe, expect, it } from 'vitest'
import { parsePlaybook, renderPlaybook, type Playbook } from './playbook'

const GOOD_NEWS: Playbook = {
  name: 'Good News Today',
  about:
    'Positive, verified stories about conservation and communities, for readers who want proof that things improve.',
  sources: [
    {
      label: 'positive.news',
      url: 'https://positive.news',
      note: 'Solutions journalism.',
      priority: 'high',
    },
    {
      label: 'goodnewsnetwork.org',
      url: 'https://goodnewsnetwork.org',
      note: '',
      priority: 'normal',
    },
    {
      label: 'The Guardian environment desk',
      url: null,
      note: 'Search it, the URL changes.',
      priority: 'normal',
    },
  ],
  searchQueries: ['conservation success this week', 'community rebuilds after'],
  freshnessHours: 48,
  include: [
    'A measurable outcome, such as a species count or a reopened school.',
    'A named organisation or person behind it.',
  ],
  exclude: ['Company press releases.', 'Anything political.'],
  voice: {
    tone: 'Warm and factual, no hype.',
    notes: 'Short sentences.',
    avoidSaying: ['heartwarming', 'game-changer'],
    emoji: 'none',
    hashtags: 'none',
  },
  formats: [
    {
      service: 'twitter',
      style: 'One fact, one line, the link last.',
      maxLength: null,
      thread: false,
      linkBack: null,
    },
    {
      service: 'linkedin',
      style: 'Three short paragraphs: what happened, why it matters, the link.',
      maxLength: 1200,
      thread: false,
      linkBack: 'the source article',
    },
  ],
}

describe('the playbook text', () => {
  it('renders the fixed sections in order', () => {
    const text = renderPlaybook(GOOD_NEWS)
    expect(text.split('\n').filter((l) => l.startsWith('#'))).toEqual([
      '# Good News Today',
      '## About',
      '## Sources',
      '## Searches',
      '## Post about',
      '## Skip',
      '## Tone',
      '## Formats',
    ])
    expect(text).toContain('positive.news, Solutions journalism. Check first.')
    expect(text).toContain('Search the web for "conservation success this week".')
    expect(text).toContain('Only stories from the last 2 days.')
    expect(text).toContain(
      'LinkedIn: Three short paragraphs: what happened, why it matters, the link. Up to 1200 characters. Link: the source article',
    )
  })

  it('round-trips: render, parse, render again gives the same text', () => {
    const text = renderPlaybook(GOOD_NEWS)
    const parsed = parsePlaybook(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.playbook).toEqual(GOOD_NEWS)
    expect(renderPlaybook(parsed.playbook)).toBe(text)
  })

  it('reads hours, days and threads', () => {
    const text = renderPlaybook({
      ...GOOD_NEWS,
      freshnessHours: 36,
      formats: [
        { service: 'bluesky', style: 'Terse.', maxLength: null, thread: true, linkBack: null },
      ],
    })
    expect(text).toContain('Only stories from the last 36 hours.')
    expect(text).toContain('Bluesky: Terse. A thread when the story needs one.')
    const parsed = parsePlaybook(text)
    expect(parsed.ok && parsed.playbook.freshnessHours).toBe(36)
    expect(parsed.ok && parsed.playbook.formats[0]).toEqual({
      service: 'bluesky',
      style: 'Terse.',
      maxLength: null,
      thread: true,
      linkBack: null,
    })
  })

  it('names the line when something is not understood', () => {
    expect(parsePlaybook('Hello')).toEqual({
      ok: false,
      line: 1,
      message: 'Start with "# " and a name.',
    })
    expect(parsePlaybook('# A\n\n## Wrong\nx')).toMatchObject({ ok: false, line: 3 })
    expect(parsePlaybook('# A\n\n## Formats\nInstagram: pics')).toMatchObject({
      ok: false,
      line: 4,
    })
    expect(parsePlaybook('# A\n\n## Searches\nlook for cats')).toMatchObject({ ok: false, line: 4 })
  })

  it('accepts a bare minimum and fills the defaults', () => {
    const parsed = parsePlaybook('# Cats\n## About\nCats.\n## Tone\nDry.\n')
    expect(parsed.ok && parsed.playbook).toMatchObject({
      name: 'Cats',
      freshnessHours: 48,
      sources: [],
      voice: { tone: 'Dry.', emoji: 'none' },
    })
  })
})
