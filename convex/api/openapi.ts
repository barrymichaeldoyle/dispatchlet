import { ROUTES, SCHEMAS } from './reference'

/** OpenAPI 3.1 for the REST API, built from the route table. Served at /api/v1/openapi.json. */
export function openApiDocument(site: string) {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const r of ROUTES) {
    const op: Record<string, unknown> = {
      summary: r.summary,
      description: r.description,
      security: r.scope === 'none' ? [] : [{ bearer: [] }],
      'x-scope': r.scope,
      parameters: [
        ...[...r.path.matchAll(/\{(\w+)\}/g)].map((m) => ({
          name: m[1],
          in: 'path',
          required: true,
          schema: { type: 'string' },
        })),
        ...Object.entries(r.query ?? {}).map(([name, q]) => ({
          name,
          in: 'query',
          required: false,
          schema: { type: q.type },
          description: q.description,
        })),
      ],
      responses: {
        [String(r.status ?? 200)]: {
          description: 'OK',
          content: { 'application/json': { schema: r.response } },
        },
        default: {
          description: 'An error',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    }
    if (r.body)
      op.requestBody = {
        required: r.method !== 'POST' || r.path !== '/automations/{id}/runs',
        content: { [r.bodyType ?? 'application/json']: { schema: r.body } },
      }
    paths[r.path] = { ...paths[r.path], [r.method.toLowerCase()]: op }
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Dispatchlet API',
      version: '1',
      description:
        'Automate Dispatchlet: list and change automations, start runs, read the log, approve drafts, manage webhooks. Tokens come from Settings; see https://dispatchlet.com/docs/api.',
      contact: { email: 'barry@dispatchlet.com' },
    },
    servers: [{ url: `${site}/api/v1` }],
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'dl_… from Settings → API tokens' },
      },
      schemas: SCHEMAS,
    },
    paths,
  }
}
