import { describe, expect, it } from 'vitest'
import {
  checkPost,
  creditedOutlets,
  limitFor,
  nameMatchesHost,
  overBy,
  withLink,
  withoutLink,
  writeUserMessage,
  type TargetChannel,
} from './write'
import type { Playbook } from '../playbook'

const playbook: Playbook = {
  name: 'T',
  about: 'A.',
  sources: [],
  searchQueries: [],
  freshnessHours: 48,
  include: [],
  exclude: [],
  voice: { tone: 'Dry.', notes: '', avoidSaying: [], emoji: 'none', hashtags: 'none' },
  formats: [
    { service: 'twitter', style: 'Short.', maxLength: 240, thread: true, linkBack: null },
    {
      service: 'linkedin',
      style: 'Longer.',
      maxLength: null,
      thread: false,
      linkBack: 'the article',
    },
  ],
}
const x: TargetChannel = {
  channelId: 'c1',
  service: 'twitter',
  name: 'GrandPrixPicks',
  maxLength: null,
}
const premiumX: TargetChannel = { ...x, maxLength: 25_000 }
const li: TargetChannel = { channelId: 'c2', service: 'linkedin', name: 'Barry', maxLength: null }
const urls = new Set(['https://a.com/1'])
const base = {
  storyUrl: 'https://a.com/1',
  channelId: 'c1',
  text: 'ok',
  thread: null,
  linkAttachment: null,
}

describe('post limits', () => {
  it('takes the tighter of the service, the channel and the playbook', () => {
    expect(limitFor(x, playbook)).toBe(240)
    expect(limitFor(premiumX, playbook)).toBe(240)
    expect(limitFor(li, playbook)).toBe(3000)
    expect(limitFor({ ...li, maxLength: 1500 }, playbook)).toBe(1500)
  })
  it('rejects long posts, stray stories, forbidden threads and hashtags', () => {
    expect(checkPost({ ...base, text: 'x'.repeat(241) }, x, playbook, urls)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('241 characters'),
    })
    expect(checkPost({ ...base, storyUrl: 'https://b.com' }, x, playbook, urls).ok).toBe(false)
    expect(
      checkPost({ ...base, channelId: 'c2', thread: ['more'] }, li, playbook, urls),
    ).toMatchObject({ ok: false, reason: 'Threads are not allowed on Barry.' })
    expect(checkPost({ ...base, text: 'news #f1' }, x, playbook, urls).ok).toBe(false)
    expect(checkPost({ ...base, thread: ['part two'] }, x, playbook, urls).ok).toBe(true)
  })
  it('drops a link card on channels without one instead of failing the post', () => {
    const result = checkPost(
      { ...base, linkAttachment: { url: 'u', title: 't', description: 'd' } },
      x,
      playbook,
      urls,
    )
    expect(result.ok && result.post.linkAttachment).toBeNull()
  })
  it('tells the writer each channel’s limit and card support', () => {
    const text = writeUserMessage(playbook, [], [x, li])
    expect(text).toContain(
      'channelId c1: X (GrandPrixPicks). Your text may be 215 characters at most; aim for 161. Threads allowed. No link card',
    )
    expect(text).toContain(
      'channelId c2: LinkedIn (Barry). Your text may be 3000 characters at most; aim for 2250. No threads. Shows a link card. Style: Longer. Link: the article',
    )
  })
})

describe('X link counting', () => {
  it('counts a URL as 23 characters on X and at full length elsewhere', async () => {
    const { measuredLength } = await import('./write')
    const text = `Antonelli wins. https://formula1.com/en/latest/article/a-very-long-slug-that-goes-on-and-on.6kmBQv9FNTW7LzkDj8S34j`
    expect(measuredLength(text, 'twitter')).toBe(16 + 23)
    expect(measuredLength(text, 'linkedin')).toBe([...text].length)
  })
})

describe('the link the system adds', () => {
  const post = {
    storyUrl: 'https://a.com/1',
    channelId: 'c1',
    text: 'News.',
    thread: null,
    linkAttachment: null,
  }
  it('goes after the text on X and nowhere on LinkedIn, and comes off again for a rewrite', () => {
    const linked = withLink(post, x)
    expect(linked.text).toBe('News.\n\nhttps://a.com/1')
    expect(withLink(post, li).text).toBe('News.')
    expect(withLink(linked, x).text).toBe(linked.text)
    expect(withoutLink(linked).text).toBe('News.')
  })
  it('goes on the last part of a thread', () => {
    expect(withLink({ ...post, thread: ['Two.'] }, x).thread).toEqual(['Two.\n\nhttps://a.com/1'])
  })
  it('says how far over a post is', () => {
    expect(overBy({ ...post, text: 'x'.repeat(250) }, x, playbook)).toBe(10)
    expect(overBy(post, x, playbook)).toBe(0)
  })
})

describe('crediting the outlet of the link', () => {
  it('finds the outlets a post credits', () => {
    expect(creditedOutlets('Antonelli leads by 123 points, per Reuters.')).toEqual(['Reuters'])
    expect(creditedOutlets('The Race reports the deal runs to 2029.')).toEqual(['The Race'])
    expect(creditedOutlets('According to BBC Sport, the race moves.')).toEqual(['BBC Sport'])
    expect(creditedOutlets('Mercedes said nothing about it.')).toEqual([])
    expect(creditedOutlets('Cadillac confirmed the extension.')).toEqual([])
    expect(creditedOutlets('The FIA named AWS, per Autosport. Work goes on.')).toEqual([
      'Autosport',
    ])
    expect(creditedOutlets('The FIA named AWS, per Motorsport.com.')).toEqual(['Motorsport.com'])
  })

  it('matches a name to its site', () => {
    expect(nameMatchesHost('Al Jazeera', 'aljazeera.com')).toBe(true)
    expect(nameMatchesHost('The Race', 'the-race.com')).toBe(true)
    expect(nameMatchesHost('BBC Sport', 'bbc.co.uk')).toBe(true)
    expect(nameMatchesHost('PlanetF1', 'planetf1.com')).toBe(true)
    expect(nameMatchesHost('F1', 'formula1.com')).toBe(true)
    expect(nameMatchesHost('Formula 1', 'formula1.com')).toBe(true)
    expect(nameMatchesHost('Autosport', 'autosport.com')).toBe(true)
    expect(nameMatchesHost('Reuters', 'aljazeera.com')).toBe(false)
    expect(nameMatchesHost('Motorsport.com', 'motorsport.com')).toBe(true)
  })

  it('sends back a post that credits an outlet other than its link', () => {
    const channel = { channelId: 'c1', service: 'twitter' as const, name: 'GPP', maxLength: null }
    const playbook = {
      name: 'F1',
      about: '',
      sources: [],
      searchQueries: [],
      freshnessHours: 24,
      include: [],
      exclude: [],
      voice: {
        tone: '',
        notes: '',
        avoidSaying: [],
        emoji: 'none' as const,
        hashtags: 'none' as const,
      },
      formats: [],
    }
    const url = 'https://aljazeera.com/sports/2026/10/26/antonelli-wins'
    const post = (text: string) => ({
      storyUrl: url,
      channelId: 'c1',
      text,
      thread: null,
      linkAttachment: null,
    })
    const wrong = checkPost(
      post('Antonelli won the US GP, per Reuters.'),
      channel,
      playbook,
      new Set([url]),
    )
    expect(wrong.ok).toBe(false)
    if (!wrong.ok)
      expect(wrong.reason).toBe(
        'It credits Reuters but the link is to aljazeera.com. Credit the outlet of the link.',
      )
    expect(
      checkPost(post('Antonelli won the US GP, per Al Jazeera.'), channel, playbook, new Set([url]))
        .ok,
    ).toBe(true)
    expect(
      checkPost(
        post('Al Jazeera, citing Reuters, says Antonelli won.'),
        channel,
        playbook,
        new Set([url]),
      ).ok,
    ).toBe(true)
    expect(
      checkPost(post('Antonelli won the US GP from pole.'), channel, playbook, new Set([url])).ok,
    ).toBe(true)
  })
})
