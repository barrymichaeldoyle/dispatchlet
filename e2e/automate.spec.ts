import { expect, test } from '@playwright/test'

// The public half of SPEC §44: docs, discovery and the signed-out consent page. Read-only, so it
// is safe against production too.

test('the automation docs are linked and render', async ({ page }) => {
  for (const [path, heading] of [
    ['/docs/api', 'The Dispatchlet API'],
    ['/docs/webhooks', 'Webhooks'],
    ['/docs/hooks', 'Inbound hooks'],
    ['/docs/mcp', 'The MCP server'],
  ]) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
  }
  await page.goto('/docs')
  await expect(page.getByRole('link', { name: 'The API' })).toHaveAttribute('href', '/docs/api')
})

test('the API reference lists the routes from the OpenAPI document', async ({ page, request }) => {
  const doc = await (await request.get('/api/v1/openapi.json')).json()
  expect(doc.openapi).toBe('3.1.0')
  await page.goto('/docs/api')
  for (const path of ['/automations/{id}/runs', '/posts/{id}/approve', '/webhooks'])
    expect(doc.paths[path]).toBeTruthy()
  await expect(page.getByText('POST /posts/{id}/approve')).toBeVisible()
})

test('MCP answers an unauthenticated call with the OAuth discovery challenge', async ({
  request,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin
  const res = await request.post('/mcp', { data: {}, failOnStatusCode: false })
  expect(res.status()).toBe(401)
  expect(res.headers()['www-authenticate']).toContain(
    `resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
  )
  const resource = await (await request.get('/.well-known/oauth-protected-resource/mcp')).json()
  expect(resource.resource).toBe(`${origin}/mcp`)
  const server = await (await request.get('/.well-known/oauth-authorization-server')).json()
  expect(server.registration_endpoint).toBe(`${origin}/oauth/register`)
  expect(server.code_challenge_methods_supported).toEqual(['S256'])
})

test('the API refuses a call without a token', async ({ request }) => {
  const res = await request.get('/api/v1/me', { failOnStatusCode: false })
  expect(res.status()).toBe(401)
  expect((await res.json()).error.code).toBe('unauthorized')
})

test('the consent page asks a signed-out person to sign in, and stays out of search', async ({
  page,
}) => {
  await page.goto('/oauth/consent?handle=x&client=Claude&redirect=claude.ai')
  await expect(page.getByRole('heading', { name: 'Sign in to connect Claude.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in with Buffer' })).toBeEnabled()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
})

test('a client name is shown as text, never as markup', async ({ page }) => {
  await page.goto(
    '/oauth/consent?handle=x&client=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E&redirect=claude.ai',
  )
  await expect(page.getByRole('heading', { name: /Sign in to connect <img/ })).toBeVisible()
  expect(await page.locator('img[src="x"]').count()).toBe(0)
})

test('llms.txt points at the API and the MCP server', async ({ request }) => {
  const text = await (await request.get('/llms.txt')).text()
  expect(text).toContain('/api/v1/openapi.json')
  expect(text).toContain('/mcp')
})
