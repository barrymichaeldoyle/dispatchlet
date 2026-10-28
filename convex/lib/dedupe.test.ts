import { describe, expect, it } from 'vitest'
import { canonicalUrl, duplicateOf, titleSimilarity } from './dedupe'

describe('canonical URLs', () => {
  it('drops tracking, fragments, AMP and trailing slashes, and lowercases the host', () => {
    expect(canonicalUrl('HTTP://www.Example.com/news/story/?utm_source=x&fbclid=1#top')).toBe(
      'https://example.com/news/story',
    )
    expect(canonicalUrl('https://amp.example.com/story/amp/')).toBe('https://example.com/story')
    expect(canonicalUrl('https://example.com/?b=2&a=1')).toBe('https://example.com?a=1&b=2')
  })
})

describe('duplicates', () => {
  const covered = [
    {
      title: 'Verstappen wins Mexico City Grand Prix after late safety car',
      canonicalUrl: 'https://formula1.com/mexico-result',
    },
    { title: 'Alpine confirm Colapinto for 2027', canonicalUrl: 'https://the-race.com/colapinto' },
  ]
  it('matches the same page under a different URL', () => {
    const d = duplicateOf(
      {
        title: 'Anything',
        canonicalUrl: 'https://www.formula1.com/mexico-result?utm_medium=social',
      },
      covered,
    )
    expect(d?.by).toBe('url')
  })
  it('matches a retelling by title overlap', () => {
    const d = duplicateOf(
      {
        title: 'Max Verstappen wins the Mexico City Grand Prix after a late safety car',
        canonicalUrl: 'https://espn.com/x',
      },
      covered,
    )
    expect(d?.by).toBe('title')
    expect(d?.match.canonicalUrl).toBe('https://formula1.com/mexico-result')
  })
  it('lets a different story through', () => {
    expect(
      duplicateOf(
        {
          title: 'Ferrari announce new technical director',
          canonicalUrl: 'https://autosport.com/y',
        },
        covered,
      ),
    ).toBeNull()
    expect(
      titleSimilarity(
        'Ferrari announce new technical director',
        'Alpine confirm Colapinto for 2027',
      ),
    ).toBe(0)
  })
})
