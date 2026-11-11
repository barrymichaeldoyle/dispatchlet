import { describe, expect, it } from 'vitest'
import { FIXTURES } from '../../evals/setupAnswers'
import {
  briefFromSetup,
  historicalProblem,
  RESEARCH_SYSTEM,
  RESEARCH_SYSTEM_HISTORICAL,
  researchSystemFor,
  researchUserMessage,
  yearsSince,
} from './research'

const TODAY = '2026-11-16'
const brief = briefFromSetup(FIXTURES[0]!.answers)
const context = { now: new Date('2026-11-16T05:00:00Z'), timezone: 'UTC', covered: [] }

const check = (eventDate: string | null) =>
  historicalProblem({ eventDate, forDate: null }, 'archive', [], TODAY)

describe('historical date checks', () => {
  it('leaves recent research alone', () => {
    expect(historicalProblem({ eventDate: null, forDate: null }, 'recent', [], TODAY)).toBeNull()
  })

  it('needs a real, past event date for history', () => {
    expect(check('1976-10-24')).toBeNull()
    expect(check('1976-10')).toBeNull()
    expect(check('1976')).toBeNull()
    expect(check(null)).toMatch(/No verified date/)
    expect(check('sometime in the 70s')).toMatch(/No verified date/)
    expect(check('1976-13-01')).toMatch(/No verified date/)
    expect(check('2027-01-01')).toMatch(/future/)
  })

  it('needs an exact day matching one of the run’s posting dates for an anniversary', () => {
    const targets = ['2026-11-16', '2026-11-17']
    const onDay = (eventDate: string, forDate: string | null) =>
      historicalProblem({ eventDate, forDate }, 'anniversary', targets, TODAY)
    expect(onDay('1986-11-16', '2026-11-16')).toBeNull()
    expect(onDay('1986-11', '2026-11-16')).toMatch(/exact day/)
    expect(onDay('1986-11-15', '2026-11-16')).toMatch(/same day of the year/)
    expect(onDay('1986-11-18', '2026-11-18')).toMatch(/not for one of/)
    expect(onDay('1986-11-16', null)).toMatch(/not for one of/)
    expect(onDay('2026-11-16', '2026-11-16')).toMatch(/at least a year/)
  })

  it('counts whole years to the posting date', () => {
    expect(yearsSince('1976-10-24', '2026-10-24')).toBe(50)
  })
})

describe('historical research prompts', () => {
  it('replaces the recency rules with verification rules, and only for history', () => {
    expect(researchSystemFor('recent')).toBe(RESEARCH_SYSTEM)
    expect(researchSystemFor('archive')).toBe(RESEARCH_SYSTEM_HISTORICAL)
    expect(RESEARCH_SYSTEM).toContain('inside the freshness window')
    expect(RESEARCH_SYSTEM_HISTORICAL).not.toContain('freshness window')
    expect(RESEARCH_SYSTEM_HISTORICAL).not.toContain('cannot pin the exact time')
    expect(RESEARCH_SYSTEM_HISTORICAL).toContain('When the source was published does not matter')
    expect(RESEARCH_SYSTEM_HISTORICAL).toContain('A wrong date is worse than a missing story')
    expect(RESEARCH_SYSTEM_HISTORICAL).toContain('from the history of one niche')
  })

  it('keeps the freshness line for recent news', () => {
    expect(researchUserMessage(brief, context)).toMatch(/Freshness: published or materially/)
  })

  it('drops the freshness window for history and names the dates for an anniversary', () => {
    const archive = researchUserMessage(brief, { ...context, mode: 'archive' })
    expect(archive).not.toMatch(/Freshness:/)
    expect(archive).toContain('there is no freshness window')
    const onThisDay = researchUserMessage(brief, {
      ...context,
      mode: 'anniversary',
      targetDates: ['2026-11-16', '2026-11-17'],
      batch: { days: 7, stories: 2 },
    })
    expect(onThisDay).toContain('2026-11-16, 2026-11-17')
    expect(onThisDay).toContain('At most one story per date.')
    expect(
      researchUserMessage(brief, { ...context, mode: 'anniversary', targetDates: [TODAY] }),
    ).not.toContain('At most one story per date.')
  })
})
