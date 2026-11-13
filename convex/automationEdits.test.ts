import { convexTest, type TestConvex } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api, internal } from './_generated/api'
import { updateConfigFor } from './automations'
import { renderPlaybook, type Playbook } from './lib/playbook'
import schema from './schema'

const modules = import.meta.glob('./**/*.*s')
const cadence = { preset: 'daily' as const, time: '08:00', weekday: null }
const weekly = { preset: 'weekly' as const, time: '09:00', weekday: 'sun' }
const playbook: Playbook = {
  name: 'F1 news',
  about: 'Race weekends.',
  sources: [],
  searchQueries: [],
  freshnessHours: 48,
  include: [],
  exclude: [],
  voice: { tone: 'Dry.', notes: '', avoidSaying: [], emoji: 'none', hashtags: 'none' },
  formats: [],
}
const text = renderPlaybook(playbook)
const newText = renderPlaybook({ ...playbook, voice: { ...playbook.voice, tone: 'Friendly.' } })

async function fixture(t: TestConvex<typeof schema>) {
  const userId = await t.run((ctx) =>
    ctx.db.insert('users', { email: 'owner@example.com', timezone: 'Africa/Johannesburg' }),
  )
  const id = await t.run(async (ctx) => {
    for (const channelId of ['x1', 'x2'])
      await ctx.db.insert('bufferChannels', {
        userId,
        channelId,
        organizationId: 'org',
        service: 'twitter',
        name: channelId,
        usable: true,
        syncedAt: 0,
      })
    const automationId = await ctx.db.insert('automations', {
      userId,
      name: playbook.name,
      status: 'ready',
      setup: {
        research: 'F1',
        services: ['twitter'],
        avoid: '',
        sources: [],
        onlyTheseSources: false,
        cadence,
        maxStories: 1,
        postingMode: 'draft',
      },
      channelIds: ['x1'],
      cadence,
      timezone: 'Africa/Johannesburg',
      postingMode: 'draft',
      maxPostsPerRun: 1,
      createdAt: 0,
      updatedAt: 0,
    })
    const versionId = await ctx.db.insert('playbookVersions', {
      automationId,
      version: 1,
      text,
      playbook,
      createdBy: 'user',
      createdAt: 0,
    })
    await ctx.db.patch(automationId, { playbookVersionId: versionId })
    return automationId
  })
  return { id, userId, user: t.withIdentity({ subject: `${userId}|session` }) }
}

describe('reviewed automation changes', () => {
  it('provides capabilities and a revision without changing legacy automations', async () => {
    const t = convexTest(schema, modules)
    const { id, user } = await fixture(t)
    const result = await user.query(api.automationEdits.context, { id })
    expect(result).toMatchObject({
      revision: 0,
      current: { text, cadence, timezone: 'Africa/Johannesburg' },
      capabilities: { storiesPerRun: { max: 3, plannedMax: 7 }, requiresReview: true },
    })
    expect(result.capabilities.postingModes).toContain('planned')
    expect(Object.keys(result.capabilities.researchModes)).toEqual(
      expect.arrayContaining(['recent', 'archive', 'anniversary']),
    )
    expect((await t.run((ctx) => ctx.db.get(id)))?.configurationRevision).toBeUndefined()
  })

  it('reviews both halves, applies atomically once, and rebooks an active schedule once', async () => {
    const t = convexTest(schema, modules)
    const { id, user } = await fixture(t)
    await user.mutation(api.automations.setStatus, { id, status: 'active' })
    const before = await t.run((ctx) => ctx.db.get(id))
    const editId = await user.mutation(api.automationEdits.propose, {
      id,
      baseRevision: 0,
      changes: { cadence: weekly, maxPostsPerRun: 3, postingMode: 'queue' },
      playbookText: newText,
    })
    expect(await t.run((ctx) => ctx.db.get(id))).toEqual(before)
    const proposal = await user.query(api.automationEdits.get, { id: editId })
    expect(proposal).toMatchObject({
      before: { text, cadence },
      after: { text: newText, cadence: weekly, maxPostsPerRun: 3 },
      status: 'proposed',
    })
    expect(proposal.summary).toHaveLength(4)
    expect(await user.mutation(api.automationEdits.apply, { id: editId })).toBe(1)
    const after = await t.run((ctx) => ctx.db.get(id))
    expect(after).toMatchObject({
      cadence: weekly,
      maxPostsPerRun: 3,
      postingMode: 'queue',
      status: 'active',
      configurationRevision: 1,
    })
    expect(after?.scheduledFnId).not.toBe(before?.scheduledFnId)
    const oldJob = await t.run((ctx) => ctx.db.system.get(before!.scheduledFnId!))
    expect(oldJob?.state.kind).toBe('canceled')
    const newJob = await t.run((ctx) => ctx.db.system.get(after!.scheduledFnId!))
    expect(newJob?.state.kind).toBe('pending')
    expect(newJob?.args).toEqual([{ automationId: id }])
    expect(await user.mutation(api.automationEdits.apply, { id: editId })).toBe(1)
    expect(await t.run((ctx) => ctx.db.get(id))).toEqual(after)
    expect(await t.run((ctx) => ctx.db.query('playbookVersions').collect())).toHaveLength(2)
    // Retrying an old receipt cannot overwrite a newer edit.
    await user.mutation(api.automations.updateConfig, { id, maxPostsPerRun: 2 })
    expect(await user.mutation(api.automationEdits.apply, { id: editId })).toBe(1)
    expect((await t.run((ctx) => ctx.db.get(id)))?.maxPostsPerRun).toBe(2)
  })

  it.each([
    { maxPostsPerRun: 7 },
    { maxPostsPerRun: 1.5 },
    { maxPostsPerRun: Number.NaN },
    { channelIds: [] },
    { channelIds: ['not-mine'] },
    { channelIds: ['x1', 'x1'] },
    { cadence: { ...weekly, time: '25:00' } },
    { cadence: { ...weekly, weekday: null } },
  ])('refuses unsupported configuration before storing a proposal: %j', async (changes) => {
    const t = convexTest(schema, modules)
    const { id, user } = await fixture(t)
    await expect(
      user.mutation(api.automationEdits.propose, { id, baseRevision: 0, changes }),
    ).rejects.toThrow()
    expect(await t.run((ctx) => ctx.db.query('automationEdits').collect())).toEqual([])
    expect((await t.run((ctx) => ctx.db.get(id)))?.configurationRevision).toBeUndefined()
  })

  it('refuses invalid playbooks, empty changes, and generation in progress', async () => {
    const t = convexTest(schema, modules)
    const { id, user } = await fixture(t)
    for (const playbookText of ['not a playbook', 'x'.repeat(20_001), text])
      await expect(
        user.mutation(api.automationEdits.propose, {
          id,
          baseRevision: 0,
          changes: {},
          playbookText,
        }),
      ).rejects.toThrow()
    await t.run((ctx) => ctx.db.patch(id, { status: 'generating' }))
    await expect(
      user.mutation(api.automationEdits.propose, {
        id,
        baseRevision: 0,
        changes: { cadence: weekly },
      }),
    ).rejects.toThrow('Wait until the playbook is ready')
  })

  it('revalidates channel ownership at apply and rolls back all changes on failure', async () => {
    const t = convexTest(schema, modules)
    const { id, user } = await fixture(t)
    await user.mutation(api.automations.setStatus, { id, status: 'active' })
    const editId = await user.mutation(api.automationEdits.propose, {
      id,
      baseRevision: 0,
      changes: { channelIds: ['x2'], cadence: weekly },
      playbookText: newText,
    })
    const before = await t.run((ctx) => ctx.db.get(id))
    await t.run(async (ctx) => {
      const channel = await ctx.db
        .query('bufferChannels')
        .filter((q) => q.eq(q.field('channelId'), 'x2'))
        .first()
      await ctx.db.delete(channel!._id)
    })
    await expect(user.mutation(api.automationEdits.apply, { id: editId })).rejects.toThrow(
      'Pick at least one channel',
    )
    expect(await t.run((ctx) => ctx.db.get(id))).toEqual(before)
    expect(await t.run((ctx) => ctx.db.query('playbookVersions').collect())).toHaveLength(1)
    expect((await user.query(api.automationEdits.get, { id: editId })).status).toBe('proposed')
    expect((await t.run((ctx) => ctx.db.system.get(before!.scheduledFnId!)))?.state.kind).toBe(
      'pending',
    )
  })

  it.each([
    'manual config',
    'API config',
    'playbook',
    'skip rule',
    'generated playbook',
    'timezone',
  ])('rejects stale context and proposals after a %s edit', async (kind) => {
    const t = convexTest(schema, modules)
    const { id, userId, user } = await fixture(t)
    const editId = await user.mutation(api.automationEdits.propose, {
      id,
      baseRevision: 0,
      changes: { cadence: weekly },
    })
    if (kind === 'manual config')
      await user.mutation(api.automations.updateConfig, { id, maxPostsPerRun: 2 })
    if (kind === 'API config')
      await t.run((ctx) => updateConfigFor(ctx, userId, id, { maxPostsPerRun: 2 }))
    if (kind === 'playbook')
      await user.mutation(api.automations.savePlaybook, { id, text: newText })
    if (kind === 'skip rule')
      await user.mutation(api.automations.addExcludeRule, { id, rule: 'Skip rumours.' })
    if (kind === 'generated playbook')
      await t.mutation(internal.automations.storeGenerated, { automationId: id, playbook })
    if (kind === 'timezone')
      await user.mutation(api.users.setTimezone, { timezone: 'Europe/London' })
    await expect(user.mutation(api.automationEdits.apply, { id: editId })).rejects.toThrow(
      'This automation changed',
    )
    await expect(
      user.mutation(api.automationEdits.propose, {
        id,
        baseRevision: 0,
        changes: { cadence: weekly },
      }),
    ).rejects.toThrow('This automation changed')
    expect((await t.run((ctx) => ctx.db.get(id)))?.configurationRevision).toBe(1)
  })

  it('detects intervening edits even when settings were changed back to their original values', async () => {
    const t = convexTest(schema, modules)
    const { id, user } = await fixture(t)
    const editId = await user.mutation(api.automationEdits.propose, {
      id,
      baseRevision: 0,
      changes: { cadence: weekly },
    })
    await user.mutation(api.automations.updateConfig, { id, maxPostsPerRun: 2 })
    await user.mutation(api.automations.updateConfig, { id, maxPostsPerRun: 1 })
    await expect(user.mutation(api.automationEdits.apply, { id: editId })).rejects.toThrow(
      'This automation changed',
    )
  })

  it('allows only one of two competing proposals to apply', async () => {
    const t = convexTest(schema, modules)
    const { id, user } = await fixture(t)
    const first = await user.mutation(api.automationEdits.propose, {
      id,
      baseRevision: 0,
      changes: { cadence: weekly },
    })
    const second = await user.mutation(api.automationEdits.propose, {
      id,
      baseRevision: 0,
      changes: { maxPostsPerRun: 2 },
    })
    const results = await Promise.allSettled([
      user.mutation(api.automationEdits.apply, { id: first }),
      user.mutation(api.automationEdits.apply, { id: second }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    expect((await t.run((ctx) => ctx.db.get(id)))?.configurationRevision).toBe(1)
  })

  it('replaces the active job when undoing a cadence edit and refuses stale undo proposals', async () => {
    const t = convexTest(schema, modules)
    const { id, user } = await fixture(t)
    await user.mutation(api.automations.setStatus, { id, status: 'active' })
    const editId = await user.mutation(api.automationEdits.propose, {
      id,
      baseRevision: 0,
      changes: { cadence: weekly },
    })
    await user.mutation(api.automationEdits.apply, { id: editId })
    const weeklyJob = (await t.run((ctx) => ctx.db.get(id)))!.scheduledFnId!
    const staleUndo = await user.mutation(api.automationEdits.proposeUndo, {
      id: editId,
      baseRevision: 1,
    })
    await user.mutation(api.automations.updateConfig, { id, maxPostsPerRun: 2 })
    await expect(user.mutation(api.automationEdits.apply, { id: staleUndo })).rejects.toThrow(
      'This automation changed',
    )
    const undo = await user.mutation(api.automationEdits.proposeUndo, {
      id: editId,
      baseRevision: 2,
    })
    // Asking again, as after closing and reopening the panel, gives the same proposal.
    expect(
      await user.mutation(api.automationEdits.proposeUndo, { id: editId, baseRevision: 2 }),
    ).toBe(undo)
    await user.mutation(api.automationEdits.apply, { id: undo })
    const restored = (await t.run((ctx) => ctx.db.get(id)))!
    expect(restored).toMatchObject({ cadence, status: 'active', configurationRevision: 3 })
    expect(restored.scheduledFnId).not.toBe(weeklyJob)
    expect((await t.run((ctx) => ctx.db.system.get(weeklyJob)))?.state.kind).toBe('canceled')
    expect((await t.run((ctx) => ctx.db.system.get(restored.scheduledFnId!)))?.state.kind).toBe(
      'pending',
    )
  })

  it('requires review for undo, creates a new revision, and keeps the current activation state', async () => {
    const t = convexTest(schema, modules)
    const { id, user } = await fixture(t)
    const editId = await user.mutation(api.automationEdits.propose, {
      id,
      baseRevision: 0,
      changes: { cadence: weekly },
      playbookText: newText,
    })
    await user.mutation(api.automationEdits.apply, { id: editId })
    await user.mutation(api.automations.setStatus, { id, status: 'paused' })
    const undoId = await user.mutation(api.automationEdits.proposeUndo, {
      id: editId,
      baseRevision: 1,
    })
    expect((await t.run((ctx) => ctx.db.get(id)))?.cadence).toEqual(weekly)
    expect((await user.query(api.automationEdits.get, { id: undoId })).restoresEditId).toBe(editId)
    expect(await user.mutation(api.automationEdits.apply, { id: undoId })).toBe(2)
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      cadence,
      status: 'paused',
      configurationRevision: 2,
    })
    const result = await user.query(api.automationEdits.context, { id })
    expect(result.current.text).toBe(text)
    expect(await t.run((ctx) => ctx.db.query('playbookVersions').collect())).toHaveLength(3)
    expect(await user.query(api.automationEdits.history, { id })).toHaveLength(2)
    expect(await t.run((ctx) => ctx.db.query('runs').collect())).toEqual([])
    expect(await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())).toEqual([])
  })

  it('does not apply discarded proposals or undo un-applied changes', async () => {
    const t = convexTest(schema, modules)
    const { id, user } = await fixture(t)
    const editId = await user.mutation(api.automationEdits.propose, {
      id,
      baseRevision: 0,
      changes: { cadence: weekly },
    })
    await expect(
      user.mutation(api.automationEdits.proposeUndo, { id: editId, baseRevision: 0 }),
    ).rejects.toThrow('Only applied changes')
    await user.mutation(api.automationEdits.discard, { id: editId })
    await user.mutation(api.automationEdits.discard, { id: editId })
    await expect(user.mutation(api.automationEdits.apply, { id: editId })).rejects.toThrow(
      'discarded',
    )
  })

  it('protects context, history, proposals, receipts and undo with automation ownership', async () => {
    const t = convexTest(schema, modules)
    const { id, user } = await fixture(t)
    const { user: other } = await fixture(t)
    const editId = await user.mutation(api.automationEdits.propose, {
      id,
      baseRevision: 0,
      changes: { cadence: weekly },
    })
    for (const caller of [t, other]) {
      await expect(caller.query(api.automationEdits.context, { id })).rejects.toThrow()
      await expect(caller.query(api.automationEdits.history, { id })).rejects.toThrow()
      await expect(caller.query(api.automationEdits.get, { id: editId })).rejects.toThrow()
      await expect(
        caller.mutation(api.automationEdits.propose, {
          id,
          baseRevision: 0,
          changes: { cadence: weekly },
        }),
      ).rejects.toThrow()
      await expect(caller.mutation(api.automationEdits.apply, { id: editId })).rejects.toThrow()
      await expect(caller.mutation(api.automationEdits.discard, { id: editId })).rejects.toThrow()
      await expect(
        caller.mutation(api.automationEdits.proposeUndo, { id: editId, baseRevision: 0 }),
      ).rejects.toThrow()
    }
    await user.mutation(api.automations.remove, { id })
    await expect(user.mutation(api.automationEdits.apply, { id: editId })).rejects.toThrow(
      'Automation not found',
    )
  })

  it('proposes and applies a weekly planned batch as one reviewed change, and undoes it', async () => {
    const t = convexTest(schema, modules)
    const { id, user } = await fixture(t)
    const plan = { time: '09:00', weekdays: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] }
    await expect(
      user.mutation(api.automationEdits.propose, {
        id,
        baseRevision: 0,
        changes: { postingMode: 'planned', publicationPlan: plan, maxPostsPerRun: 7 },
      }),
    ).rejects.toThrow(/weekly cadence/)
    await expect(
      user.mutation(api.automationEdits.propose, {
        id,
        baseRevision: 0,
        changes: { maxPostsPerRun: 7 },
      }),
    ).rejects.toThrow(/planned posting mode/)
    const editId = await user.mutation(api.automationEdits.propose, {
      id,
      baseRevision: 0,
      changes: {
        cadence: weekly,
        postingMode: 'planned',
        publicationPlan: plan,
        maxPostsPerRun: 7,
        channelIds: ['x1', 'x2'],
      },
    })
    const edit = await user.query(api.automationEdits.get, { id: editId })
    expect(edit.after.publicationPlan?.weekdays).toEqual([
      'mon',
      'tue',
      'wed',
      'thu',
      'fri',
      'sat',
      'sun',
    ])
    expect(edit.summary).toEqual(
      expect.arrayContaining([
        'Publication plan: none → Every day at 09:00 (Africa/Johannesburg).',
        expect.stringContaining('up to 7 stories × 2 channels = up to 14 Buffer posts'),
      ]),
    )
    expect(await user.mutation(api.automationEdits.apply, { id: editId })).toBe(1)
    const saved = await t.run((ctx) => ctx.db.get(id))
    expect(saved).toMatchObject({ postingMode: 'planned', maxPostsPerRun: 7, cadence: weekly })
    // Leaving planned mode needs a story count the other modes accept.
    await expect(
      user.mutation(api.automationEdits.propose, {
        id,
        baseRevision: 1,
        changes: { postingMode: 'queue' },
      }),
    ).rejects.toThrow(/Between 1 and 3/)
    // Fewer posting days than stories is refused.
    await expect(
      user.mutation(api.automationEdits.propose, {
        id,
        baseRevision: 1,
        changes: { publicationPlan: { time: '09:00', weekdays: ['mon', 'fri'] } },
      }),
    ).rejects.toThrow(/1 to 2 stories/)
    const undoId = await user.mutation(api.automationEdits.proposeUndo, {
      id: editId,
      baseRevision: 1,
    })
    await user.mutation(api.automationEdits.apply, { id: undoId })
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      postingMode: 'draft',
      maxPostsPerRun: 1,
      cadence,
    })
  })

  it('switches research to history as a reviewed change and back with undo', async () => {
    const t = convexTest(schema, modules)
    const { id, user } = await fixture(t)
    const editId = await user.mutation(api.automationEdits.propose, {
      id,
      baseRevision: 0,
      changes: { researchMode: 'archive' },
    })
    expect((await user.query(api.automationEdits.get, { id: editId })).summary).toEqual([
      'Research: recent news → history.',
    ])
    await user.mutation(api.automationEdits.apply, { id: editId })
    expect((await t.run((ctx) => ctx.db.get(id)))?.researchMode).toBe('archive')
    const undoId = await user.mutation(api.automationEdits.proposeUndo, {
      id: editId,
      baseRevision: 1,
    })
    await user.mutation(api.automationEdits.apply, { id: undoId })
    expect((await t.run((ctx) => ctx.db.get(id)))?.researchMode).toBe('recent')
  })

  it('deletes proposal snapshots with the account', async () => {
    const t = convexTest(schema, modules)
    const { id, userId, user } = await fixture(t)
    await user.mutation(api.automationEdits.propose, {
      id,
      baseRevision: 0,
      changes: { cadence: weekly },
    })
    await t.mutation(internal.users.deleteUserData, { userId })
    expect(await t.run((ctx) => ctx.db.query('automationEdits').collect())).toEqual([])
  })
})
