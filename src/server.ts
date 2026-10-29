import { AuthorizationError, OAuthProvider } from '@cloudflare/workers-oauth-provider'
import handler from '@tanstack/react-start/server-entry'
import { bearerApiToken, handleMcp, mcpUnauthorized } from './lib/mcp/handler'
import {
  apiTokenOwner,
  consentUrl,
  grantedScopes,
  OAUTH_SCOPES,
  providerOrigin,
  type GrantProps,
} from './lib/oauth'

/**
 * The Worker entry: TanStack Start for the site and app, wrapped by the OAuth provider so MCP
 * clients that need OAuth (claude.ai connectors) can connect (SPEC §44.7). The provider owns
 * /oauth/token, /oauth/register and the /.well-known metadata; /oauth/authorize is ours below; /mcp
 * is the protected resource. Everything else goes to Start unchanged.
 */

type KvLike = {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}
type Env = { OAUTH_KV: KvLike; OAUTH_PROVIDER: OAuthHelpersLike }
type Ctx = { waitUntil(promise: Promise<unknown>): void; props?: unknown }

/** The helpers this file uses; the library types them fully, this keeps the Worker types local. */
type OAuthHelpersLike = {
  parseAuthRequest(request: Request): Promise<{ scope: string[] }>
  describeConsent(request: unknown): Promise<{
    clientName: string
    clientDomain?: string
    redirectHost: string
    redirectIsLoopback: boolean
    scope: string[]
  }>
  beginConsent(request: unknown): Promise<{ handle: string; headers: Headers }>
  approveConsent(
    request: Request,
    handle: string,
    options: { scope: string[] },
  ): Promise<{ request: { scope: string[] }; headers: Headers }>
  denyConsent(request: Request, handle: string): Promise<{ redirectTo: string; headers: Headers }>
  completeAuthorization(options: {
    request: unknown
    userId: string
    metadata: unknown
    scope: string[]
    props: GrantProps
  }): Promise<{ redirectTo: string }>
}

const CONVEX_SITE_URL = (import.meta.env.VITE_CONVEX_URL as string | undefined)?.replace(
  /\.convex\.cloud\/?$/,
  '.convex.site',
)
const API_BASE = `${CONVEX_SITE_URL}/v1`

const startFetch = (request: Request) => handler.fetch(request)

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

function json(status: number, body: unknown, headers?: Headers): Response {
  const out = new Headers(headers)
  out.set('Content-Type', 'application/json')
  out.set('Cache-Control', 'no-store')
  return new Response(JSON.stringify(body), { status, headers: out })
}

/**
 * GET: validate the client's request and hand the person to the consent page with a one-time
 * handle (bound to this browser by a cookie). POST: the page's Allow or Deny, as JSON, answered
 * with where to send the browser. JSON rather than a form post, so the site's form-action policy
 * does not block the redirect back to the client.
 */
async function authorize(request: Request, env: Env, origin: string): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER
  try {
    if (request.method === 'GET') {
      const authRequest = await oauth.parseAuthRequest(request)
      const details = await oauth.describeConsent(authRequest)
      const consent = await oauth.beginConsent(authRequest)
      consent.headers.set('Location', consentUrl(origin, { handle: consent.handle, ...details }))
      return new Response(null, { status: 302, headers: consent.headers })
    }
    if (request.method !== 'POST') return text(405, 'Method not allowed.')
    if (request.headers.get('origin') !== origin) return text(403, 'Cross-site request refused.')
    const body = (await request
      .clone()
      .json()
      .catch(() => null)) as {
      handle?: unknown
      decision?: unknown
      token?: unknown
    } | null
    const handle = typeof body?.handle === 'string' ? body.handle : ''
    if (!handle) return json(400, { error: 'This page has expired. Start again from the app.' })
    if (body?.decision !== 'approve') {
      const denied = await oauth.denyConsent(request, handle)
      return json(200, { redirectTo: denied.redirectTo }, denied.headers)
    }
    const token = typeof body.token === 'string' ? body.token : ''
    const owner = token ? await apiTokenOwner(API_BASE, token) : null
    if (!owner) return json(400, { error: 'That token is not valid. Start again from the app.' })
    const { userId } = owner
    // The grant says what the token can do; the page's checkbox only chose the token's scope.
    const scope = grantedScopes(owner.write)
    const approved = await oauth.approveConsent(request, handle, { scope })
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId,
      metadata: {},
      scope: approved.request.scope,
      props: { apiToken: token, userId },
    })
    return json(200, { redirectTo }, approved.headers)
  } catch (error) {
    if (error instanceof AuthorizationError) {
      const redirectTo = (error as AuthorizationError & { redirectTo?: string }).redirectTo
      if (request.method === 'GET' && redirectTo) return Response.redirect(redirectTo, 302)
      const message = error.description || 'This sign-in request is not valid.'
      return request.method === 'GET' ? text(400, message) : json(400, { error: message })
    }
    throw error
  }
}

const providers = new Map<string, OAuthProvider<Env>>()

function providerFor(origin: string): OAuthProvider<Env> {
  let provider = providers.get(origin)
  if (provider) return provider
  provider = new OAuthProvider<Env>({
    apiRoute: '/mcp',
    apiHandler: {
      fetch: (request: Request, _env: Env, ctx: Ctx) =>
        handleMcp(request, (ctx.props as GrantProps).apiToken, API_BASE, origin),
    } as never,
    defaultHandler: {
      fetch: (request: Request, env: Env) =>
        new URL(request.url).pathname === '/oauth/authorize'
          ? authorize(request, env, origin)
          : startFetch(request),
    } as never,
    authorizeEndpoint: '/oauth/authorize',
    tokenEndpoint: '/oauth/token',
    clientRegistrationEndpoint: '/oauth/register',
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: [...OAUTH_SCOPES],
    requiredScopes: ['read'],
    resourceMetadata: {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      resource_name: 'Dispatchlet',
    } as never,
    // A pasted Dispatchlet token keeps working on /mcp: checked with the API, then used as is.
    resolveExternalToken: async ({ token }: { token: string }) => {
      if (!/^dl_[A-Za-z0-9_-]{43}$/.test(token)) return null
      const owner = await apiTokenOwner(API_BASE, token)
      if (!owner) return null
      return {
        props: { apiToken: token, userId: owner.userId } satisfies GrantProps,
        audience: `${origin}/mcp`,
      }
    },
  } as never)
  providers.set(origin, provider)
  return provider
}

export default {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    if (!CONVEX_SITE_URL) return startFetch(request)
    const url = new URL(request.url)
    const origin = providerOrigin(url)
    if (origin) return await providerFor(origin).fetch(request, env as never, ctx as never)
    // Other hosts (workers.dev): MCP with a pasted token only, no OAuth.
    if (url.pathname === '/mcp') {
      const token = bearerApiToken(request)
      if (!token)
        return mcpUnauthorized(url.origin, 'Send a Dispatchlet API token as a Bearer token.')
      return await handleMcp(request, token, API_BASE, url.origin)
    }
    return startFetch(request)
  },
  /**
   * Daily: sweeps OAuth grants and tokens that expired without their KV TTL removing them, in
   * batches, carrying a cursor between runs so a large store is covered over several days.
   */
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const provider = providerFor('https://dispatchlet.com') as unknown as {
      purgeExpiredData(
        env: Env,
        options: { batchSize: number; cursor?: string },
      ): Promise<{ cursor?: string }>
    }
    const cursor = (await env.OAUTH_KV.get('purge-cursor')) ?? undefined
    const result = await provider.purgeExpiredData(env, { batchSize: 100, cursor })
    if (result.cursor) await env.OAUTH_KV.put('purge-cursor', result.cursor)
    else await env.OAUTH_KV.delete('purge-cursor')
  },
}
