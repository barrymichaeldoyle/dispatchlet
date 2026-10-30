import { describe, expect, it } from 'vitest'
import { HookBody, mapHookBody } from './hookPayload'

describe('inbound hook bodies', () => {
  it('maps a published GitHub release to a hint', () => {
    const mapped = mapHookBody('release', {
      action: 'published',
      release: {
        name: 'v2.3.0',
        tag_name: 'v2.3.0',
        html_url: 'https://github.com/x/y/releases/tag/v2.3.0',
        body: 'Notes',
      },
      repository: { full_name: 'x/y' },
    })
    expect(mapped).toEqual({
      ok: true,
      body: {
        hint: {
          title: 'x/y v2.3.0',
          url: 'https://github.com/x/y/releases/tag/v2.3.0',
          notes: 'Notes',
        },
      },
    })
    expect(mapHookBody('release', { action: 'created', release: {} })).toEqual({
      ok: true,
      body: {},
      ack: true,
    })
    expect(mapHookBody('release', { action: 'released', release: { name: 'v1' } })).toEqual({
      ok: true,
      body: {},
      ack: true,
    })
    expect(
      mapHookBody('release', { action: 'published', release: { name: 'v2-rc', prerelease: true } }),
    ).toEqual({ ok: true, body: {}, ack: true })
    expect(mapHookBody('push', {}).ok).toBe(false)
    expect(mapHookBody('ping', { zen: 'x' })).toEqual({ ok: true, body: {}, ack: true })
  })

  it('takes a generic body or an empty one', () => {
    expect(mapHookBody(null, {})).toEqual({ ok: true, body: {} })
    expect(mapHookBody(null, { dry: true })).toEqual({ ok: true, body: { dry: true } })
    expect(mapHookBody(null, { title: 'Big news', url: 'https://a.b/c', notes: 'n' })).toEqual({
      ok: true,
      body: { dry: undefined, hint: { title: 'Big news', url: 'https://a.b/c', notes: 'n' } },
    })
    expect(mapHookBody(null, { notes: 'no title' }).ok).toBe(false)
    expect(mapHookBody(null, [1]).ok).toBe(false)
  })

  it('validates the mapped shape', () => {
    expect(HookBody.safeParse({ hint: { title: 'x', url: 'not a url' } }).success).toBe(false)
    expect(HookBody.safeParse({ hint: { title: 'x' } }).success).toBe(true)
  })
})
