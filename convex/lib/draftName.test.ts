import { describe, expect, it } from 'vitest'
import { draftName } from './draftName'

describe('draftName', () => {
  it('keeps a short answer as it is', () => {
    expect(draftName('  F1 race results  ')).toBe('F1 race results')
  })

  it('ends a long answer at a word, with an ellipsis', () => {
    const name = draftName(
      "Historical Formula 1 related events that happened today's date in previous years",
    )
    expect(name).toBe("Historical Formula 1 related events that happened today's…")
    expect(name.length).toBeLessThanOrEqual(60)
  })

  it('cuts a single long word when there is no space to end at', () => {
    expect(draftName('x'.repeat(80))).toBe(`${'x'.repeat(59)}…`)
  })
})
