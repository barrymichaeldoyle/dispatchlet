import { createFileRoute } from '@tanstack/react-router'

/**
 * The REST API lives on dispatchlet.com/api/v1 (SPEC §44.3). The handlers are Convex HTTP
 * actions on the Convex site at /v1/*; this route passes the request through unchanged, with the
 * caller's address so the hook rate limit can see it.
 */
const CONVEX_SITE_URL = (import.meta.env.VITE_CONVEX_URL as string | undefined)?.replace(
  /\.convex\.cloud\/?$/,
  '.convex.site',
)

const FORWARDED_HEADERS = [
  'authorization',
  'content-type',
  'accept',
  'user-agent',
  'x-github-event',
  'x-github-delivery',
  'cf-connecting-ip',
]

async function forward({ request }: { request: Request }): Promise<Response> {
  if (!CONVEX_SITE_URL)
    return new Response(
      JSON.stringify({ error: { code: 'unavailable', message: 'The API is not configured.' } }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  const url = new URL(request.url)
  const path = url.pathname.replace(/^\/api\/v1/, '/v1')
  const headers = new Headers()
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  const response = await fetch(`${CONVEX_SITE_URL}${path}${url.search}`, {
    method: request.method,
    headers,
    body:
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await request.arrayBuffer(),
    redirect: 'manual',
  })
  return new Response(response.body, { status: response.status, headers: response.headers })
}

export const Route = createFileRoute('/api/v1/$')({
  server: {
    handlers: {
      GET: forward,
      POST: forward,
      PUT: forward,
      PATCH: forward,
      DELETE: forward,
      OPTIONS: forward,
    },
  },
})
