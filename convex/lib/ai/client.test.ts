import { describe, expect, it } from 'vitest'
import { toolErrorsIn } from './client'

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
