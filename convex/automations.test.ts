import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { cadenceProblem, normalCadence } from './automations'
import schema from './schema'

const modules = import.meta.glob('./**/*.*s')

const setup = {
  research: 'Formula 1 news',
  services: ['twitter'],
  avoid: 'Rumours',
  sources: ['formula1.com'],
  onlyTheseSources: false,
  maxStories: 2,
  postingMode: 'draft' as const,
  cadence: { preset: 'daily' as const, time: '08:00', weekday: null },
}

const playbook = {
  name: 'F1 news',
  about: 'Race weekends.',
  sources: [],
  searchQueries: [],
  freshnessHours: 48,
  include: [],
  exclude: [],
  voice: { tone: 'Dry.', notes: '', avoidSaying: [], emoji: 'none', hashtags: 'none' },
  formats: [{ service: 'twitter', style: 'Short.', maxLength: null, thread: true, linkBack: null }],
}

/** A signed-in person with an X channel, a LinkedIn channel and an Instagram channel. */
async function person(t: ReturnType<typeof convexTest>, generationsToday = 0) {
  const userId = await t.run(async (ctx) => {
    const owner = await ctx.db.insert('users', {
      email: 'a@example.com',
      timezone: 'Africa/Johannesburg',
      emailPrefs: 'never',
      generationDay: new Date().toISOString().slice(0, 10),
      generationsToday,
    })
    for (const [channelId, service] of [
      ['x1', 'twitter'],
      ['li1', 'linkedin'],
      ['ig1', 'instagram'],
    ] as const)
      await ctx.db.insert('bufferChannels', {
        userId: owner,
        organizationId: 'org',
        channelId,
        service,
        name: service,
        usable: true,
        syncedAt: 0,
      })
    return owner
  })
  return { userId, user: t.withIdentity({ subject: `${userId}|session` }) }
}

async function scheduled(t: ReturnType<typeof convexTest>) {
  return await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())
}

describe('creating an automation from the setup answers', () => {
  it('keeps the text channels, names the services from them, and asks for a playbook', async () => {
    const t = convexTest(schema, modules)
    const { userId, user } = await person(t)
    const id = await user.mutation(api.automations.create, {
      setup,
      channelIds: ['x1', 'li1', 'ig1', 'not-mine'],
    })
    const automation = await t.run((ctx) => ctx.db.get(id))
    expect(automation).toMatchObject({
      userId,
      name: 'Formula 1 news',
      status: 'generating',
      channelIds: ['x1', 'li1'],
      timezone: 'Africa/Johannesburg',
      postingMode: 'draft',
      maxPostsPerRun: 2,
    })
    expect(automation?.setup.services).toEqual(['twitter', 'linkedin'])
    const pending = await scheduled(t)
    expect(pending.map((f) => f.name)).toEqual(['playbooks:generate'])
    expect(pending[0]?.args).toEqual([{ automationId: id }])
    const me = await t.run((ctx) => ctx.db.get(userId))
    expect(me?.generationsToday).toBe(1)
  })

  it('refuses without a text channel of the person', async () => {
    const t = convexTest(schema, modules)
    const { user } = await person(t)
    await expect(
      user.mutation(api.automations.create, { setup, channelIds: ['ig1', 'not-mine'] }),
    ).rejects.toThrow('Pick at least one channel')
    expect(await t.run((ctx) => ctx.db.query('automations').collect())).toHaveLength(0)
  })

  it('refuses once the day of playbook generations is used up', async () => {
    const t = convexTest(schema, modules)
    const { user } = await person(t, 10)
    await expect(
      user.mutation(api.automations.create, { setup, channelIds: ['x1'] }),
    ).rejects.toThrow('No playbook generations left today')
  })

  it('refuses when signed out', async () => {
    const t = convexTest(schema, modules)
    await person(t)
    await expect(t.mutation(api.automations.create, { setup, channelIds: ['x1'] })).rejects.toThrow(
      'Not signed in',
    )
  })
})

/** An automation whose playbook is still being written. */
async function generating(t: ReturnType<typeof convexTest>) {
  const { userId, user } = await person(t)
  const id = await user.mutation(api.automations.create, { setup, channelIds: ['x1'] })
  return { userId, id }
}

describe('when the playbook comes back', () => {
  it('stores the first version, marks the automation ready, and starts its dry run', async () => {
    const t = convexTest(schema, modules)
    const { userId, id } = await generating(t)
    await t.mutation(internal.automations.storeGenerated, { automationId: id, playbook })
    const automation = await t.run((ctx) => ctx.db.get(id))
    expect(automation?.status).toBe('ready')
    expect(automation?.name).toBe('F1 news')
    const version = await t.run((ctx) =>
      ctx.db.get(automation!.playbookVersionId as Id<'playbookVersions'>),
    )
    expect(version).toMatchObject({ version: 1, createdBy: 'ai' })
    expect(version?.text).toContain('# F1 news')
    expect((await t.run((ctx) => ctx.db.get(userId)))?.firstPlaybookAt).toBeTypeOf('number')
    const names = (await scheduled(t)).map((f) => f.name)
    expect(names).toContain('runs:firstDryRun')
  })

  it('reports a failed generation and keeps the automation', async () => {
    const t = convexTest(schema, modules)
    const { id } = await generating(t)
    await t.mutation(internal.automations.storeGenerated, {
      automationId: id,
      playbook: null,
      error: 'The model was busy.',
    })
    const automation = await t.run((ctx) => ctx.db.get(id))
    expect(automation).toMatchObject({ status: 'failed', generationError: 'The model was busy.' })
    expect(await t.run((ctx) => ctx.db.query('playbookVersions').collect())).toHaveLength(0)
  })

  it('keeps an active automation on and scheduled when writing it again fails', async () => {
    const t = convexTest(schema, modules)
    const { id } = await generating(t)
    await t.mutation(internal.automations.storeGenerated, { automationId: id, playbook })
    // Turned on, then "Write it again" while its next run is booked.
    const fn = await t.run(async (ctx) => {
      const fnId = await ctx.scheduler.runAfter(3_600_000, internal.runs.start, {
        automationId: id,
      })
      await ctx.db.patch(id, { status: 'generating', scheduledFnId: fnId })
      return fnId
    })
    await t.mutation(internal.automations.storeGenerated, {
      automationId: id,
      playbook: null,
      error: 'The model was busy.',
    })
    const automation = await t.run((ctx) => ctx.db.get(id))
    expect(automation?.status).toBe('active')
    expect(automation?.scheduledFnId).toBeDefined()
    expect(automation?.scheduledFnId).not.toBe(fn)
    expect(automation?.nextRunAt).toBeTypeOf('number')
  })
})

describe('checking a cadence before it is saved', () => {
  it('wants a real time of day and a weekday for weekly runs', () => {
    expect(cadenceProblem({ preset: 'daily', time: '08:00', weekday: null })).toBeNull()
    expect(cadenceProblem({ preset: 'daily', time: '25:00', weekday: null })).toMatch(/HH:MM/)
    expect(cadenceProblem({ preset: 'daily', time: '8am', weekday: null })).toMatch(/HH:MM/)
    expect(cadenceProblem({ preset: 'weekly', time: '08:00', weekday: null })).toMatch(/weekday/)
    expect(cadenceProblem({ preset: 'weekly', time: '08:00', weekday: 'funday' })).toMatch(
      /weekday/,
    )
    expect(cadenceProblem({ preset: 'weekly', time: '08:00', weekday: 'Monday' })).toBeNull()
  })

  it('stores the weekday the way the scheduler reads it', () => {
    expect(normalCadence({ preset: 'weekly', time: '08:00', weekday: 'Monday' })).toEqual({
      preset: 'weekly',
      time: '08:00',
      weekday: 'mon',
    })
    expect(normalCadence({ preset: 'daily', time: '08:00', weekday: 'mon' }).weekday).toBeNull()
  })
})

describe('a source that keeps failing', () => {
  const withSources = {
    ...playbook,
    sources: [
      { label: 'F1', note: '', priority: 'high', url: 'https://www.formula1.com/en/latest' },
      { label: 'StatsF1', note: '', priority: 'high', url: 'https://www.statsf1.com/en/' },
    ],
  }

  it('is flagged after two failed runs, cleared when it opens, and removed as a new version', async () => {
    const t = convexTest(schema, modules)
    const { userId, id } = await generating(t)
    const user = t.withIdentity({ subject: `${userId}|session` })
    await t.mutation(internal.automations.storeGenerated, {
      automationId: id,
      playbook: withSources,
    })
    const note = (failed: string[], ok: string[] = []) =>
      t.mutation(internal.automations.noteSourceHealth, { automationId: id, failed, ok })
    await note(['statsf1.com'])
    expect((await user.query(api.automations.get, { id }))?.failingSources).toEqual([])
    await note(['statsf1.com'])
    expect((await user.query(api.automations.get, { id }))?.failingSources).toEqual([
      { host: 'statsf1.com', failures: 2 },
    ])
    await note([], ['statsf1.com'])
    expect((await user.query(api.automations.get, { id }))?.failingSources).toEqual([])
    await note(['statsf1.com'])
    await note(['statsf1.com'])
    expect(await user.mutation(api.automations.removeSource, { id, host: 'statsf1.com' })).toBe(2)
    const after = await user.query(api.automations.get, { id })
    expect(after?.failingSources).toEqual([])
    expect(after?.playbook?.sources.map((s) => s.label)).toEqual(['F1'])
  })

  it('stops flagging a source the person chose to keep', async () => {
    const t = convexTest(schema, modules)
    const { userId, id } = await generating(t)
    const user = t.withIdentity({ subject: `${userId}|session` })
    await t.mutation(internal.automations.storeGenerated, {
      automationId: id,
      playbook: withSources,
    })
    for (let i = 0; i < 3; i++)
      await t.mutation(internal.automations.noteSourceHealth, {
        automationId: id,
        failed: ['statsf1.com'],
        ok: [],
      })
    await user.mutation(api.automations.keepSource, { id, host: 'statsf1.com' })
    expect((await user.query(api.automations.get, { id }))?.failingSources).toEqual([])
  })
})
