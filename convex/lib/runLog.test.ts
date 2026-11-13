import { describe, expect, it } from 'vitest'
import { shortUrl, toolInput, toolNote } from './runLog'

describe('toolNote', () => {
  it('says what was searched and read, in plain words', () => {
    expect(toolNote({ tool: 'web_search', input: 'F1 stewards', error: null })).toBe(
      'Searched “F1 stewards”.',
    )
    expect(
      toolNote({ tool: 'web_fetch', input: 'https://www.formula1.com/en/latest/', error: null }),
    ).toBe('Read formula1.com/en/latest.')
  })

  it('explains failures without error codes, and keeps the model’s own slips out', () => {
    const note = toolNote({
      tool: 'web_fetch',
      input: 'https://www.statsf1.com/en/',
      error: 'url_not_allowed',
    })
    expect(note).toBe('Could not open statsf1.com/en: the site does not allow automated readers.')
    expect(note).not.toMatch(/url_not/)
    expect(
      toolNote({ tool: 'web_fetch', input: 'https://x.com/a', error: 'url_not_in_prior_context' }),
    ).toBeNull()
    expect(toolNote({ tool: 'web_search', input: 'q', error: 'max_uses_exceeded' })).toMatch(
      /every search/,
    )
  })
})

describe('toolInput and shortUrl', () => {
  it('finds the query or URL whatever key the model used', () => {
    expect(toolInput('web_search', { query: 'a' })).toBe('a')
    expect(toolInput('web_fetch', { url: 'https://b.com' })).toBe('https://b.com')
    expect(toolInput('web_fetch', { query: 'not a url' })).toBe('not a url')
    expect(toolInput('web_search', null)).toBe('')
  })

  it('shortens long URLs', () => {
    expect(shortUrl(`https://a.com/${'x'.repeat(100)}`)).toHaveLength(68)
  })
})
