/**
 * The route table the OpenAPI document and the docs page are built from (SPEC §44.3). One entry
 * per route; a test checks every registered route has one.
 */
export type RouteRef = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  scope: 'read' | 'write' | 'none'
  summary: string
  description?: string
  query?: Record<string, { type: string; description: string }>
  body?: unknown
  bodyType?: string
  response: unknown
  status?: number
  example?: { request?: string; response: string }
}

const id = { type: 'string', description: 'A Dispatchlet id' }
const ms = { type: 'integer', description: 'Unix milliseconds' }
const nullable = (schema: Record<string, unknown>) => ({ ...schema, nullable: true })

export const Cadence = {
  type: 'object',
  required: ['preset', 'time'],
  properties: {
    preset: { type: 'string', enum: ['daily', 'weekly'] },
    time: { type: 'string', description: 'HH:MM in the account time zone', example: '08:00' },
    weekday: nullable({ type: 'string', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }),
  },
}

export const Setup = {
  type: 'object',
  required: ['research', 'cadence'],
  properties: {
    research: { type: 'string', maxLength: 300, description: 'What to research, one line' },
    avoid: { type: 'string', maxLength: 500, default: '' },
    sources: { type: 'array', items: { type: 'string' }, maxItems: 10, default: [] },
    onlyTheseSources: { type: 'boolean', default: false },
    cadence: Cadence,
    maxStories: { type: 'integer', minimum: 1, maximum: 3, default: 3 },
    postingMode: { type: 'string', enum: ['draft', 'queue'], default: 'draft' },
  },
}

export const Automation = {
  type: 'object',
  properties: {
    _id: id,
    name: { type: 'string' },
    status: { type: 'string', enum: ['generating', 'ready', 'active', 'paused', 'failed'] },
    cadence: Cadence,
    timezone: { type: 'string' },
    postingMode: { type: 'string', enum: ['draft', 'queue', 'spread'] },
    maxPostsPerRun: { type: 'integer' },
    channelIds: { type: 'array', items: { type: 'string' } },
    nextRunAt: nullable(ms),
    lastRunAt: nullable(ms),
    generationError: nullable({ type: 'string' }),
    version: { type: 'integer', description: 'The playbook version in use' },
  },
}

export const AutomationDetail = {
  allOf: [
    Automation,
    {
      type: 'object',
      properties: {
        setup: Setup,
        playbook: nullable({ type: 'object', description: 'The structured playbook' }),
        text: nullable({ type: 'string', description: 'The playbook as text' }),
        channels: { type: 'array', items: { $ref: '#/components/schemas/Channel' } },
      },
    },
  ],
}

export const Channel = {
  type: 'object',
  properties: {
    id: { type: 'string', description: "Buffer's channel id" },
    service: { type: 'string', enum: ['twitter', 'linkedin', 'threads', 'bluesky', 'mastodon'] },
    name: { type: 'string' },
    usable: { type: 'boolean' },
    maxLength: nullable({ type: 'integer' }),
    syncedAt: ms,
  },
}

export const Hint = {
  type: 'object',
  required: ['title'],
  properties: {
    title: { type: 'string', maxLength: 200 },
    url: { type: 'string', format: 'uri' },
    notes: { type: 'string', maxLength: 1000 },
  },
  description: 'A story the run must cover. Dedupe still applies.',
}

export const RunSummary = {
  type: 'object',
  properties: {
    _id: id,
    kind: { type: 'string', enum: ['scheduled', 'now', 'dry'] },
    status: {
      type: 'string',
      enum: ['researching', 'writing', 'publishing', 'done', 'failed', 'skipped'],
    },
    startedAt: ms,
    finishedAt: nullable(ms),
    found: { type: 'integer' },
    kept: { type: 'integer' },
    posted: { type: 'integer' },
    costUsd: { type: 'number' },
    last: { type: 'string', description: 'The latest log line' },
  },
}

export const Post = {
  type: 'object',
  properties: {
    _id: id,
    runId: id,
    automationId: id,
    storyId: id,
    channelId: { type: 'string' },
    channelName: { type: 'string' },
    service: { type: 'string' },
    text: { type: 'string' },
    thread: nullable({ type: 'array', items: { type: 'string' } }),
    linkAttachment: nullable({ type: 'object' }),
    status: {
      type: 'string',
      enum: [
        'dry',
        'rejected',
        'held',
        'draft',
        'queued',
        'scheduled',
        'sent',
        'failed',
        'deleted',
      ],
    },
    reason: nullable({ type: 'string' }),
    bufferPostId: nullable({ type: 'string' }),
    bufferStatus: nullable({ type: 'string' }),
    externalLink: nullable({ type: 'string' }),
    dueAt: nullable(ms),
    sentAt: nullable(ms),
    metrics: nullable({ type: 'array', items: { type: 'object' } }),
    createdAt: ms,
  },
}

export const Run = {
  type: 'object',
  properties: {
    _id: id,
    automationId: id,
    automationName: { type: 'string' },
    timezone: { type: 'string' },
    kind: { type: 'string' },
    status: { type: 'string' },
    startedAt: ms,
    finishedAt: nullable(ms),
    startedBy: { type: 'string', enum: ['schedule', 'app', 'api', 'hook', 'mcp', 'first'] },
    hint: nullable(Hint),
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: { step: { type: 'string' }, at: ms, note: { type: 'string' } },
      },
    },
    usage: { type: 'object' },
    costUsd: { type: 'number' },
    error: nullable({ type: 'string' }),
    shareToken: nullable({ type: 'string' }),
    stories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          _id: id,
          title: { type: 'string' },
          url: { type: 'string' },
          source: { type: 'string' },
          publishedAt: { type: 'string' },
          summary: { type: 'string' },
          whyItMatters: { type: 'string' },
          keyFacts: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
          decision: {
            type: 'string',
            enum: ['kept', 'skipped_dup', 'skipped_quality', 'skipped_limit', 'dry'],
          },
          reason: { type: 'string' },
        },
      },
    },
    posts: { type: 'array', items: { $ref: '#/components/schemas/Post' } },
  },
}

export const Webhook = {
  type: 'object',
  properties: {
    _id: id,
    url: { type: 'string' },
    events: { type: 'array', items: { type: 'string' } },
    automationId: nullable(id),
    active: { type: 'boolean' },
    createdAt: ms,
    lastDeliveryAt: nullable(ms),
    lastStatus: nullable({ type: 'string', enum: ['ok', 'failed'] }),
    failedInARow: { type: 'integer' },
  },
}

export const Delivery = {
  type: 'object',
  properties: {
    _id: id,
    event: { type: 'string' },
    attempt: { type: 'integer' },
    status: { type: 'string', enum: ['pending', 'ok', 'failed'] },
    responseStatus: nullable({ type: 'integer' }),
    error: nullable({ type: 'string' }),
    nextAttemptAt: nullable(ms),
    createdAt: ms,
    updatedAt: ms,
  },
}

export const Hook = {
  type: 'object',
  properties: {
    _id: id,
    automationId: id,
    name: { type: 'string' },
    prefix: { type: 'string' },
    createdAt: ms,
    lastUsedAt: nullable(ms),
    uses: { type: 'integer' },
  },
}

export const ErrorBody = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: {
          type: 'string',
          enum: [
            'unauthorized',
            'forbidden',
            'not_found',
            'invalid',
            'conflict',
            'allowance',
            'rate_limited',
            'buffer',
            'unavailable',
          ],
        },
        message: { type: 'string' },
        field: { type: 'string' },
        line: { type: 'integer', description: 'For playbook parse errors' },
      },
    },
  },
}

export const WEBHOOK_EVENT_DOCS: Record<string, string> = {
  'run.finished': 'A run ended (done, failed or skipped, dry runs too). Data: run, automation.',
  'post.created':
    'A post reached Buffer as a draft, in the queue or scheduled. Data: post, automation.',
  'post.approved': 'A draft was moved into the queue. Data: post, automation, from.',
  'post.sent': 'Buffer published a post. Data: post with externalLink, automation.',
  'automation.paused':
    'Dispatchlet paused an automation. Data: automation, reason (failures or lost_access).',
  'buffer.reauth_needed': 'Buffer access ended; the person must sign in again. Data: none.',
  ping: 'The test event, from settings or POST /webhooks/:id/test. Data: at.',
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const wrap = (key: string, schema: unknown) => ({ type: 'object', properties: { [key]: schema } })
const list = (key: string, name: string) => wrap(key, { type: 'array', items: ref(name) })

export const ROUTES: RouteRef[] = [
  {
    method: 'GET',
    path: '/me',
    scope: 'read',
    summary: 'The account behind the token',
    response: {
      type: 'object',
      properties: {
        id: id,
        email: nullable({ type: 'string' }),
        name: nullable({ type: 'string' }),
        timezone: { type: 'string' },
        allowance: {
          type: 'object',
          properties: {
            ownKey: { type: 'boolean' },
            runsLeft: nullable({ type: 'integer' }),
            dryRunsLeft: nullable({ type: 'integer' }),
          },
        },
        buffer: {
          type: 'object',
          properties: { connected: { type: 'boolean' }, needsReauth: { type: 'boolean' } },
        },
      },
    },
    example: {
      request: 'curl https://dispatchlet.com/api/v1/me -H "Authorization: Bearer dl_…"',
      response:
        '{ "id": "k17…", "email": "you@example.com", "timezone": "Africa/Johannesburg", "allowance": { "ownKey": false, "runsLeft": 7, "dryRunsLeft": 2 }, "buffer": { "connected": true, "needsReauth": false } }',
    },
  },
  {
    method: 'GET',
    path: '/channels',
    scope: 'read',
    summary: 'Your usable Buffer channels',
    response: list('channels', 'Channel'),
  },
  {
    method: 'POST',
    path: '/channels/sync',
    scope: 'write',
    summary: 'Read the channels from Buffer again',
    response: {
      type: 'object',
      properties: {
        synced: { type: 'integer' },
        channels: { type: 'array', items: ref('Channel') },
      },
    },
  },
  {
    method: 'GET',
    path: '/automations',
    scope: 'read',
    summary: 'List automations',
    response: list('automations', 'Automation'),
  },
  {
    method: 'POST',
    path: '/automations',
    scope: 'write',
    summary: 'Create an automation from the setup answers',
    description:
      'Returns 202 with status "generating". The playbook is written in the background; fetch the automation again in about a minute.',
    body: {
      type: 'object',
      required: ['setup', 'channelIds'],
      properties: {
        setup: ref('Setup'),
        channelIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
      },
    },
    status: 202,
    response: wrap('automation', ref('AutomationDetail')),
    example: {
      request: `curl -X POST https://dispatchlet.com/api/v1/automations -H "Authorization: Bearer dl_…" -H "Content-Type: application/json" -d '{"setup":{"research":"Formula 1 news","cadence":{"preset":"daily","time":"08:00","weekday":null},"maxStories":2,"postingMode":"draft"},"channelIds":["<buffer channel id>"]}'`,
      response:
        '{ "automation": { "_id": "kx7…", "name": "Formula 1 news", "status": "generating", … } }',
    },
  },
  {
    method: 'GET',
    path: '/automations/{id}',
    scope: 'read',
    summary: 'One automation with its playbook',
    response: wrap('automation', ref('AutomationDetail')),
  },
  {
    method: 'PATCH',
    path: '/automations/{id}',
    scope: 'write',
    summary: 'Change schedule, channels, posting mode, story count or status',
    body: {
      type: 'object',
      properties: {
        cadence: ref('Cadence'),
        channelIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
        postingMode: { type: 'string', enum: ['draft', 'queue', 'spread'] },
        maxPostsPerRun: { type: 'integer', minimum: 1, maximum: 3 },
        status: {
          type: 'string',
          enum: ['active', 'paused'],
          description: 'active enables the schedule, paused stops it',
        },
      },
    },
    response: wrap('automation', ref('AutomationDetail')),
    example: {
      request: `curl -X PATCH https://dispatchlet.com/api/v1/automations/kx7… -H "Authorization: Bearer dl_…" -H "Content-Type: application/json" -d '{"status":"paused"}'`,
      response: '{ "automation": { "_id": "kx7…", "status": "paused", "nextRunAt": null, … } }',
    },
  },
  {
    method: 'DELETE',
    path: '/automations/{id}',
    scope: 'write',
    summary: 'Delete an automation',
    response: { type: 'object', properties: { deleted: { type: 'boolean' } } },
  },
  {
    method: 'GET',
    path: '/automations/{id}/playbook',
    scope: 'read',
    summary: 'The playbook, as JSON or as text',
    description:
      'Send `Accept: text/markdown` for the text the editor shows; otherwise JSON with both.',
    response: {
      type: 'object',
      properties: {
        version: { type: 'integer' },
        createdBy: { type: 'string' },
        createdAt: ms,
        playbook: { type: 'object' },
        text: { type: 'string' },
      },
    },
    example: {
      request:
        'curl https://dispatchlet.com/api/v1/automations/kx7…/playbook -H "Authorization: Bearer dl_…" -H "Accept: text/markdown"',
      response: '# Formula 1 news\n\n## About\n…',
    },
  },
  {
    method: 'PUT',
    path: '/automations/{id}/playbook',
    scope: 'write',
    summary: 'Replace the playbook text as a new version',
    description:
      'Send the text with `Content-Type: text/markdown`, or JSON `{ "text" }`. A parse error comes back as 400 with the line.',
    bodyType: 'text/markdown',
    body: { type: 'string' },
    response: {
      type: 'object',
      properties: {
        version: { type: 'integer' },
        text: { type: 'string' },
        playbook: { type: 'object' },
      },
    },
  },
  {
    method: 'POST',
    path: '/automations/{id}/rules',
    scope: 'write',
    summary: 'Add a skip rule to the playbook',
    body: {
      type: 'object',
      required: ['rule'],
      properties: { rule: { type: 'string', minLength: 3, maxLength: 200 } },
    },
    response: { type: 'object', properties: { version: { type: 'integer' } } },
    example: {
      request: `curl -X POST https://dispatchlet.com/api/v1/automations/kx7…/rules -H "Authorization: Bearer dl_…" -H "Content-Type: application/json" -d '{"rule":"Skip driver contract rumours"}'`,
      response: '{ "version": 4 }',
    },
  },
  {
    method: 'POST',
    path: '/automations/{id}/runs',
    scope: 'write',
    summary: 'Start a run or a dry run',
    description:
      'Returns 202 at once; poll GET /runs/{id} until finishedAt is set. 409 when a run is going, 402 when the allowance is spent.',
    body: {
      type: 'object',
      properties: { dry: { type: 'boolean', default: false }, hint: ref('Hint') },
    },
    status: 202,
    response: wrap('run', ref('Run')),
    example: {
      request: `curl -X POST https://dispatchlet.com/api/v1/automations/kx7…/runs -H "Authorization: Bearer dl_…" -H "Content-Type: application/json" -d '{"dry":true}'`,
      response:
        '{ "run": { "_id": "j57…", "kind": "dry", "status": "researching", "startedBy": "api", "steps": [ … ], "stories": [], "posts": [] } }',
    },
  },
  {
    method: 'GET',
    path: '/automations/{id}/runs',
    scope: 'read',
    summary: 'Runs of an automation, newest first',
    query: {
      limit: { type: 'integer', description: '1 to 50, default 20' },
      before: { type: 'integer', description: 'Only runs started before this time (ms)' },
    },
    response: list('runs', 'RunSummary'),
  },
  {
    method: 'GET',
    path: '/runs/{id}',
    scope: 'read',
    summary: 'One run: steps, stories, posts, cost',
    response: wrap('run', ref('Run')),
  },
  {
    method: 'POST',
    path: '/runs/{id}/share',
    scope: 'write',
    summary: 'Make a run readable by link',
    response: { type: 'object', properties: { url: { type: 'string' } } },
  },
  {
    method: 'GET',
    path: '/posts',
    scope: 'read',
    summary: 'Posts, newest first',
    query: {
      status: {
        type: 'string',
        description: 'draft, queued, scheduled, sent, failed, held, rejected or dry',
      },
      automation: { type: 'string', description: 'Only this automation' },
      since: { type: 'integer', description: 'Created after this time (ms)' },
      limit: { type: 'integer', description: '1 to 100, default 50' },
    },
    response: list('posts', 'Post'),
    example: {
      request:
        'curl "https://dispatchlet.com/api/v1/posts?status=draft" -H "Authorization: Bearer dl_…"',
      response:
        '{ "posts": [ { "_id": "k9a…", "channelName": "GrandPrixPicks", "service": "twitter", "text": "…", "status": "draft", … } ] }',
    },
  },
  {
    method: 'GET',
    path: '/posts/{id}',
    scope: 'read',
    summary: 'One post',
    response: wrap('post', ref('Post')),
  },
  {
    method: 'PATCH',
    path: '/posts/{id}',
    scope: 'write',
    summary: 'Change a draft\u2019s text before approving it',
    description:
      'Drafts only. The text must fit the channel as the service counts it; it is saved in Buffer as a draft.',
    body: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } },
    response: { type: 'object', properties: { post: ref('Post'), message: { type: 'string' } } },
  },
  {
    method: 'POST',
    path: '/posts/{id}/approve',
    scope: 'write',
    summary: 'Move a draft into the Buffer queue',
    description: "Calls Buffer's editPost. Already-queued posts come back unchanged.",
    response: { type: 'object', properties: { post: ref('Post'), message: { type: 'string' } } },
    example: {
      request:
        'curl -X POST https://dispatchlet.com/api/v1/posts/k9a…/approve -H "Authorization: Bearer dl_…"',
      response:
        '{ "post": { "_id": "k9a…", "status": "queued", … }, "message": "Added to your Buffer queue." }',
    },
  },
  {
    method: 'GET',
    path: '/webhooks',
    scope: 'read',
    summary: 'List webhooks',
    response: list('webhooks', 'Webhook'),
  },
  {
    method: 'POST',
    path: '/webhooks',
    scope: 'write',
    summary: 'Add a webhook',
    description:
      'The signing secret is in the response once. See /docs/webhooks for the events and the signature.',
    body: {
      type: 'object',
      required: ['url', 'events'],
      properties: {
        url: { type: 'string', format: 'uri', description: 'https only, public host' },
        events: {
          type: 'array',
          items: { type: 'string', enum: Object.keys(WEBHOOK_EVENT_DOCS) },
          minItems: 1,
        },
        automationId: { type: 'string', description: 'Only events of this automation' },
      },
    },
    status: 201,
    response: {
      type: 'object',
      properties: { webhook: ref('Webhook'), secret: { type: 'string' } },
    },
    example: {
      request: `curl -X POST https://dispatchlet.com/api/v1/webhooks -H "Authorization: Bearer dl_…" -H "Content-Type: application/json" -d '{"url":"https://hooks.zapier.com/hooks/catch/1/2","events":["post.approved","post.sent"]}'`,
      response:
        '{ "webhook": { "_id": "kw1…", "url": "https://hooks.zapier.com/hooks/catch/1/2", "events": ["post.approved","post.sent"], "active": true, … }, "secret": "whsec_…" }',
    },
  },
  {
    method: 'DELETE',
    path: '/webhooks/{id}',
    scope: 'write',
    summary: 'Delete a webhook',
    response: { type: 'object', properties: { deleted: { type: 'boolean' } } },
  },
  {
    method: 'POST',
    path: '/webhooks/{id}/test',
    scope: 'write',
    summary: 'Send a ping event now',
    status: 202,
    response: { type: 'object', properties: { deliveryId: id } },
  },
  {
    method: 'GET',
    path: '/webhooks/{id}/deliveries',
    scope: 'read',
    summary: 'The last 50 deliveries',
    response: list('deliveries', 'Delivery'),
  },
  {
    method: 'GET',
    path: '/hooks',
    scope: 'read',
    summary: 'List inbound hook URLs',
    response: list('hooks', 'Hook'),
  },
  {
    method: 'POST',
    path: '/hooks',
    scope: 'write',
    summary: 'Make an inbound hook URL for an automation',
    description: 'The URL is in the response once. POST to it to start a run; see /docs/hooks.',
    body: {
      type: 'object',
      required: ['automationId', 'name'],
      properties: { automationId: id, name: { type: 'string', maxLength: 40 } },
    },
    status: 201,
    response: {
      type: 'object',
      properties: {
        _id: id,
        prefix: { type: 'string' },
        token: { type: 'string' },
        url: { type: 'string' },
      },
    },
  },
  {
    method: 'DELETE',
    path: '/hooks/{id}',
    scope: 'write',
    summary: 'Delete an inbound hook',
    response: { type: 'object', properties: { deleted: { type: 'boolean' } } },
  },
  {
    method: 'POST',
    path: '/hooks/{token}',
    scope: 'none',
    summary: 'Start a run from an inbound hook (no bearer token)',
    description:
      'The token in the URL is the credential. Body: empty (run now), `{ "title", "url"?, "notes"?, "dry"? }`, or a GitHub release webhook (X-GitHub-Event: release). 10 a minute per hook.',
    body: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        url: { type: 'string' },
        notes: { type: 'string' },
        dry: { type: 'boolean' },
      },
    },
    status: 202,
    response: {
      type: 'object',
      properties: { run: { type: 'object', properties: { id: id, url: { type: 'string' } } } },
    },
    example: {
      request: `curl -X POST https://dispatchlet.com/api/v1/hooks/dlh_… -H "Content-Type: application/json" -d '{"title":"Dispatchlet 1.2 is out","url":"https://github.com/barrymichaeldoyle/dispatchlet/releases/tag/v1.2.0"}'`,
      response:
        '{ "run": { "id": "j57…", "url": "https://dispatchlet.com/app/a/kx7…/runs/j57…" } }',
    },
  },
  {
    method: 'GET',
    path: '/openapi.json',
    scope: 'none',
    summary: 'This document',
    response: { type: 'object' },
  },
]

export const SCHEMAS = {
  Cadence,
  Setup,
  Automation,
  AutomationDetail,
  Channel,
  Hint,
  RunSummary,
  Run,
  Post,
  Webhook,
  Delivery,
  Hook,
  Error: ErrorBody,
}
