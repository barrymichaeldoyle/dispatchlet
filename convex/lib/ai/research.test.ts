import { describe, expect, it } from 'vitest'
import { FIXTURES } from '../../evals/setupAnswers'
import {
  allowedDomains,
  briefFromSetup,
  freshnessFor,
  lookbackHours,
  researchUserMessage,
} from './research'
import { hostOf, SetupAnswers } from './setup'

const f1 = FIXTURES[0]!.answers
const rust = FIXTURES[4]!.answers

describe('the research brief from the setup answers', () => {
  it('accepts every fixture as valid setup answers', () => {
    for (const fixture of FIXTURES)
      expect(SetupAnswers.safeParse(fixture.answers).success).toBe(true)
  })

  it('turns "anything to avoid" into exclude rules, one per phrase', () => {
    expect(briefFromSetup(f1).exclude).toEqual(['Rumours without a named source', 'betting'])
    expect(briefFromSetup(FIXTURES[9]!.answers).exclude).toEqual([])
  })

  it('looks two days back for daily runs and a week and a day for weekly ones', () => {
    expect(freshnessFor('daily')).toBe(48)
    expect(freshnessFor('weekly')).toBe(192)
    expect(briefFromSetup(rust).freshnessHours).toBe(192)
  })

  it('asks for at most the number of stories the user chose', () => {
    expect(briefFromSetup(FIXTURES[8]!.answers).maxCandidates).toBe(1)
  })
})

describe('allowed domains', () => {
  it('restricts the web tools only when the user ticked "only these sources"', () => {
    expect(allowedDomains(briefFromSetup(f1))).toBeUndefined()
    expect(allowedDomains(briefFromSetup(rust))).toEqual(['github.com', 'blog.rust-lang.org'])
  })

  it('reads hosts out of URLs, paths and bare names, and drops what is not a host', () => {
    expect(hostOf('https://www.positive.news/feed')).toBe('positive.news')
    expect(hostOf('bbc.co.uk/sport')).toBe('bbc.co.uk')
    expect(hostOf('The Race')).toBeNull()
    expect(hostOf('')).toBeNull()
  })
})

describe('the research user message', () => {
  const context = {
    now: new Date('2026-10-28T06:00:00Z'),
    timezone: 'Africa/Johannesburg',
    covered: [{ title: 'Verstappen wins in Mexico', url: 'https://formula1.com/x' }],
  }

  it("says when it is in the user's zone, what to skip, and what is already covered", () => {
    const text = researchUserMessage(briefFromSetup(f1), context)
    expect(text).toMatch(/Now: Wednesday,? 28 October 2026 at 08:00 \(Africa\/Johannesburg\)\./)
    expect(text).toContain('Skip: Rumours without a named source; betting.')
    expect(text).toContain(
      'Preferred sources: formula1.com, the-race.com, autosport.com. Other reliable',
    )
    expect(text).toContain('- Verstappen wins in Mexico (https://formula1.com/x)')
    expect(text).toContain('Return at most 3 candidates.')
  })

  it('says sources are the only ones when the user ticked that', () => {
    expect(researchUserMessage(briefFromSetup(rust), { ...context, covered: [] })).toContain(
      'Sources, and only these: github.com, blog.rust-lang.org.\nNothing has been covered yet.',
    )
  })

  it('looks back twice as far on the first run, up to two weeks', () => {
    const text = researchUserMessage(briefFromSetup(f1), { ...context, covered: [] })
    expect(text).toContain('in the last 96 hours. This is the first run')
    expect(researchUserMessage(briefFromSetup(f1), context)).toContain('in the last 48 hours.')
    expect(lookbackHours(192, 0)).toBe(336)
    expect(lookbackHours(300, 0)).toBe(336)
  })

  it('shows at most a hundred covered stories', () => {
    const covered = Array.from({ length: 150 }, (_, i) => ({ title: `t${i}`, url: `u${i}` }))
    const text = researchUserMessage(briefFromSetup(f1), { ...context, covered })
    expect(text).toContain('- t99 (u99)')
    expect(text).not.toContain('- t100 (u100)')
  })
})
