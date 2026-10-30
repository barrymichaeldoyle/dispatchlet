import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { apiClient } from './api'
import { createDispatchletServer } from './server'

/** A fake Dispatchlet API: records calls and answers from a small table. */
function fakeApi() {
  const calls: { method: string; path: string; body?: string; accept?: string }[] = []
  let polls = 0
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    const path = url.pathname.replace(/^\/v1/, '') + url.search
    const headers = new Headers(init?.headers)
    calls.push({
      method: init?.method ?? 'GET',
      path,
      body: init?.body as string | undefined,
      accept: headers.get('accept') ?? undefined,
    })
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    if (headers.get('authorization') !== 'Bearer dl_test')
      return json(401, { error: { code: 'unauthorized', message: 'Bad token' } })
    if (path === '/automations') return json(200, { automations: [{ _id: 'a1', name: 'F1' }] })
    if (path === '/automations/a1/playbook' && headers.get('accept') === 'text/markdown')
      return new Response('# F1\n', { status: 200, headers: { 'Content-Type': 'text/markdown' } })
    if (path === '/automations/a1/runs' && init?.method === 'POST')
      return json(202, { run: { _id: 'r1', finishedAt: null } })
    if (path === '/runs/r1') {
      polls++
      return json(200, {
        run: {
          _id: 'r1',
          finishedAt: polls >= 2 ? 123 : null,
          status: polls >= 2 ? 'done' : 'researching',
        },
      })
    }
    if (path === '/posts/p9/approve')
      return json(404, { error: { code: 'not_found', message: 'No such post.' } })
    if (path === '/posts?status=draft&automation=a1') return json(200, { posts: [] })
    return json(404, { error: { code: 'not_found', message: `No route ${path}` } })
  }
  return { calls, fetchImpl }
}

async function connect(token = 'dl_test') {
  const { calls, fetchImpl } = fakeApi()
  const server = createDispatchletServer(apiClient('https://x.convex.site/v1', token, fetchImpl))
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(clientTransport)
  return { client, calls }
}

describe('the MCP server', () => {
  it('lists the tools, resources and the prompt', async () => {
    const { client } = await connect()
    const tools = (await client.listTools()).tools.map((t) => t.name)
    expect(tools).toEqual([
      'list_automations',
      'get_automation',
      'create_automation',
      'update_automation',
      'get_playbook',
      'update_playbook',
      'add_skip_rule',
      'run_automation',
      'get_run',
      'list_runs',
      'list_drafts',
      'approve_post',
      'edit_post',
      'get_post',
      'list_channels',
      'share_run',
    ])
    const templates = (await client.listResourceTemplates()).resourceTemplates.map(
      (r) => r.uriTemplate,
    )
    expect(templates).toEqual([
      'dispatchlet://automations/{id}/playbook',
      'dispatchlet://runs/{id}',
    ])
    expect((await client.listPrompts()).prompts.map((p) => p.name)).toEqual(['review_drafts'])
  })

  it('calls the API with the token and returns its JSON', async () => {
    const { client, calls } = await connect()
    const result = await client.callTool({ name: 'list_automations', arguments: {} })
    expect(JSON.parse((result.content as { text: string }[])[0]!.text).automations[0].name).toBe(
      'F1',
    )
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/automations' })
  })

  it('reads the playbook as markdown, through the tool and the resource', async () => {
    const { client, calls } = await connect()
    const tool = await client.callTool({ name: 'get_playbook', arguments: { automation_id: 'a1' } })
    expect((tool.content as { text: string }[])[0]!.text).toBe('# F1\n')
    const resource = await client.readResource({ uri: 'dispatchlet://automations/a1/playbook' })
    expect((resource.contents[0] as { text: string }).text).toBe('# F1\n')
    expect(calls.every((c) => c.accept === 'text/markdown')).toBe(true)
  })

  it('starts a dry run by default and waits for it in get_run', async () => {
    const { client, calls } = await connect()
    await client.callTool({ name: 'run_automation', arguments: { automation_id: 'a1' } })
    expect(JSON.parse(calls.at(-1)!.body!)).toEqual({ dry: true })
    const result = await client.callTool({
      name: 'get_run',
      arguments: { run_id: 'r1', wait_seconds: 5 },
    })
    expect(JSON.parse((result.content as { text: string }[])[0]!.text).run.status).toBe('done')
    expect(calls.filter((c) => c.path === '/runs/r1')).toHaveLength(2)
  })

  it('turns an API error into a tool error the model can read', async () => {
    const { client } = await connect()
    const result = await client.callTool({ name: 'approve_post', arguments: { post_id: 'p9' } })
    expect(result.isError).toBe(true)
    expect((result.content as { text: string }[])[0]!.text).toBe('not_found: No such post.')
  })

  it('passes a bad token through as an unauthorized tool error', async () => {
    const { client } = await connect('dl_wrong')
    const result = await client.callTool({
      name: 'list_drafts',
      arguments: { automation_id: 'a1' },
    })
    expect(result.isError).toBe(true)
    expect((result.content as { text: string }[])[0]!.text).toContain('unauthorized')
  })
})
