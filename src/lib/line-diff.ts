export type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string }

/**
 * A line diff by longest common subsequence, for reviewing playbook changes. Playbooks are
 * capped in size, but very long inputs fall back to "all removed, all added" to stay cheap.
 */
export function lineDiff(before: string, after: string, maxCells = 4_000_000): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')
  if (a.length * b.length > maxCells)
    return [
      ...a.map((text) => ({ kind: 'removed' as const, text })),
      ...b.map((text) => ({ kind: 'added' as const, text })),
    ]
  const width = b.length + 1
  const table = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!)
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! })
      i++
      j++
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      out.push({ kind: 'removed', text: a[i++]! })
    } else {
      out.push({ kind: 'added', text: b[j++]! })
    }
  }
  while (i < a.length) out.push({ kind: 'removed', text: a[i++]! })
  while (j < b.length) out.push({ kind: 'added', text: b[j++]! })
  return out
}

/** Keeps changed lines and a little context, collapsing long unchanged runs into a gap marker. */
export function diffHunks(
  lines: DiffLine[],
  context = 2,
): (DiffLine | { kind: 'gap'; count: number })[] {
  const keep = lines.map(() => false)
  lines.forEach((line, index) => {
    if (line.kind === 'same') return
    for (
      let k = Math.max(0, index - context);
      k <= Math.min(lines.length - 1, index + context);
      k++
    )
      keep[k] = true
  })
  const out: (DiffLine | { kind: 'gap'; count: number })[] = []
  let gap = 0
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (gap) out.push({ kind: 'gap', count: gap })
      gap = 0
      out.push(line)
    } else gap++
  })
  if (gap) out.push({ kind: 'gap', count: gap })
  return out
}
