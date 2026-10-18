import { createFileRoute } from '@tanstack/react-router'

/**
 * Sign-in runs on dispatchlet.com rather than the Convex site URL, so Buffer's consent screen shows
 * our domain. Convex Auth is pointed here with CUSTOM_AUTH_SITE_URL, and this route passes the
 * request straight through: same path, query, cookies and body, and the redirect and Set-Cookie
 * headers come back unchanged, so the sign-in cookies live on dispatchlet.com.
 */
const CONVEX_SITE_URL = (import.meta.env.VITE_CONVEX_URL as string | undefined)?.replace(
  /\.convex\.cloud\/?$/,
  '.convex.site',
)

const FORWARDED_HEADERS = ['cookie', 'content-type', 'accept', 'user-agent']

async function forward({ request }: { request: Request }): Promise<Response> {
  if (!CONVEX_SITE_URL) return new Response('Sign-in is not configured.', { status: 503 })
  const url = new URL(request.url)
  const headers = new Headers()
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  const response = await fetch(`${CONVEX_SITE_URL}${url.pathname}${url.search}`, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text(),
    redirect: 'manual',
  })
  return new Response(response.body, { status: response.status, headers: response.headers })
}

export const Route = createFileRoute('/api/auth/$')({
  server: { handlers: { GET: forward, POST: forward } },
})
