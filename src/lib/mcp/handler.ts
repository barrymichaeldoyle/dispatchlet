import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { apiClient } from './api'
import { createDispatchletServer } from './server'

/**
 * One MCP request (SPEC §44.6): Streamable HTTP, stateless, JSON responses. A new server and
 * transport per request, so nothing is kept between calls. `apiToken` is the caller's Dispatchlet
 * token, sent straight or held in an OAuth grant; every tool call goes to the API with it.
 */
export async function handleMcp(
  request: Request,
  apiToken: string,
  apiBase: string,
  origin: string,
): Promise<Response> {
  const server = createDispatchletServer(apiClient(apiBase, apiToken), origin)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  try {
    return await transport.handleRequest(request)
  } finally {
    void transport.close().catch(() => undefined)
  }
}

/** The 401 for a request with no usable token, pointing MCP clients at the OAuth metadata. */
export function mcpUnauthorized(origin: string, message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message }, id: null }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", error="invalid_token"`,
      },
    },
  )
}

/** The API token from an Authorization header, when it has the shape of one. */
export function bearerApiToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? ''
  return /^Bearer\s+(dl_[A-Za-z0-9_-]{43})$/i.exec(header.trim())?.[1] ?? null
}
