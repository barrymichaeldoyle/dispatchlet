import { convexTest } from 'convex-test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import { E2E_EMAIL, e2eEnabled, isE2eUser } from './e2e'
import schema from './schema'

const modules = import.meta.glob('./**/*.*s')
const SECRET = 'x'.repeat(40)

afterEach(() => vi.unstubAllEnvs())

describe('the test sign-in', () => {
  it('is off without a long enough secret', () => {
    vi.stubEnv('E2E_AUTH_SECRET', '')
    expect(e2eEnabled()).toBe(false)
    vi.stubEnv('E2E_AUTH_SECRET', 'short')
    expect(e2eEnabled()).toBe(false)
    vi.stubEnv('E2E_AUTH_SECRET', SECRET)
    vi.stubEnv('CONVEX_CLOUD_URL', 'https://polite-marlin-194.convex.cloud')
    expect(e2eEnabled()).toBe(true)
  })

  it('is off on production even with a secret', () => {
    vi.stubEnv('E2E_AUTH_SECRET', SECRET)
    vi.stubEnv('CONVEX_CLOUD_URL', 'https://amiable-mosquito-364.convex.cloud')
    expect(e2eEnabled()).toBe(false)
    expect(isE2eUser(E2E_EMAIL)).toBe(false)
  })

  it('is off on any deployment not named as a test one, so a new production stays closed', () => {
    vi.stubEnv('E2E_AUTH_SECRET', SECRET)
    vi.stubEnv('CONVEX_CLOUD_URL', 'https://brand-new-prod-123.convex.cloud')
    expect(e2eEnabled()).toBe(false)
    vi.stubEnv('CONVEX_CLOUD_URL', 'https://polite-marlin-194.convex.cloud.evil.example')
    expect(e2eEnabled()).toBe(false)
    vi.stubEnv('CONVEX_CLOUD_URL', 'http://127.0.0.1:3210')
    expect(e2eEnabled()).toBe(true)
  })

  it('lets only the test user past the allowlist, and only while it is on', async () => {
    vi.stubEnv('E2E_AUTH_SECRET', SECRET)
    vi.stubEnv('CONVEX_CLOUD_URL', 'https://polite-marlin-194.convex.cloud')
    const t = convexTest(schema, modules)
    const userId = await t.mutation(internal.e2e.reset, {})
    const user = t.withIdentity({ subject: `${userId}|session` })
    expect((await user.query(api.users.viewer, {}))?.allowed).toBe(true)
    expect(isE2eUser('someone@example.com')).toBe(false)
    vi.stubEnv('E2E_AUTH_SECRET', '')
    expect((await user.query(api.users.viewer, {}))?.allowed).toBe(false)
  })

  it('refuses to reset data when it is off', async () => {
    vi.stubEnv('E2E_AUTH_SECRET', '')
    const t = convexTest(schema, modules)
    await expect(t.mutation(internal.e2e.reset, {})).rejects.toThrow('test sign-in is off')
  })

  it('seeds the same fixture every time, without booking a run', async () => {
    vi.stubEnv('E2E_AUTH_SECRET', SECRET)
    vi.stubEnv('CONVEX_CLOUD_URL', 'https://polite-marlin-194.convex.cloud')
    const t = convexTest(schema, modules)
    const first = await t.mutation(internal.e2e.reset, {})
    const user = t.withIdentity({ subject: `${first}|session` })
    // A test pauses the automation; the next sign-in puts it back.
    const before = await user.query(api.automations.dashboard, {})
    await user.mutation(api.automations.setStatus, {
      id: before!.automations[0]!._id,
      status: 'paused',
    })
    const second = await t.mutation(internal.e2e.reset, {})
    expect(second).toBe(first)
    const data = await user.query(api.automations.dashboard, {})
    expect(data?.automations).toHaveLength(1)
    expect(data?.automations[0]).toMatchObject({ name: 'F1 On This Day', status: 'active' })
    expect(data?.automations[0]?.weekRuns.map((r) => r.status).sort()).toEqual(['done', 'failed'])
    expect(data?.upcoming?.text).toMatch(/Hunt/)
    expect(data?.recent.map((p) => p.text)).toEqual([expect.stringMatching(/Senna/)])
    expect(await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ state: { kind: 'pending' } })]),
    )
  })
})
