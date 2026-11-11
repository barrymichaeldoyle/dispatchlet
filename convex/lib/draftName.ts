/**
 * The name an automation wears while its playbook is written, before the playbook names it.
 * Long research answers end at a word, with an ellipsis, rather than mid-word.
 */
export function draftName(research: string, max = 60): string {
  const text = research.trim().replace(/\s+/g, ' ')
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, '')}…`
}
