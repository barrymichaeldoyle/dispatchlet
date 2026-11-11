import { describe, expect, it } from 'vitest'
import {
  bufferChannelUrl,
  channelHint,
  channelProblem,
  ideaLinkState,
  metricLabel,
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
