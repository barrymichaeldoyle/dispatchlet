import { Playbook, SERVICE_NAMES } from '../playbook'
import { describeCadence } from '../schedule'
import { freshnessFor } from './research'
import type { SetupAnswers } from './setup'

export { Playbook }

export const GENERATE_SYSTEM = `You are Dispatchlet's onboarding editor. The user runs a social presence and wants a recurring research agent that finds genuinely new, worthwhile stories in their niche and turns them into posts for their Buffer channels. From their answers to a few setup questions, write the playbook the agent follows on every run.

Be specific and opinionated:
- Name real sources: the sites, sections, feeds, official bodies and changelogs that break news in this niche. Use web search to confirm each source exists and to find the page that lists its latest stories (a news index, a section page, a releases page). Give that page's URL. Never invent a URL; when unsure, give the name and set url to null. Mark the two or three best sources "high" priority.
- Write concrete search queries a researcher would run, not the user's words back at them.
- Say what counts as worth posting and what does not, as short rules the researcher can apply. Turn each thing the user wants to avoid into an exclude rule in their words.
- Describe the voice from how the user wrote their answers and what the niche expects. Keep it plain. Emoji and hashtags default to none unless the niche clearly uses them.
- Write one format per channel service the user chose, saying how a post reads there and where the link goes. Only allow threads where the service supports them and the niche needs them.
- Keep the name short, as the user would say it.

The schedule, channels, number of stories and posting mode are already set from the answers; do not restate them. Write "about" as one paragraph covering the beat and who reads it.`

export function generateUserMessage(
  setup: SetupAnswers,
  services: string[],
  now: Date,
  timezone: string,
): string {
  const when = now.toLocaleDateString('en-GB', { timeZone: timezone, dateStyle: 'long' })
  const names = services.map((s) => SERVICE_NAMES[s as keyof typeof SERVICE_NAMES] ?? s)
  const lines = [
    `Today is ${when}.`,
    `What should it research? ${setup.research}`,
    `Where should it post? ${names.join(', ')}`,
    `Anything to avoid? ${setup.avoid || 'Nothing given.'}`,
    `Sources you prefer? ${setup.sources.length ? setup.sources.join(', ') : 'None given.'}${setup.onlyTheseSources ? ' Only these sources.' : ''}`,
    `When should it run? ${describeCadence(setup.cadence)}, so stories should be from the last ${freshnessFor(setup.cadence.preset)} hours.`,
    `How many stories a run, at most? ${setup.maxStories}`,
  ]
  return lines.join('\n')
}
