import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The signed-in home page, rendered for real with Convex and the router faked: each query
 * answers from `queries`, each mutation is a spy, and Link is a plain anchor. So the page can be
 * tested without signing in to Buffer.
 */

const queries = new Map<string, unknown>()
const mutations = new Map<string, ReturnType<typeof vi.fn>>()
const navigate = vi.fn()

/** The spy for a mutation or action, made on first use so a test can set its own first. */
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

vi.mock('@convex-dev/auth/react', () => ({
  useAuthActions: () => ({ signIn: vi.fn(), signOut: vi.fn() }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: ({
    to,
    params,
    hash,
    children,
    className,
    'aria-label': label,
  }: {
    to: string
    params?: Record<string, string>
    hash?: string
    children: ReactNode
    className?: string
    'aria-label'?: string
  }) => {
    let href = to
    for (const [key, value] of Object.entries(params ?? {})) href = href.replace(`$${key}`, value)
    return (
      <a href={hash ? `${href}#${hash}` : href} className={className} aria-label={label}>
        {children}
      </a>
    )
  },
}))

const { AppHome } = await import('./app-pages')

const HOUR = 3_600_000
// 11 Nov 2026, 18:00 UTC.
const NOW = Date.UTC(2026, 10, 11, 18, 0)

function viewer(over: Record<string, unknown> = {}) {
  return {
    email: 'a@example.com',
    name: 'Barry Doyle',
    image: null,
    bufferId: 'b',
    timezone: 'UTC',
    allowed: true,
    ownKey: false,
    runsLeft: 8,
    runsAllowed: 10,
    dryRunsLeft: 3,
    keyInvalid: false,
    ...over,
  }
}

function automation(over: Record<string, unknown> = {}) {
  return {
    _id: 'a1',
    name: 'F1 On This Day',
    status: 'active',
    cadence: { preset: 'daily', time: '09:00', weekday: null },
    timezone: 'UTC',
    nextRunAt: NOW + 15 * HOUR,
    lastRun: {
      _id: 'r-today',
      startedAt: NOW - 9 * HOUR,
      finished: true,
      status: 'done',
      kind: 'scheduled',
      note: 'Done. 1 post in Buffer.',
      posted: 1,
      kept: 1,
    },
    postsThisWeek: 1,
    postTimes: [NOW - 9 * HOUR],
    weekRuns: [
      { _id: 'r-today', at: NOW - 9 * HOUR, status: 'done' },
      { _id: 'r-failed', at: NOW - 57 * HOUR, status: 'failed' },
    ],
    canRun: true,
    running: false,
    ...over,
  }
}

function post(over: Record<string, unknown> = {}) {
  return {
    _id: 'p1',
    runId: 'r-today',
    automationId: 'a1',
    automationName: 'F1 On This Day',
    channelName: 'GrandPrixPicks',
    channelAvatar: null,
    channelId: 'c1',
    bufferPostId: 'bp1',
    service: 'twitter',
    status: 'sent',
    text: 'Senna wins at Suzuka.',
    createdAt: NOW - 9 * HOUR,
    at: NOW - 9 * HOUR,
    ...over,
  }
}

function dashboard(over: Record<string, unknown> = {}) {
  return {
    automations: [automation()],
    drafts: [],
    postsThisWeek: 2,
    nextRunAt: NOW + 15 * HOUR,
    nextRunName: 'F1 On This Day',
    recent: [post()],
    upcoming: null,
    timezone: 'UTC',
    ...over,
  }
}

function show({ data = dashboard(), user = viewer() } = {}) {
  queries.set('users:viewer', user)
  queries.set('automations:dashboard', data)
  return render(<AppHome />)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  cleanup()
  queries.clear()
  mutations.clear()
  navigate.mockReset()
  vi.useRealTimers()
})

describe('the status line under the greeting', () => {
  it('says all is well and when the next run is', () => {
    show()
    expect(screen.getByRole('status')).toHaveProperty(
      'textContent',
      'All good. F1 On This Day runs tomorrow, 09:00.',
    )
  })

  it('prefers the next post in Buffer over the next run', () => {
    show({ data: dashboard({ upcoming: post({ status: 'scheduled', at: NOW + 2 * HOUR }) }) })
    expect(screen.getByRole('status').textContent).toBe(
      'All good. The next post goes out today, 20:00.',
    )
  })

  it('puts a failing automation first, ahead of approvals', () => {
    show({
      data: dashboard({
        automations: [automation({ status: 'failed', name: 'Tech digest' })],
        drafts: [
          {
            _id: 'd1',
            runId: 'r-today',
            automationId: 'a1',
            channelName: 'GrandPrixPicks',
            channelId: 'c1',
            bufferPostId: 'bd1',
            service: 'twitter',
            text: 'A draft.',
            limit: 280,
            createdAt: NOW - HOUR,
          },
        ],
      }),
    })
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('Tech digest stopped after failed runs. Take a look.')
    expect(status.dataset.tone).toBe('warn')
  })

  it('names a rejected key, then used-up runs, then approvals', () => {
    const { unmount } = show({ user: viewer({ keyInvalid: true, runsLeft: 0 }) })
    expect(screen.getByRole('status').textContent).toMatch(/Anthropic turned down your key/)
    unmount()
    show({ user: viewer({ runsLeft: 0 }) })
    expect(screen.getByRole('status').textContent).toMatch(/free runs are used up/)
  })

  it('says when nothing is scheduled', () => {
    show({
      data: dashboard({
        automations: [automation({ status: 'paused' })],
        nextRunAt: null,
        nextRunName: null,
      }),
    })
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('Nothing is scheduled. Turn an automation on to start posting.')
    expect(status.dataset.tone).toBe('idle')
  })
})

describe('the figures', () => {
  it('shows free runs as "8 of 10" without a key link while there are plenty', () => {
    show()
    const runs = screen.getByText('Free runs left').closest('div')!
    expect(runs.textContent).toContain('8 of 10')
    expect(within(runs).queryByRole('link')).toBeNull()
  })

  it('offers the key link when three or fewer are left', () => {
    show({ user: viewer({ runsLeft: 3 }) })
    const runs = screen.getByText('Free runs left').closest('div')!
    expect(runs.dataset.attention).toBe('true')
    expect(within(runs).getByRole('link', { name: 'Add your Anthropic key' })).toHaveProperty(
      'href',
      expect.stringContaining('/app/settings#anthropic'),
    )
  })

  it('says "On your key" with a key of their own', () => {
    show({ user: viewer({ ownKey: true, runsLeft: null }) })
    expect(screen.getByText('On your key')).toBeTruthy()
  })

  it('leaves out approvals at zero, and links the count to the drafts when there are some', () => {
    const { unmount } = show()
    expect(screen.queryByText('Awaiting approval')).toBeNull()
    unmount()
    show({
      data: dashboard({
        drafts: [
          {
            _id: 'd1',
            runId: 'r-today',
            automationId: 'a1',
            channelName: 'GrandPrixPicks',
            channelId: 'c1',
            bufferPostId: 'bd1',
            service: 'twitter',
            text: 'A draft.',
            limit: 280,
            createdAt: NOW - HOUR,
          },
        ],
      }),
    })
    const cell = screen.getByText('Awaiting approval', { selector: 'dt' }).closest('div')!
    expect(within(cell).getByRole('link', { name: '1' }).getAttribute('href')).toBe('#approvals')
  })

  it('gives the next run as a figure only when several automations share the page', () => {
    const { unmount } = show()
    expect(screen.queryByText('Next run', { selector: 'dt' })).toBeNull()
    unmount()
    show({
      data: dashboard({
        automations: [automation(), automation({ _id: 'a2', name: 'Tech digest' })],
        nextRunName: 'Tech digest',
      }),
    })
    const next = screen.getByText('Next run', { selector: 'dt' }).closest('div')!
    expect(next.textContent).toContain('Tomorrow, 09:00')
    expect(next.textContent).toContain('Tech digest')
  })
})

describe('Up next and recent posts', () => {
  it('shows the Up next card only when a post is waiting', () => {
    const { unmount } = show()
    expect(screen.queryByRole('heading', { name: 'Up next' })).toBeNull()
    unmount()
    show({
      data: dashboard({
        upcoming: post({ _id: 'p2', status: 'scheduled', at: NOW + 15 * HOUR, text: 'Prost.' }),
      }),
    })
    const card = screen.getByRole('heading', { name: 'Up next' }).closest('section')!
    expect(card.textContent).toContain('Scheduled')
    expect(card.textContent).toContain('for tomorrow, 09:00')
    expect(card.textContent).toContain('Prost.')
  })

  it('links each recent post to Buffer and to its run', () => {
    show()
    const recent = screen.getByRole('heading', { name: 'Recent posts' }).closest('section')!
    expect(
      within(recent).getByRole('link', { name: /^Open in Buffer.*the GrandPrixPicks post/ }),
    ).toHaveProperty('href', 'https://publish.buffer.com/posts/bp1')
    expect(within(recent).getByRole('link', { name: 'From F1 On This Day' })).toHaveProperty(
      'href',
      expect.stringContaining('/app/a/a1/runs/r-today'),
    )
  })

  it('says so when nothing went to Buffer this week', () => {
    show({ data: dashboard({ recent: [] }) })
    expect(screen.getByText(/Nothing has gone to Buffer in the last week/)).toBeTruthy()
  })
})

describe('an automation row', () => {
  it('starts a run and opens it', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
    mutations.set('runs:trigger', vi.fn().mockResolvedValue('r-new'))
    show()
    await user.click(screen.getByRole('button', { name: 'Run now F1 On This Day' }))
    expect(mutations.get('runs:trigger')).toHaveBeenCalledWith({ automationId: 'a1', dry: false })
    expect(navigate).toHaveBeenCalledWith({
      to: '/app/a/$id/runs/$runId',
      params: { id: 'a1', runId: 'r-new' },
    })
  })

  it('pauses an active automation and resumes a paused one', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
    const { unmount } = show()
    await user.click(screen.getByRole('button', { name: 'Pause F1 On This Day' }))
    expect(mutations.get('automations:setStatus')).toHaveBeenCalledWith({
      id: 'a1',
      status: 'paused',
    })
    unmount()
    mutations.clear()
    show({ data: dashboard({ automations: [automation({ status: 'paused' })] }) })
    await user.click(screen.getByRole('button', { name: 'Resume F1 On This Day' }))
    expect(mutations.get('automations:setStatus')).toHaveBeenCalledWith({
      id: 'a1',
      status: 'active',
    })
  })

  it('shows the error when starting a run fails', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
    mutations.set('runs:trigger', vi.fn().mockRejectedValue(new Error('No free runs left.')))
    show()
    await user.click(screen.getByRole('button', { name: 'Run now F1 On This Day' }))
    expect((await screen.findByRole('alert')).textContent).toBe('No free runs left.')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('holds Run now while a run is going, and hides the actions without a playbook', () => {
    const { unmount } = show({
      data: dashboard({
        automations: [
          automation({
            running: true,
            lastRun: { ...automation().lastRun, startedAt: NOW - 5 * 60_000, finished: false },
          }),
        ],
      }),
    })
    expect(screen.getByRole('button', { name: 'Running F1 On This Day' })).toHaveProperty(
      'disabled',
      true,
    )
    unmount()
    show({ data: dashboard({ automations: [automation({ canRun: false })] }) })
    expect(screen.queryByRole('button', { name: /^Run now/ })).toBeNull()
  })

  it('opens each day’s run from the week strip and marks the failed day', () => {
    show()
    const strip = screen.getByRole('list', { name: 'Posts in the last seven days' })
    const today = within(strip).getByRole('link', { name: /: 1 post\. Open the run\./ })
    expect(today.getAttribute('href')).toBe('/app/a/a1/runs/r-today')
    const failed = within(strip).getByRole('link', { name: /run failed\. Open the run\./ })
    expect(failed.getAttribute('href')).toBe('/app/a/a1/runs/r-failed')
    expect(failed.textContent).toBe('!')
    expect(failed.closest('li')!.dataset.failed).toBe('true')
    // Days without a run are not links.
    expect(within(strip).getAllByRole('link')).toHaveLength(2)
  })

  it('links the last run by when it happened', () => {
    show()
    expect(screen.getByRole('link', { name: 'Today, 09:00' }).getAttribute('href')).toBe(
      '/app/a/a1/runs/r-today',
    )
  })
})
