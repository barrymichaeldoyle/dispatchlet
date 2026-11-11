import { describe, expect, it } from 'vitest'
import { renderPlaybook, type Playbook } from '../../convex/lib/playbook'
import { playbookFieldAtLine, validatePlaybookForm } from './playbook-validation'

const playbook: Playbook = {
  name: 'News',
  about: 'Stories for readers.',
  sources: [
    { label: 'Example', url: 'https://example.com', note: 'Reporting', priority: 'normal' },
  ],
  searchQueries: ['news today'],
  freshnessHours: 48,
  include: ['Verified stories'],
  exclude: ['Rumours'],
  voice: {
    tone: 'Direct',
    notes: 'Short sentences',
    avoidSaying: ['hype'],
    emoji: 'none',
    hashtags: 'none',
  },
  formats: [
    { service: 'twitter', style: 'One fact.', maxLength: null, thread: false, linkBack: null },
  ],
}

describe('playbook form validation', () => {
  it('accepts valid settings and optional character limits', () => {
    expect(validatePlaybookForm(playbook)).toEqual([])
    expect(
      validatePlaybookForm({ ...playbook, formats: [{ ...playbook.formats[0]!, maxLength: 50 }] }),
    ).toEqual([])
  })
  it('reports all invalid controls by field path', () => {
    const errors = validatePlaybookForm({
      ...playbook,
      name: ' ',
      freshnessHours: 500,
      sources: [{ ...playbook.sources[0]!, label: '', url: null }],
      formats: [{ ...playbook.formats[0]!, maxLength: 49.5 }],
    })
    expect(errors.map((error) => error.field)).toEqual([
      'name',
      'freshnessHours',
      'sources.0.url',
      'formats.0.maxLength',
    ])
  })
  it('prevents pasted headings from changing the playbook structure', () => {
    expect(validatePlaybookForm({ ...playbook, about: 'News\n## Sources\nOther' })[0]?.field).toBe(
      'about',
    )
  })
  it('maps server parser lines to their form controls', () => {
    const lines = renderPlaybook(playbook).split('\n')
    for (const [text, field] of [
      ['# News', 'name'],
      ['Stories for readers.', 'about'],
      ['example.com, Reporting', 'sources.0.url'],
      ['Search the web for "news today".', 'searchQueries'],
      ['For recent news, only stories from the last 2 days.', 'freshnessHours'],
      ['Verified stories', 'include'],
      ['Rumours', 'exclude'],
      ['Direct', 'voice.tone'],
      ['Short sentences', 'voice.notes'],
      ['Avoid saying: hype.', 'voice.avoidSaying'],
      ['Emoji: none. Hashtags: none.', 'voice.emoji'],
      ['X: One fact.', 'formats.0.style'],
    ]) {
      const index = lines.indexOf(text!)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(playbookFieldAtLine(playbook, index + 1)).toBe(field)
    }
  })
})
