import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { callStructured, toolErrorsIn } from './client'
import { costOf, EMPTY_USAGE } from './pricing'

describe('server tool errors', () => {
  it('pairs each failed search or fetch with what was asked', () => {
    const content = [
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'F1 news' } },
      {
        type: 'web_search_tool_result',
        tool_use_id: 's1',
        content: [{ type: 'web_search_result' }],
      },
      { type: 'server_tool_use', id: 's2', name: 'web_search', input: { query: 'x'.repeat(10) } },
      {
        type: 'web_search_tool_result',
        tool_use_id: 's2',
        content: { type: 'web_search_tool_result_error', error_code: 'query_too_long' },
      },
      { type: 'server_tool_use', id: 'f1', name: 'web_fetch', input: { url: 'https://a.b/c' } },
      {
        type: 'web_fetch_tool_result',
        tool_use_id: 'f1',
        content: { type: 'web_fetch_tool_result_error', error_code: 'url_not_accessible' },
      },
      { type: 'text', text: 'done' },
    ]
    expect(toolErrorsIn(content)).toEqual([
      { tool: 'web_search', code: 'query_too_long', input: '{"query":"xxxxxxxxxx"}' },
      { tool: 'web_fetch', code: 'url_not_accessible', input: '{"url":"https://a.b/c"}' },
    ])
    expect(toolErrorsIn([{ type: 'text', text: 'hi' }])).toEqual([])
  })
})

/** A client whose create returns the given replies in turn, recording what it was asked. */
function fakeClient(...replies: { text: string; stopReason?: string; model?: string }[]) {
  const create = vi.fn(async (_request: unknown, _options?: { timeout?: number }) => {
    const reply = replies.shift()!
    return {
      model: reply.model ?? 'claude-haiku-5-5',
      stop_reason: reply.stopReason ?? 'end_turn',
      content: [{ type: 'text', text: reply.text }],
      usage: { input_tokens: 1_000_000, output_tokens: 0 },
    }
  })
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create }
}

const call = {
  model: 'claude-haiku-5-5' as const,
  system: 's',
  user: 'u',
  schema: z.object({ ok: z.boolean() }),
  effort: 'low' as const,
  maxTokens: 100,
}

describe('a structured call', () => {
  it('asks again after an unreadable reply and counts both in the receipt', async () => {
    const { client, create } = fakeClient({ text: '{"ok": tru' }, { text: '{"ok": true}' })
    const result = await callStructured(client, call)
    expect(create).toHaveBeenCalledTimes(2)
    expect(result.output).toEqual({ ok: true })
    expect(result.unreadable).toBe(false)
    expect(result.record.usage.inputTokens).toBe(2_000_000)
    expect(result.record.costUsd).toBeCloseTo(
      2 *
        costOf('claude-haiku-5-5', {
          ...EMPTY_USAGE,
          inputTokens: 1_000_000,
        }),
    )
  })

  it('keeps the cost of two unreadable replies, and says the answer could not be read', async () => {
    const { client } = fakeClient({ text: 'nope' }, { text: '{"ok": 1}' })
    const result = await callStructured(client, call)
    expect(result).toMatchObject({ output: null, unreadable: true })
    expect(result.record.usage.inputTokens).toBe(2_000_000)
  })

  it('does not ask again when the reply was cut off at max_tokens', async () => {
    const { client, create } = fakeClient({ text: '{"ok": ', stopReason: 'max_tokens' })
    const result = await callStructured(client, call)
    expect(create).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ output: null, unreadable: true })
    expect(result.record).toMatchObject({ stopReason: 'max_tokens' })
    expect(result.record.usage.inputTokens).toBe(1_000_000)
  })

  it('asks once when told not to retry', async () => {
    const { client, create } = fakeClient({ text: 'nope' })
    const result = await callStructured(client, { ...call, retryMalformed: false })
    expect(create).toHaveBeenCalledTimes(1)
    expect(result.unreadable).toBe(true)
  })

  it('fits the call inside a deadline, and does not start one with too little time left', async () => {
    const { client, create } = fakeClient({ text: '{"ok": true}' })
    await callStructured(client, { ...call, deadline: Date.now() + 60_000 })
    const options = create.mock.calls[0]![1] as { timeout: number; signal: AbortSignal }
    expect(options.timeout).toBeLessThanOrEqual(60_000)
    expect(options.timeout).toBeGreaterThan(50_000)
    expect(options.signal).toBeInstanceOf(AbortSignal)
    // No deadline: the client's own timeout and retries, as before.
    await callStructured(fakeClient({ text: '{"ok": true}' }).client, call)
    const late = fakeClient({ text: '{"ok": true}' })
    await expect(
      callStructured(late.client, { ...call, deadline: Date.now() + 5_000 }),
    ).rejects.toThrow(/timed out/)
    expect(late.create).not.toHaveBeenCalled()
  })
})
