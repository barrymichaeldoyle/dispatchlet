import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderPlaybook, type Playbook } from '../../convex/lib/playbook'

/*
 * The automation page, rendered with Convex and the router faked in the same way as
 * app-home.test.tsx: each query answers from `queries`, each mutation is a spy.
 */

const queries = new Map<string, unknown>()
const mutations = new Map<string, ReturnType<typeof vi.fn>>()

function spyFor(name: string) {
  if (!mutations.has(name)) mutations.set(name, vi.fn().mockResolvedValue(null))
  return mutations.get(name)!
}

vi.mock('convex/react', async () => {
  const { getFunctionName } = await import('convex/server')
  return {
    useQuery: (ref: unknown, args?: unknown) =>
      args === 'skip' ? undefined : queries.get(getFunctionName(ref as never)),
    useMutation: (ref: unknown) => spyFor(getFunctionName(ref as never)),
    useAction: (ref: unknown) => spyFor(getFunctionName(ref as never)),
  }
})

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useBlocker: () => ({ status: 'idle' }),
  Link: ({ to, hash, children }: { to: string; hash?: string; children: ReactNode }) => (
    <a href={hash ? `${to}#${hash}` : to}>{children}</a>
  ),
}))

const { AutomationPage } = await import('./app-automation')

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

function automation(allowance: {
  ownKey: boolean
  runsLeft: number | null
  dryRunsLeft: number | null
}) {
  return {
    _id: 'a1',
    name: 'News',
    status: 'ready',
    cadence: { preset: 'daily', time: '09:00', weekday: null },
    timezone: 'UTC',
    postingMode: 'draft',
    maxPostsPerRun: 1,
    publicationPlan: null,
    researchMode: 'recent',
    channelIds: [],
    nextRunAt: null,
    lastRunAt: null,
    generationError: null,
    version: 1,
    revision: 0,
    playbook,
    text: renderPlaybook(playbook),
    playbookCreatedBy: 'ai',
    channels: [],
    allowance,
  }
}

const dryRun = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Dry run' })

beforeEach(() => {
  queries.clear()
  mutations.clear()
  queries.set('runs:listByAutomation', [])
})
afterEach(cleanup)

describe('the dry run button', () => {
  it('starts a dry run while free dry runs are left', async () => {
    queries.set('automations:get', automation({ ownKey: false, runsLeft: 10, dryRunsLeft: 2 }))
    render(<AutomationPage id={'a1' as never} />)
    expect(dryRun().disabled).toBe(false)
    await userEvent.click(dryRun())
    expect(spyFor('runs:trigger')).toHaveBeenCalledWith({ automationId: 'a1', dry: true })
  })

  it('is disabled and points to settings when no free dry runs are left', async () => {
    queries.set('automations:get', automation({ ownKey: false, runsLeft: 10, dryRunsLeft: 0 }))
    render(<AutomationPage id={'a1' as never} />)
    expect(dryRun().disabled).toBe(true)
    const note = document.getElementById(dryRun().getAttribute('aria-describedby') ?? '')
    expect(note?.textContent).toBe(
      'No dry runs left. Add your own Anthropic key to do more dry runs.',
    )
    expect(
      screen.getByRole('link', { name: 'Add your own Anthropic key' }).getAttribute('href'),
    ).toBe('/app/settings#anthropic')
    await userEvent.click(dryRun())
    expect(spyFor('runs:trigger')).not.toHaveBeenCalled()
  })

  it('stays enabled on the person’s own key', () => {
    queries.set('automations:get', automation({ ownKey: true, runsLeft: null, dryRunsLeft: null }))
    render(<AutomationPage id={'a1' as never} />)
    expect(dryRun().disabled).toBe(false)
  })
})
