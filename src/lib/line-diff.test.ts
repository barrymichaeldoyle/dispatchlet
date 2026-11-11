import { describe, expect, it } from 'vitest'
import { diffHunks, lineDiff } from './line-diff'

describe('lineDiff', () => {
  it('marks changed lines and keeps unchanged ones', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc\nd')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'B' },
      { kind: 'same', text: 'c' },
      { kind: 'added', text: 'd' },
    ])
  })

  it('returns only unchanged lines for identical text', () => {
    expect(lineDiff('x\ny', 'x\ny').every((line) => line.kind === 'same')).toBe(true)
  })

  it('falls back to a full replacement for very large inputs', () => {
    expect(lineDiff('a\nb', 'c', 1)).toEqual([
      { kind: 'removed', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'c' },
    ])
  })
})

describe('diffHunks', () => {
  it('collapses long unchanged runs around changes', () => {
    const before = Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n')
    const after = before.replace('l5', 'L5')
    expect(diffHunks(lineDiff(before, after), 1)).toEqual([
      { kind: 'gap', count: 4 },
      { kind: 'same', text: 'l4' },
      { kind: 'removed', text: 'l5' },
      { kind: 'added', text: 'L5' },
      { kind: 'same', text: 'l6' },
      { kind: 'gap', count: 3 },
    ])
  })
})
