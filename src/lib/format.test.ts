import { describe, expect, it } from 'vitest'
import { channelHint, channelProblem, ideaLinkState, serviceList } from './format'

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
