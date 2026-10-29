import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createFileRoute } from '@tanstack/react-router'
import { apiClient } from '../lib/mcp/api'
import { createDispatchletServer } from '../lib/mcp/server'

/**
 * The MCP server (SPEC §44.6): Streamable HTTP, stateless, bearer token. A new server and
 * transport per request, so nothing is kept between calls and nothing of the caller's is held.
 */
const CONVEX_SITE_URL = (import.meta.env.VITE_CONVEX_URL as string | undefined)?.replace(
  /\.convex\.cloud\/?$/,
  '.convex.site',
)

function unauthorized(request: Request, message: string): Response {
  const origin = new URL(request.url).origin
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message }, id: null }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", error="invalid_token", error_description="${message}"`,
      },
    },
  )
}

async function handle({ request }: { request: Request }): Promise<Response> {
  if (!CONVEX_SITE_URL) return new Response('The MCP server is not configured.', { status: 503 })
  const auth = request.headers.get('authorization') ?? ''
  const token = /^Bearer\s+(dl_[A-Za-z0-9_-]+)$/i.exec(auth.trim())?.[1]
  if (!token)
    return unauthorized(
      request,
      'Send a Dispatchlet API token as a Bearer token. Make one under Settings → API tokens at https://dispatchlet.com/app/settings.',
    )
  const origin = new URL(request.url).origin
  const server = createDispatchletServer(apiClient(`${CONVEX_SITE_URL}/v1`, token), origin)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  try {
    return await transport.handleRequest(request)
  } finally {
    // Stateless: nothing to keep once the response is built.
    void transport.close().catch(() => undefined)
  }
}

export const Route = createFileRoute('/mcp')({
  server: { handlers: { GET: handle, POST: handle, DELETE: handle } },
})
