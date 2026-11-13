import { describe, expect, it } from 'vitest'
import {
  errorText,
  bufferChannelUrl,
  channelHint,
  whenInSentence,
  channelProblem,
  ideaLinkState,
  draftEmailNote,
  metricLabel,
  relativeWhen,
  serviceList,
  zoneName,
} from './format'

const none = { usable: 0, blocked: 0, others: [] as string[], syncing: false, syncError: null }

describe('the channel step in setup', () => {
  it('names the networks Dispatchlet cannot post to', () => {
    expect(serviceList(['instagram'])).toBe('Instagram')
    expect(serviceList(['facebook', 'instagram', 'tiktok'])).toBe('Facebook, Instagram or TikTok')
    expect(channelHint({ ...none, others: ['instagram'] })).toBe(
      'Dispatchlet can’t post to Instagram yet. Connect X, LinkedIn, Threads, Bluesky or Mastodon in Buffer, then sync again.',
    )
    expect(channelHint({ ...none, usable: 2, others: ['instagram'] })).toBe(
      'Text channels in your Buffer account. Pick as many as you like. Dispatchlet can’t post to Instagram yet.',
    )
  })

  it('says when Buffer has the channels but will not let them be used', () => {
    expect(channelHint({ ...none, blocked: 1 })).toMatch(/won’t let Dispatchlet use these/)
    expect(channelProblem('locked')).toMatch(/plan’s channel limit/)
    expect(channelProblem('disconnected')).toMatch(/Reconnect it there/)
  })

  it('prefers the sync state and errors over the empty message', () => {
    expect(channelHint({ ...none, syncing: true })).toBe('Reading your channels from Buffer.')
    expect(channelHint({ ...none, syncError: 'Buffer did not answer.' })).toBe(
      'Buffer did not answer.',
    )
    expect(channelHint(none)).toBe(
      'Connect X, LinkedIn, Threads, Bluesky or Mastodon in Buffer, then sync again.',
    )
  })
})

describe('the Buffer Ideas link on a story', () => {
  it('stays hidden until Ideas is switched on, then asks for a reconnect or offers the link', () => {
    expect(ideaLinkState(false, 'off')).toBe('hidden')
    expect(ideaLinkState(false, 'reconnect')).toBe('reconnect')
    expect(ideaLinkState(false, 'ready')).toBe('save')
    expect(ideaLinkState(true, 'off')).toBe('saved')
  })
})

describe('channels Dispatchlet cannot post to', () => {
  it('are named, not hidden', () => {
    expect(channelProblem('unsupported', 'instagram')).toBe(
      'Dispatchlet can’t post to Instagram yet.',
    )
    expect(channelProblem('unsupported', 'tiktok')).toBe('Dispatchlet can’t post to TikTok yet.')
  })
})

describe('a post metric in words', () => {
  it('spells out Buffer’s camelCase and snake_case names, and marks a percentage', () => {
    expect(metricLabel({ type: 'impressions', value: 1200, unit: 'count' })).toBe(
      '1,200 impressions',
    )
    expect(metricLabel({ type: 'engagementRate', value: 3.5, unit: 'percentage' })).toBe(
      '3.5% engagement rate',
    )
    expect(metricLabel({ type: 'totalTimeWatched', value: 90, unit: 'count' })).toBe(
      '90 total time watched',
    )
    expect(metricLabel({ type: 'link_clicks', value: 2, unit: 'count' })).toBe('2 link clicks')
  })
})

describe('links into Buffer', () => {
  it('open the post itself when Buffer gave an id, unless it was deleted there', () => {
    expect(bufferChannelUrl('c1', 'draft', 'abc123')).toBe(
      'https://publish.buffer.com/posts/abc123',
    )
    expect(bufferChannelUrl('c1', 'queued', 'abc123')).toBe(
      'https://publish.buffer.com/posts/abc123',
    )
    expect(bufferChannelUrl('c1', 'deleted', 'abc123')).toBe(
      'https://publish.buffer.com/channel/c1/tab/queue',
    )
  })

  it('open drafts on the drafts tab and other posts on their channel', () => {
    expect(bufferChannelUrl('c1', 'draft')).toBe('https://publish.buffer.com/schedule?tab=drafts')
    expect(bufferChannelUrl('c1', 'queued')).toBe('https://publish.buffer.com/channel/c1/tab/queue')
    expect(bufferChannelUrl('c1', 'sent')).toBe('https://publish.buffer.com/channel/c1/tab/sent')
  })
})

describe('a time zone in words', () => {
  it('names the city, not the region', () => {
    expect(zoneName('Africa/Johannesburg')).toBe('Johannesburg time')
    expect(zoneName('America/New_York')).toBe('New York time')
    expect(zoneName('America/Argentina/Buenos_Aires')).toBe('Buenos Aires time')
  })

  it('leaves UTC as it is', () => {
    expect(zoneName('UTC')).toBe('UTC')
  })
})

describe('times on the home page', () => {
  const zone = 'Africa/Johannesburg'
  // 11 Nov 2026, 20:50 in Johannesburg (UTC+2).
  const now = Date.UTC(2026, 10, 11, 18, 50)
  it('names today, tomorrow and yesterday in the person’s zone', () => {
    expect(relativeWhen(Date.UTC(2026, 10, 11, 7, 0), zone, now)).toBe('Today, 09:00')
    expect(relativeWhen(Date.UTC(2026, 10, 12, 7, 0), zone, now)).toBe('Tomorrow, 09:00')
    expect(relativeWhen(Date.UTC(2026, 10, 10, 7, 0), zone, now)).toBe('Yesterday, 09:00')
    // 22:30 UTC on the 11th is already the 12th in Johannesburg.
    expect(relativeWhen(Date.UTC(2026, 10, 11, 22, 30), zone, now)).toBe('Tomorrow, 00:30')
  })
  it('uses the weekday within a week, then the date', () => {
    expect(relativeWhen(Date.UTC(2026, 10, 14, 7, 0), zone, now)).toBe('Sat, 09:00')
    expect(relativeWhen(Date.UTC(2026, 10, 20, 7, 0), zone, now)).toBe('20 Nov, 09:00')
  })
})

describe('what drafts promise about email', () => {
  it('promises an approve link only when one will be sent', () => {
    expect(draftEmailNote('every', true)).toMatch(/emails you an approve link/)
    expect(draftEmailNote('drafts', true)).toMatch(/emails you an approve link/)
    expect(draftEmailNote('problems', true)).toMatch(/Approval emails are off .*only problems/)
    expect(draftEmailNote('never', true)).toMatch(/Approval emails are off .*never/)
    expect(draftEmailNote('every', false)).toMatch(/^Email is off in Settings/)
  })
})

describe('whenInSentence', () => {
  const now = Date.UTC(2026, 10, 12, 18, 0) // Thursday
  it('says today, tomorrow, a weekday within the week, then a date', () => {
    expect(whenInSentence(Date.UTC(2026, 10, 12, 21, 0), 'UTC', now)).toBe('today at 21:00')
    expect(whenInSentence(Date.UTC(2026, 10, 13, 9, 0), 'UTC', now)).toBe('tomorrow at 09:00')
    expect(whenInSentence(Date.UTC(2026, 10, 16, 9, 0), 'UTC', now)).toBe('on Monday at 09:00')
    expect(whenInSentence(Date.UTC(2026, 10, 20, 9, 0), 'UTC', now)).toBe('on 20 Nov at 09:00')
  })

  it('counts days in the automation’s zone', () => {
    // 23:30 UTC on the 12th is already the 13th in Johannesburg.
    expect(whenInSentence(Date.UTC(2026, 10, 12, 23, 30), 'Africa/Johannesburg', now)).toBe(
      'tomorrow at 01:30',
    )
  })
})

describe('an error in words', () => {
  it('keeps the app’s own message and drops Convex’s wrapping', () => {
    expect(
      errorText(
        new Error('[CONVEX M(runs:trigger)] Uncaught Error: No free runs left.\n    at x (y.js:1)'),
        'f',
      ),
    ).toBe('No free runs left.')
  })
  it('shows the fallback for a redacted production error', () => {
    expect(
      errorText(
        new Error('[CONVEX M(runs:trigger)] [Request ID: 3f2a] Server Error'),
        'Not started.',
      ),
    ).toBe('Not started.')
    expect(errorText('nope', 'Not started.')).toBe('Not started.')
  })
})
