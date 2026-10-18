import { createMiddleware, createStart } from '@tanstack/react-start'
import { SECURITY_HEADERS } from './lib/security-headers'

/** Adds the security headers to everything the Worker renders. Dev is left alone for Vite. */
const securityHeaders = createMiddleware().server(async ({ next }) => {
  const result = await next()
  if (!import.meta.env.PROD) return result
  let { response } = result
  try {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value)
  } catch {
    // Some upstream responses have immutable headers; copy them into a response we own.
    response = new Response(response.body, response)
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value)
  }
  return { ...result, response }
})

export const startInstance = createStart(() => ({ requestMiddleware: [securityHeaders] }))
