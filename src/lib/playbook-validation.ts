import { parsePlaybook, renderPlaybook, type Playbook } from '../../convex/lib/playbook'

export type PlaybookFieldError = { field: string; message: string }

/** Map the serialized playbook's line back to the control that wrote it. */
export function playbookFieldAtLine(playbook: Playbook, line: number): string {
  let section = ''
  let index = 0
  const lines = renderPlaybook(playbook).split('\n')
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!
    if (text.startsWith('## ')) {
      section = text.slice(3)
      index = 0
    } else if (text.trim()) {
      let field = 'name'
      if (section === 'About') field = 'about'
      if (section === 'Sources') field = `sources.${index}.url`
      if (section === 'Searches') field = 'searchQueries'
      if (section === 'Post about') field = index === 0 ? 'freshnessHours' : 'include'
      if (section === 'Skip') field = 'exclude'
      if (section === 'Tone') {
        field = text.startsWith('Avoid saying:')
          ? 'voice.avoidSaying'
          : text.startsWith('Emoji:')
            ? 'voice.emoji'
            : index === 0
              ? 'voice.tone'
              : 'voice.notes'
      }
      if (section === 'Formats') field = `formats.${index}.style`
      if (i + 1 >= line) return field
      index++
    }
  }
  return 'name'
}

export function validatePlaybookForm(playbook: Playbook): PlaybookFieldError[] {
  const errors: PlaybookFieldError[] = []
  if (!playbook.name.trim() || playbook.name.trim().length > 60)
    errors.push({ field: 'name', message: 'Enter a name between 1 and 60 characters.' })
  if (
    !Number.isInteger(playbook.freshnessHours) ||
    playbook.freshnessHours < 6 ||
    playbook.freshnessHours > 336
  )
    errors.push({
      field: 'freshnessHours',
      message: 'Choose a story age between 6 hours and 14 days.',
    })
  playbook.sources.forEach((source, index) => {
    if (!(source.url ?? source.label).trim())
      errors.push({
        field: `sources.${index}.url`,
        message: 'Enter a website or publisher, or remove this source.',
      })
  })
  playbook.formats.forEach((format, index) => {
    if (format.maxLength !== null && (!Number.isInteger(format.maxLength) || format.maxLength < 50))
      errors.push({
        field: `formats.${index}.maxLength`,
        message: 'Enter a whole number of at least 50 characters, or leave this blank.',
      })
  })
  // Headings pasted into a prose field would otherwise be interpreted as playbook structure.
  const prose: [string, string][] = [
    ['about', playbook.about],
    ['include', playbook.include.join('\n')],
    ['exclude', playbook.exclude.join('\n')],
    ['voice.tone', playbook.voice.tone],
    ['voice.notes', playbook.voice.notes],
    ...playbook.sources.map((source, index): [string, string] => [
      `sources.${index}.url`,
      source.url ?? source.label,
    ]),
  ]
  for (const [field, value] of prose) {
    if (/^\s*#/m.test(value))
      errors.push({
        field,
        message: 'Remove the # at the start of the line. Section headings belong in the Text view.',
      })
  }
  if (!errors.length) {
    const parsed = parsePlaybook(renderPlaybook(playbook))
    if (!parsed.ok)
      errors.push({ field: playbookFieldAtLine(playbook, parsed.line), message: parsed.message })
  }
  return errors
}
