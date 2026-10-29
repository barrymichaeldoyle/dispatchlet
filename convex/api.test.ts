import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { generateSecret, hashSecret, HOOK_PREFIX } from './lib/apiToken'
import schema from './schema'
import { openApiDocument } from './api/openapi'
import { ROUTES } from './api/reference'
import { matchPath } from './api/http'

const modules = import.meta.glob('./**/*.*s')

const EMPTY = {
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  webSearches: 0,
  webFetches: 0,
}

async function account(t: ReturnType<typeof convexTest>, scope: 'read' | 'write' = 'write') {
  const userId = await t.run((ctx) =>
    ctx.db.insert('users', { email: 'a@example.com', timezone: 'UTC', emailPrefs: 'never' }),
  )
  const user = t.withIdentity({ subject: `${userId}|session` })
  const made = await user.mutation(api.tokens.create, { name: 'CLI', scope })
  const automationId = await t.run(async (ctx) => {
    await ctx.db.insert('bufferChannels', {
      userId,
      organizationId: 'o1',
      channelId: 'c1',
      service: 'twitter',
      name: 'GrandPrixPicks',
      usable: true,
      syncedAt: Date.now(),
    })
    const id = await ctx.db.insert('automations', {
      userId,
      name: 'F1',
      status: 'ready',
      setup: {
        research: 'F1',
        services: ['twitter'],
        avoid: '',
        sources: [],
        onlyTheseSources: false,
        cadence: { preset: 'daily', time: '08:00', weekday: null },
        maxStories: 3,
        postingMode: 'draft',
      },
      channelIds: ['c1'],
      cadence: { preset: 'daily', time: '08:00', weekday: null },
      timezone: 'UTC',
      postingMode: 'draft',
      maxPostsPerRun: 3,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    const versionId = await ctx.db.insert('playbookVersions', {
      automationId: id,
      version: 1,
      playbook: {
        name: 'F1',
        about: 'Formula 1',
        sources: [],
        searchQueries: ['F1 news'],
        freshnessHours: 24,
        include: ['Race results'],
        exclude: [],
        voice: { tone: 'plain', notes: '', avoidSaying: [], emoji: 'none', hashtags: 'none' },
        formats: [
          { service: 'twitter', style: 'short', maxLength: null, thread: false, linkBack: null },
        ],
      },
      text: '# F1\n',
      createdBy: 'ai',
      createdAt: Date.now(),
    })
    await ctx.db.patch(id, { playbookVersionId: versionId })
    return id
  })
  const call = (path: string, init: RequestInit = {}, token = made.token) =>
    t.fetch(`/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
    })
  return { t, userId, user, token: made.token, tokenId: made._id, automationId, call }
}

describe('API tokens', () => {
  it('are shown once, listed by prefix, and stop working when revoked', async () => {
    const { t, user, token, tokenId, call } = await account(convexTest(schema, modules))
    expect(token.startsWith('dl_')).toBe(true)
    const listed = await user.query(api.tokens.list, {})
    expect(listed).toHaveLength(1)
    expect(listed[0]!.prefix).toBe(token.slice(0, 11))
    expect(JSON.stringify(listed)).not.toContain(token)
    const stored = await t.run((ctx) => ctx.db.get(tokenId))
    expect(stored?.hash).toBe(await hashSecret(token))

    const me = await call('/me')
    expect(me.status).toBe(200)
    expect((await me.json()).email).toBe('a@example.com')
    expect(me.headers.get('X-RateLimit-Limit')).toBe('60')

    await user.mutation(api.tokens.revoke, { id: tokenId })
    const after = await call('/me')
    expect(after.status).toBe(401)
    expect((await after.json()).error.code).toBe('unauthorized')
  })

  it('refuses a missing, malformed or unknown token', async () => {
    const { t, call } = await account(convexTest(schema, modules))
    expect((await t.fetch('/v1/me')).status).toBe(401)
    expect((await call('/me', {}, 'dl_nope')).status).toBe(401)
    expect((await call('/me', {}, generateSecret('dl_'))).status).toBe(401)
  })

  it('a read token cannot write', async () => {
    const { call, automationId } = await account(convexTest(schema, modules), 'read')
    expect((await call('/automations')).status).toBe(200)
    const denied = await call(`/automations/${automationId}/runs`, {
      method: 'POST',
      body: '{"dry":true}',
    })
    expect(denied.status).toBe(403)
    expect((await denied.json()).error.code).toBe('forbidden')
  })

  it('rate limits per token', async () => {
    const { t, call } = await account(convexTest(schema, modules))
    process.env.API_RATE_PER_MINUTE = '2'
    try {
      expect((await call('/me')).status).toBe(200)
      expect((await call('/me')).status).toBe(200)
      const limited = await call('/me')
      expect(limited.status).toBe(429)
      expect(limited.headers.get('Retry-After')).toBeTruthy()
    } finally {
      delete process.env.API_RATE_PER_MINUTE
    }
    void t
  })
})

describe('the REST routes', () => {
  it('answer 404 for unknown routes and ids, 405 for a wrong method', async () => {
    const { call } = await account(convexTest(schema, modules))
    expect((await call('/nothing')).status).toBe(404)
    expect((await call('/me', { method: 'DELETE' })).status).toBe(405)
    expect((await call('/automations/notanid')).status).toBe(404)
    expect((await call('/automations/k170000000000000000000000000')).status).toBe(404)
  })

  it('lists, reads, patches and deletes an automation', async () => {
    const { call, automationId } = await account(convexTest(schema, modules))
    const list = await call('/automations')
    expect((await list.json()).automations[0]._id).toBe(automationId)
    const one = await (await call(`/automations/${automationId}`)).json()
    expect(one.automation.text).toBe('# F1\n')
    expect(one.automation.channels[0].name).toBe('GrandPrixPicks')

    const bad = await call(`/automations/${automationId}`, {
      method: 'PATCH',
      body: '{"maxPostsPerRun":9}',
    })
    expect(bad.status).toBe(400)
    expect((await bad.json()).error.field).toBe('maxPostsPerRun')
    const unknownChannel = await call(`/automations/${automationId}`, {
      method: 'PATCH',
      body: '{"channelIds":["zz"]}',
    })
    expect(unknownChannel.status).toBe(400)

    const patched = await call(`/automations/${automationId}`, {
      method: 'PATCH',
      body: JSON.stringify({ maxPostsPerRun: 2, status: 'active' }),
    })
    expect(patched.status).toBe(200)
    const body = await patched.json()
    expect(body.automation.maxPostsPerRun).toBe(2)
    expect(body.automation.status).toBe('active')
    expect(body.automation.nextRunAt).toBeGreaterThan(Date.now())

    expect((await call(`/automations/${automationId}`, { method: 'DELETE' })).status).toBe(200)
    expect((await call(`/automations/${automationId}`)).status).toBe(404)
  })

  it('serves the playbook as text or JSON and saves a new version', async () => {
    const { call, automationId } = await account(convexTest(schema, modules))
    const text = await call(`/automations/${automationId}/playbook`, {
      headers: { Accept: 'text/markdown' },
    })
    expect(text.headers.get('Content-Type')).toContain('text/markdown')
    expect(await text.text()).toBe('# F1\n')
    const json = await (await call(`/automations/${automationId}/playbook`)).json()
    expect(json.version).toBe(1)

    const broken = await call(`/automations/${automationId}/playbook`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/markdown' },
      body: 'not a playbook',
    })
    expect(broken.status).toBe(400)
    expect((await broken.json()).error.line).toBeTypeOf('number')

    const rule = await call(`/automations/${automationId}/rules`, {
      method: 'POST',
      body: '{"rule":"Skip rumours"}',
    })
    expect(rule.status).toBe(200)
    expect((await rule.json()).version).toBe(2)
    const latest = await (await call(`/automations/${automationId}/playbook`)).json()
    expect(latest.playbook.exclude).toEqual(['Skip rumours.'])
  })

  it('starts a dry run with a hint, lists runs and reads one', async () => {
    const { t, userId, call, automationId } = await account(convexTest(schema, modules))
    const started = await call(`/automations/${automationId}/runs`, {
      method: 'POST',
      body: JSON.stringify({
        dry: true,
        hint: { title: 'Vegas GP preview', url: 'https://f1.com/vegas' },
      }),
    })
    expect(started.status).toBe(202)
    const { run } = await started.json()
    expect(run.kind).toBe('dry')
    expect(run.startedBy).toBe('api')
    expect(run.hint.title).toBe('Vegas GP preview')
    expect(run.steps[0].note).toContain('Asked to cover: Vegas GP preview')
    expect(run.steps[0].note).toContain('from the API')

    // While a run is unfinished, another is refused.
    await t.run(async (ctx) => {
      await ctx.db.insert('runs', {
        userId,
        automationId,
        kind: 'now',
        status: 'researching',
        startedAt: Date.now() + 1000,
        steps: [],
        usage: EMPTY,
        costUsd: 0,
      })
    })
    const again = await call(`/automations/${automationId}/runs`, {
      method: 'POST',
      body: '{"dry":true}',
    })
    expect(again.status).toBe(409)
    expect((await again.json()).error.code).toBe('conflict')

    const runs = await (await call(`/automations/${automationId}/runs?limit=5`)).json()
    expect(runs.runs).toHaveLength(2)
    const one = await (await call(`/runs/${run._id}`)).json()
    expect(one.run._id).toBe(run._id)
    const share = await (await call(`/runs/${run._id}/share`, { method: 'POST' })).json()
    expect(share.url).toMatch(/\/r\/[a-f0-9]{32}$/)
    const stored = await t.run((ctx) => ctx.db.get(run._id as Id<'runs'>))
    expect(stored?.hint?.url).toBe('https://f1.com/vegas')
  })

  it('answers 402 when the allowance is spent', async () => {
    const { t, userId, call, automationId } = await account(convexTest(schema, modules))
    await t.run((ctx) => ctx.db.patch(userId, { freeRunsUsed: 10 }))
    const res = await call(`/automations/${automationId}/runs`, { method: 'POST', body: '{}' })
    expect(res.status).toBe(402)
    expect((await res.json()).error.code).toBe('allowance')
  })

  it('lists posts with filters', async () => {
    const { t, userId, call, automationId } = await account(convexTest(schema, modules))
    await t.run(async (ctx) => {
      const runId = await ctx.db.insert('runs', {
        userId,
        automationId,
        kind: 'now',
        status: 'done',
        startedAt: Date.now(),
        steps: [],
        usage: EMPTY,
        costUsd: 0,
      })
      const storyId = await ctx.db.insert('stories', {
        automationId,
        runId,
        title: 'T',
        canonicalUrl: 'https://x.y/z',
        source: 'x',
        publishedAt: '',
        summary: '',
        whyItMatters: '',
        keyFacts: [],
        confidence: 1,
        decision: 'kept',
        reason: '',
        createdAt: Date.now(),
      })
      for (const status of ['draft', 'sent'])
        await ctx.db.insert('posts', {
          userId,
          automationId,
          runId,
          storyId,
          channelId: 'c1',
          service: 'twitter',
          text: status,
          status,
          bufferPostId: `b-${status}`,
          approveToken: status === 'draft' ? 'tok' : undefined,
          createdAt: Date.now(),
        })
    })
    const all = await (await call('/posts')).json()
    expect(all.posts).toHaveLength(2)
    expect(all.posts[0].channelName).toBe('GrandPrixPicks')
    expect(JSON.stringify(all)).not.toContain('approveToken')
    const drafts = await (await call('/posts?status=draft')).json()
    expect(drafts.posts.map((p: { text: string }) => p.text)).toEqual(['draft'])
    expect((await call('/posts?status=nope')).status).toBe(400)
  })
})

describe('webhooks', () => {
  it('are created with a one-time secret and fire on matching events only', async () => {
    const { t, userId, call, automationId } = await account(convexTest(schema, modules))
    process.env.TOKEN_ENC_KEY = btoa(String.fromCharCode(...new Uint8Array(32)))
    const bad = await call('/webhooks', {
      method: 'POST',
      body: '{"url":"http://x.com/a","events":["ping"]}',
    })
    expect(bad.status).toBe(400)
    const made = await call('/webhooks', {
      method: 'POST',
      body: JSON.stringify({
        url: 'https://hooks.example.com/a',
        events: ['post.created', 'ping'],
      }),
    })
    expect(made.status).toBe(201)
    const body = await made.json()
    expect(body.secret.startsWith('whsec_')).toBe(true)
    expect(body.webhook.active).toBe(true)
    const listed = await (await call('/webhooks')).json()
    expect(JSON.stringify(listed)).not.toContain(body.secret)

    const runId = await t.run((ctx) =>
      ctx.db.insert('runs', {
        userId,
        automationId,
        kind: 'now',
        status: 'publishing',
        startedAt: Date.now(),
        steps: [],
        usage: EMPTY,
        costUsd: 0,
      }),
    )
    const storyId = await t.run((ctx) =>
      ctx.db.insert('stories', {
        automationId,
        runId,
        title: 'T',
        canonicalUrl: 'https://x.y/z',
        source: 'x',
        publishedAt: '',
        summary: '',
        whyItMatters: '',
        keyFacts: [],
        confidence: 1,
        decision: 'kept',
        reason: '',
        createdAt: Date.now(),
      }),
    )
    // A post that never reached Buffer fires nothing; one with a Buffer id fires post.created.
    await t.mutation(internal.runs.savePost, {
      userId,
      automationId,
      runId,
      storyId,
      channelId: 'c1',
      service: 'twitter',
      text: 'rejected',
      status: 'rejected',
    })
    await t.mutation(internal.runs.savePost, {
      userId,
      automationId,
      runId,
      storyId,
      channelId: 'c1',
      service: 'twitter',
      text: 'hello',
      status: 'draft',
      bufferPostId: 'b1',
    })
    // run.finished is not subscribed, so finishing adds nothing.
    await t.mutation(internal.runs.finish, { runId, status: 'done', note: 'Done.' })
    const deliveries = await (await call(`/webhooks/${body.webhook._id}/deliveries`)).json()
    expect(deliveries.deliveries).toHaveLength(1)
    expect(deliveries.deliveries[0].event).toBe('post.created')
    const stored = await t.run((ctx) => ctx.db.query('webhookDeliveries').collect())
    const payload = JSON.parse(stored[0]!.payload)
    expect(payload.type).toBe('post.created')
    expect(payload.data.post.text).toBe('hello')
    expect(payload.data.automation.name).toBe('F1')
    expect(payload.id).toBe(stored[0]!._id)

    const test = await call(`/webhooks/${body.webhook._id}/test`, { method: 'POST' })
    expect(test.status).toBe(202)
    expect((await call(`/webhooks/${body.webhook._id}`, { method: 'DELETE' })).status).toBe(200)
    expect(await t.run((ctx) => ctx.db.query('webhookDeliveries').collect())).toHaveLength(0)
  })

  it('records attempts, retries three times, then marks the delivery failed', async () => {
    const { t, userId } = await account(convexTest(schema, modules))
    const webhookId = await t.run((ctx) =>
      ctx.db.insert('webhooks', {
        userId,
        url: 'https://hooks.example.com/a',
        secretEnc: 'x',
        events: ['ping'],
        active: true,
        createdAt: Date.now(),
        failedInARow: 0,
      }),
    )
    const deliveryId = await t.run((ctx) =>
      ctx.db.insert('webhookDeliveries', {
        webhookId,
        userId,
        event: 'ping',
        payload: '{}',
        attempt: 0,
        status: 'pending',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    )
    for (let i = 0; i < 3; i++) {
      await t.mutation(internal.webhooks.recordAttempt, {
        deliveryId,
        ok: false,
        responseStatus: 500,
      })
      const d = await t.run((ctx) => ctx.db.get(deliveryId))
      expect(d?.status).toBe('pending')
      expect(d?.nextAttemptAt).toBeGreaterThan(Date.now())
    }
    await t.mutation(internal.webhooks.recordAttempt, {
      deliveryId,
      ok: false,
      responseStatus: 500,
    })
    const d = await t.run((ctx) => ctx.db.get(deliveryId))
    expect(d?.status).toBe('failed')
    expect(d?.attempt).toBe(4)
    const w = await t.run((ctx) => ctx.db.get(webhookId))
    expect(w?.failedInARow).toBe(1)
    expect(w?.lastStatus).toBe('failed')
    await t.mutation(internal.webhooks.recordAttempt, { deliveryId, ok: true, responseStatus: 200 })
    expect((await t.run((ctx) => ctx.db.get(webhookId)))?.failedInARow).toBe(0)
  })
})

describe('inbound hooks', () => {
  it('start a run from a token in the URL, with a GitHub release as the hint', async () => {
    const { t, call, automationId } = await account(convexTest(schema, modules))
    const made = await call('/hooks', {
      method: 'POST',
      body: JSON.stringify({ automationId, name: 'Releases' }),
    })
    expect(made.status).toBe(201)
    const hook = await made.json()
    expect(hook.token.startsWith(HOOK_PREFIX)).toBe(true)
    expect(hook.url).toContain(`/api/v1/hooks/${hook.token}`)

    expect(
      (await t.fetch(`/v1/hooks/${generateSecret(HOOK_PREFIX)}`, { method: 'POST' })).status,
    ).toBe(404)
    const wrongEvent = await t.fetch(`/v1/hooks/${hook.token}`, {
      method: 'POST',
      headers: { 'X-GitHub-Event': 'push', 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(wrongEvent.status).toBe(400)
    const started = await t.fetch(`/v1/hooks/${hook.token}`, {
      method: 'POST',
      headers: { 'X-GitHub-Event': 'release', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'published',
        release: {
          name: 'v1.2.0',
          html_url: 'https://github.com/x/y/releases/tag/v1.2.0',
          body: 'Notes',
        },
        repository: { full_name: 'x/y' },
      }),
    })
    expect(started.status).toBe(202)
    const { run } = await started.json()
    const stored = await t.run((ctx) => ctx.db.get(run.id as Id<'runs'>))
    expect(stored?.startedBy).toBe('hook')
    expect(stored?.hint?.title).toBe('x/y v1.2.0')
    expect(stored?.kind).toBe('now')
    const listed = await (await call('/hooks')).json()
    expect(listed.hooks[0].uses).toBe(1)
    expect(JSON.stringify(listed)).not.toContain(hook.token)
  })
})

describe('the OpenAPI document', () => {
  it('describes every registered route', () => {
    const doc = openApiDocument('https://dispatchlet.com')
    expect(doc.servers[0]!.url).toBe('https://dispatchlet.com/api/v1')
    for (const r of ROUTES) {
      const op = doc.paths[r.path]?.[r.method.toLowerCase()]
      expect(op, `${r.method} ${r.path}`).toBeTruthy()
    }
    // Each reference path must match the matcher's idea of its shape.
    expect(matchPath('/automations/:id/runs', '/automations/abc/runs')).toEqual({ id: 'abc' })
    expect(matchPath('/automations/:id/runs', '/automations/abc')).toBeNull()
  })
})
