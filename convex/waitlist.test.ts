import { convexTest } from 'convex-test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.*s')

function t() {
  return convexTest(schema, modules)
}

const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' }

function post(tc: ReturnType<typeof t>, body: unknown, headers: Record<string, string> = {}) {
  return tc.fetch('/waitlist', {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...headers },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.stubEnv('SITE_URL', 'https://dispatchlet.com')
  vi.stubEnv('IP_HASH_SALT', 'test')
  vi.stubEnv('WAITLIST_RATE_LIMIT', '')
})

describe('waitlist.add', () => {
  it('stores a new address and returns its position', async () => {
    const tc = t()
    const a = await tc.mutation(internal.waitlist.add, { email: 'a@example.com', source: 'direct' })
    const b = await tc.mutation(internal.waitlist.add, { email: 'b@example.com', source: 'x.com' })
    expect(a).toMatchObject({ position: 1, isNew: true })
    expect(b).toMatchObject({ position: 2, isNew: true })
    expect(a.token).toHaveLength(64)
  })

  it('returns the same position for a repeated address and stores nothing', async () => {
    const tc = t()
    const first = await tc.mutation(internal.waitlist.add, {
      email: 'a@example.com',
      source: 'direct',
    })
    await tc.mutation(internal.waitlist.add, { email: 'b@example.com', source: 'direct' })
    const again = await tc.mutation(internal.waitlist.add, {
      email: 'a@example.com',
      source: 'direct',
    })
    expect(again).toEqual({ ...first, isNew: false })
    expect(await tc.query(api.waitlist.count, {})).toBe(2)
  })
})

describe('POST /waitlist', () => {
  it('accepts JSON, schedules the confirmation email once, and dedupes', async () => {
    const tc = t()
    const res = await post(tc, { email: ' Sam@Example.com ', source: 'x.com' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, position: 1 })

    const again = await post(tc, { email: 'sam@example.com' })
    expect(await again.json()).toEqual({ ok: true, position: 1 })

    const rows = await tc.run((ctx) => ctx.db.query('waitlist').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ email: 'sam@example.com', source: 'x.com' })

    const scheduled = await tc.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())
    expect(scheduled).toHaveLength(1)
  })

  it('rejects a bad address', async () => {
    const tc = t()
    const res = await post(tc, { email: 'nope' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false, error: 'invalid_email' })
  })

  it.each([null, [], 42, 'email@example.com'])(
    'rejects a non-object JSON body: %j',
    async (body) => {
      const tc = t()
      const res = await post(tc, body)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ ok: false, error: 'invalid_email' })
      expect(await tc.query(api.waitlist.count, {})).toBe(0)
    },
  )

  it('ignores the honeypot silently', async () => {
    const tc = t()
    const res = await post(tc, { email: 'bot@example.com', website: 'http://spam' })
    expect(res.status).toBe(200)
    expect(await tc.query(api.waitlist.count, {})).toBe(0)
  })

  it('rate limits by IP', async () => {
    const tc = t()
    const ip = { 'cf-connecting-ip': '203.0.113.9' }
    for (let i = 0; i < 5; i++) {
      const res = await post(tc, { email: `p${i}@example.com` }, ip)
      expect(res.status).toBe(200)
    }
    const blocked = await post(tc, { email: 'p6@example.com' }, ip)
    expect(blocked.status).toBe(429)
    const other = await post(
      tc,
      { email: 'p7@example.com' },
      { 'cf-connecting-ip': '203.0.113.10' },
    )
    expect(other.status).toBe(200)
  })

  it('falls back to the referrer host as source', async () => {
    const tc = t()
    await post(
      tc,
      { email: 'r@example.com' },
      { referer: 'https://news.ycombinator.com/item?id=1' },
    )
    const rows = await tc.run((ctx) => ctx.db.query('waitlist').collect())
    expect(rows[0]?.source).toBe('news.ycombinator.com')
  })

  it('answers a plain form post with an HTML page', async () => {
    const tc = t()
    const res = await tc.fetch('/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'email=form%40example.com&website=',
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('You are number 1 on the list.')
  })
})

describe('confirm and unsubscribe links', () => {
  it('set the timestamps and redirect to the page', async () => {
    const tc = t()
    const { token } = await tc.mutation(internal.waitlist.add, {
      email: 'c@example.com',
      source: 'direct',
    })

    const confirm = await tc.fetch(`/waitlist/confirm?token=${token}`, { redirect: 'manual' })
    expect(confirm.status).toBe(302)
    expect(confirm.headers.get('location')).toBe('https://dispatchlet.com/?confirmed=1')

    const unsub = await tc.fetch(`/waitlist/unsubscribe?token=${token}`, { redirect: 'manual' })
    expect(unsub.headers.get('location')).toBe('https://dispatchlet.com/?unsubscribed=1')

    const row = await tc.run((ctx) => ctx.db.query('waitlist').first())
    expect(row?.confirmedAt).toBeTypeOf('number')
    expect(row?.unsubscribedAt).toBeTypeOf('number')

    const bad = await tc.fetch('/waitlist/confirm?token=nope')
    expect(bad.status).toBe(404)
  })
})

describe('purgeIps', () => {
  it('clears hashed IPs older than 7 days', async () => {
    const tc = t()
    const eightDays = Date.now() - 8 * 24 * 60 * 60 * 1000
    await tc.run(async (ctx) => {
      await ctx.db.insert('waitlist', {
        email: 'old@example.com',
        createdAt: eightDays,
        source: 'direct',
        token: 'a',
        ip: 'h1',
      })
      await ctx.db.insert('waitlist', {
        email: 'new@example.com',
        createdAt: Date.now(),
        source: 'direct',
        token: 'b',
        ip: 'h2',
      })
    })
    expect(await tc.mutation(internal.waitlist.purgeIps, {})).toBe(1)
    const rows = await tc.run((ctx) => ctx.db.query('waitlist').collect())
    expect(rows.find((r) => r.email === 'old@example.com')?.ip).toBeUndefined()
    expect(rows.find((r) => r.email === 'new@example.com')?.ip).toBe('h2')
  })
})

describe('nextLaunchBatch', () => {
  it('only returns confirmed, subscribed, unsent rows', async () => {
    const tc = t()
    const now = Date.now()
    await tc.run(async (ctx) => {
      await ctx.db.insert('waitlist', {
        email: 'yes@example.com',
        createdAt: now,
        source: 'direct',
        token: '1',
        confirmedAt: now,
      })
      await ctx.db.insert('waitlist', {
        email: 'unconfirmed@example.com',
        createdAt: now,
        source: 'direct',
        token: '2',
      })
      await ctx.db.insert('waitlist', {
        email: 'gone@example.com',
        createdAt: now,
        source: 'direct',
        token: '3',
        confirmedAt: now,
        unsubscribedAt: now,
      })
      await ctx.db.insert('waitlist', {
        email: 'sent@example.com',
        createdAt: now,
        source: 'direct',
        token: '4',
        confirmedAt: now,
        launchEmailSentAt: now,
      })
    })
    const batch = await tc.query(internal.waitlist.nextLaunchBatch, { limit: 50 })
    expect(batch.map((r) => r.email)).toEqual(['yes@example.com'])
  })
})

describe('after sign-up opens', () => {
  it('the form endpoint is closed and stores nothing', async () => {
    vi.stubEnv('SIGNUP_OPEN', 'true')
    const tc = t()
    const res = await post(tc, { email: 'late@example.com' })
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({ ok: false, error: 'closed' })
    expect(await tc.run((ctx) => ctx.db.query('waitlist').collect())).toHaveLength(0)
  })

  it('purge refuses while the list is open, then deletes every row', async () => {
    vi.stubEnv('SIGNUP_OPEN', '')
    const tc = t()
    await post(tc, { email: 'a@example.com' })
    await post(tc, { email: 'b@example.com' })
    await expect(tc.mutation(internal.waitlist.purge, {})).rejects.toThrow('still open')
    vi.stubEnv('SIGNUP_OPEN', 'true')
    expect(await tc.mutation(internal.waitlist.purge, { limit: 1 })).toBe(1)
    expect(await tc.mutation(internal.waitlist.purge, {})).toBe(1)
    expect(await tc.mutation(internal.waitlist.purge, {})).toBe(0)
  })

  it('the daily cleanup waits two weeks after the launch email', async () => {
    vi.stubEnv('SIGNUP_OPEN', '')
    const tc = t()
    const day = 24 * 60 * 60 * 1000
    const row = (email: string, extra: Record<string, number>) =>
      tc.run((ctx) =>
        ctx.db.insert('waitlist', { email, createdAt: 0, source: 'x', token: email, ...extra }),
      )
    await row('unconfirmed@example.com', {})
    await row('unsubscribed@example.com', { confirmedAt: 1, unsubscribedAt: 2 })
    await row('recent@example.com', { confirmedAt: 1, launchEmailSentAt: Date.now() - day })
    await row('old@example.com', { confirmedAt: 1, launchEmailSentAt: Date.now() - 15 * day })
    await row('unsent@example.com', { confirmedAt: 1 })
    expect(await tc.mutation(internal.waitlist.purgeClosed, {})).toBe(0)
    vi.stubEnv('SIGNUP_OPEN', 'true')
    expect(await tc.mutation(internal.waitlist.purgeClosed, {})).toBe(3)
    const left = await tc.run((ctx) => ctx.db.query('waitlist').collect())
    expect(left.map((r) => r.email).toSorted()).toEqual([
      'recent@example.com',
      'unsent@example.com',
    ])
  })
})
