import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { DispatchletApiError, type ApiClient } from './api'

/**
 * The Dispatchlet MCP server (SPEC §44.6): one tool per thing a person can do in the app, each a
 * call to the REST API with the caller's token. Stateless: a new server is built per request.
 */

const INSTRUCTIONS = `Dispatchlet is a research agent for Buffer. An automation has a playbook (what to research, sources, what counts, voice, formats) and a schedule; each run finds new stories, skips covered ones, writes a post per channel and puts them in Buffer as drafts or in the queue.
How to work with it:
- Runs are started and then polled: run_automation returns at once, get_run with wait_seconds follows it. A run takes one to three minutes.
- run_automation defaults to a dry run, which sends nothing to Buffer. Pass dry=false only when the person wants posts created.
- Drafts sit in Buffer until approved; approve_post moves one into the queue. Buffer's own MCP shows the queue itself.
- A run's stories that were skipped (over the limit or not sure enough) or picked on a dry run can go to the person's Buffer Ideas board with save_idea, to post later.
- Playbook text has fixed headings (About, Sources, Searches, Post about, Skip, Tone, Formats). update_playbook returns the failing line on a parse error.
- Everything counts like it does in the app: one run at a time per automation, the person's run allowance, Buffer's limits.`

const Cadence = z.object({
  preset: z.enum(['daily', 'weekly']),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .describe('HH:MM in the account time zone'),
  weekday: z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']).nullable().default(null),
})

const Hint = z.object({
  title: z.string().max(200),
  url: z.string().url().optional(),
  notes: z.string().max(1000).optional(),
})

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

const text = (value: unknown): ToolResult => ({
  content: [
    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
  ],
})

function failure(error: unknown): ToolResult {
  if (error instanceof DispatchletApiError)
    return { isError: true, content: [{ type: 'text', text: `${error.code}: ${error.message}` }] }
  return {
    isError: true,
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
  }
}

/** Runs a tool body and turns API errors into tool errors the model can read and act on. */
async function guarded(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return text(await fn())
  } catch (error) {
    return failure(error)
  }
}

/** Ids go into URL paths, so they are encoded: a model can pass anything. */
const e = encodeURIComponent

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function createDispatchletServer(
  api: ApiClient,
  siteUrl = 'https://dispatchlet.com',
): McpServer {
  const server = new McpServer(
    { name: 'dispatchlet', version: '1.0.0' },
    { instructions: INSTRUCTIONS },
  )

  server.registerTool(
    'list_automations',
    {
      title: 'List automations',
      description:
        'The automations on this account with status, schedule, next run and playbook version.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => guarded(() => api.get('/automations')),
  )

  server.registerTool(
    'get_automation',
    {
      title: 'Get an automation',
      description:
        'One automation with its setup answers, channels and the playbook as structured data and text.',
      inputSchema: { automation_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ automation_id }) => guarded(() => api.get(`/automations/${e(automation_id)}`)),
  )

  server.registerTool(
    'create_automation',
    {
      title: 'Create an automation',
      description:
        'Create an automation from the setup answers. The playbook is written in the background: call get_automation in about a minute; status becomes "ready". Use list_channels for channel ids.',
      inputSchema: {
        research: z.string().max(300).describe('What to research, one line'),
        channel_ids: z.array(z.string()).min(1).describe('Buffer channel ids from list_channels'),
        avoid: z.string().max(500).default('').describe('Anything to avoid'),
        sources: z.array(z.string()).max(10).default([]).describe('Preferred sites or URLs'),
        only_these_sources: z.boolean().default(false),
        cadence: Cadence,
        max_stories: z.number().int().min(1).max(3).default(3),
        posting_mode: z.enum(['draft', 'queue']).default('draft'),
      },
    },
    ({
      research,
      channel_ids,
      avoid,
      sources,
      only_these_sources,
      cadence,
      max_stories,
      posting_mode,
    }) =>
      guarded(() =>
        api.send('POST', '/automations', {
          setup: {
            research,
            avoid,
            sources,
            onlyTheseSources: only_these_sources,
            cadence,
            maxStories: max_stories,
            postingMode: posting_mode,
          },
          channelIds: channel_ids,
        }),
      ),
  )

  server.registerTool(
    'update_automation',
    {
      title: 'Update an automation',
      description:
        'Change the schedule, channels, posting mode or stories per run, or set status to "active" (enable) or "paused".',
      inputSchema: {
        automation_id: z.string(),
        cadence: Cadence.optional(),
        channel_ids: z.array(z.string()).min(1).optional(),
        posting_mode: z.enum(['draft', 'queue', 'spread']).optional(),
        max_posts_per_run: z.number().int().min(1).max(3).optional(),
        status: z.enum(['active', 'paused']).optional(),
      },
      annotations: { destructiveHint: true },
    },
    ({ automation_id, cadence, channel_ids, posting_mode, max_posts_per_run, status }) =>
      guarded(() =>
        api.send('PATCH', `/automations/${e(automation_id)}`, {
          ...(cadence ? { cadence } : {}),
          ...(channel_ids ? { channelIds: channel_ids } : {}),
          ...(posting_mode ? { postingMode: posting_mode } : {}),
          ...(max_posts_per_run !== undefined ? { maxPostsPerRun: max_posts_per_run } : {}),
          ...(status ? { status } : {}),
        }),
      ),
  )

  server.registerTool(
    'get_playbook',
    {
      title: 'Get the playbook text',
      description: 'The playbook as the text the person edits, with its version.',
      inputSchema: { automation_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ automation_id }) =>
      guarded(() => api.get(`/automations/${e(automation_id)}/playbook`, 'text/markdown')),
  )

  server.registerTool(
    'update_playbook',
    {
      title: 'Replace the playbook text',
      description:
        'Save new playbook text as the next version. Keep the headings (About, Sources, Searches, Post about, Skip, Tone, Formats). On a parse error the result names the line; fix it and try again.',
      inputSchema: { automation_id: z.string(), text: z.string().min(1) },
    },
    ({ automation_id, text: body }) =>
      guarded(() =>
        api.send('PUT', `/automations/${e(automation_id)}/playbook`, body, 'text/markdown'),
      ),
  )

  server.registerTool(
    'add_skip_rule',
    {
      title: 'Add a skip rule',
      description: 'Append one sentence to the playbook’s Skip section, as a new version.',
      inputSchema: { automation_id: z.string(), rule: z.string().min(3).max(200) },
    },
    ({ automation_id, rule }) =>
      guarded(() => api.send('POST', `/automations/${e(automation_id)}/rules`, { rule })),
  )

  server.registerTool(
    'run_automation',
    {
      title: 'Run an automation',
      description:
        'Start a run now. dry=true (the default) researches and writes but sends nothing to Buffer. A hint is a story the run must cover. Returns the run at once; follow it with get_run.',
      inputSchema: {
        automation_id: z.string(),
        dry: z.boolean().default(true),
        hint: Hint.optional(),
      },
      annotations: { openWorldHint: true },
    },
    ({ automation_id, dry, hint }) =>
      guarded(() => api.send('POST', `/automations/${e(automation_id)}/runs`, { dry, hint })),
  )

  server.registerTool(
    'get_run',
    {
      title: 'Get a run',
      description:
        'A run with its steps, the stories it found (and why each was kept or skipped), the posts and the cost. wait_seconds (0 to 25) polls every three seconds until the run finishes.',
      inputSchema: { run_id: z.string(), wait_seconds: z.number().int().min(0).max(25).default(0) },
      annotations: { readOnlyHint: true },
    },
    ({ run_id, wait_seconds }) =>
      guarded(async () => {
        const until = Date.now() + wait_seconds * 1000
        for (;;) {
          const result = (await api.get(`/runs/${e(run_id)}`)) as {
            run: { finishedAt: number | null }
          }
          if (result.run.finishedAt || Date.now() >= until) return result
          await sleep(Math.min(3000, Math.max(250, until - Date.now())))
        }
      }),
  )

  server.registerTool(
    'list_runs',
    {
      title: 'List runs',
      description:
        'Recent runs of an automation, newest first, with what each found, kept and posted.',
      inputSchema: {
        automation_id: z.string(),
        limit: z.number().int().min(1).max(50).default(10),
      },
      annotations: { readOnlyHint: true },
    },
    ({ automation_id, limit }) =>
      guarded(() => api.get(`/automations/${e(automation_id)}/runs?limit=${limit}`)),
  )

  server.registerTool(
    'list_drafts',
    {
      title: 'List drafts waiting',
      description:
        'Posts sitting in Buffer as drafts, waiting for approval, with text, channel and run.',
      inputSchema: { automation_id: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ automation_id }) =>
      guarded(() =>
        api.get(`/posts?status=draft${automation_id ? `&automation=${e(automation_id)}` : ''}`),
      ),
  )

  server.registerTool(
    'approve_post',
    {
      title: 'Approve a draft',
      description:
        'Move a draft into the Buffer queue (Buffer’s editPost). Safe to repeat: an approved post stays approved.',
      inputSchema: { post_id: z.string() },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    ({ post_id }) => guarded(() => api.send('POST', `/posts/${e(post_id)}/approve`)),
  )

  server.registerTool(
    'edit_post',
    {
      title: 'Edit a draft',
      description:
        'Change the text of a post that is still a draft in Buffer, before approving it. Keep any link that is in the text. The result says if it is too long for the channel.',
      inputSchema: { post_id: z.string(), text: z.string().min(1) },
    },
    ({ post_id, text: body }) =>
      guarded(() => api.send('PATCH', `/posts/${e(post_id)}`, { text: body })),
  )

  server.registerTool(
    'save_idea',
    {
      title: 'Save a story to Buffer Ideas',
      description:
        "Save a story from a run to the person's Ideas board in Buffer, to post later. Only for stories that were skipped or picked on a dry run; story ids come from get_run.",
      inputSchema: { story_id: z.string() },
    },
    ({ story_id }) => guarded(() => api.send('POST', `/stories/${e(story_id)}/idea`, {})),
  )

  server.registerTool(
    'get_post',
    {
      title: 'Get a post',
      description: 'One post with its text, Buffer status, link once sent, and metrics.',
      inputSchema: { post_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ post_id }) => guarded(() => api.get(`/posts/${e(post_id)}`)),
  )

  server.registerTool(
    'list_channels',
    {
      title: 'List channels',
      description: 'The Buffer channels Dispatchlet can post to, with their ids and services.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => guarded(() => api.get('/channels')),
  )

  server.registerTool(
    'share_run',
    {
      title: 'Share a run',
      description: 'A public link to a run’s log, stories and posts.',
      inputSchema: { run_id: z.string() },
    },
    ({ run_id }) => guarded(() => api.send('POST', `/runs/${e(run_id)}/share`)),
  )

  server.registerResource(
    'playbook',
    new ResourceTemplate('dispatchlet://automations/{id}/playbook', { list: undefined }),
    {
      title: 'Playbook',
      description: 'An automation’s playbook as text',
      mimeType: 'text/markdown',
    },
    async (uri, { id }) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: String(await api.get(`/automations/${e(String(id))}/playbook`, 'text/markdown')),
        },
      ],
    }),
  )

  server.registerResource(
    'run',
    new ResourceTemplate('dispatchlet://runs/{id}', { list: undefined }),
    {
      title: 'Run',
      description: 'A run with its log, stories and posts',
      mimeType: 'application/json',
    },
    async (uri, { id }) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(await api.get(`/runs/${e(String(id))}`), null, 2),
        },
      ],
    }),
  )

  server.registerPrompt(
    'review_drafts',
    {
      title: 'Review drafts',
      description: 'List the drafts waiting in Buffer and ask which to approve.',
      argsSchema: {},
    },
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Use list_drafts to find the posts waiting in Buffer as drafts. Show each one with its channel, the automation it came from and the full text, numbered. Then ask me which to approve. When I answer, call approve_post for each one I named and confirm what moved into the queue. Links to runs look like ${siteUrl}/app/a/<automationId>/runs/<runId>.`,
          },
        },
      ],
    }),
  )

  return server
}
