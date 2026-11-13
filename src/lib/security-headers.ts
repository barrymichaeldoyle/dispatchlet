/**
 * Security headers for every response. Prerendered pages are static assets served from
 * public/_headers; everything the Worker renders gets them from the request middleware in
 * src/start.ts. A unit test keeps the two in step.
 *
 * Scripts and styles allow 'unsafe-inline' because the theme script and the router's hydration
 * data are inline; everything else is limited to this site, Convex, PostHog and Cloudflare's
 * analytics beacon. Convex is named by deployment (production, then dev), not *.convex.cloud, so a
 * script that did get in could not send data to a Convex deployment of its own. A self-hosted copy
 * puts its own deployments here and in public/_headers.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self' https://amiable-mosquito-364.convex.cloud wss://amiable-mosquito-364.convex.cloud https://polite-marlin-194.convex.cloud wss://polite-marlin-194.convex.cloud https://amiable-mosquito-364.convex.site https://polite-marlin-194.convex.site https://eu.i.posthog.com https://eu-assets.i.posthog.com https://o299144.ingest.us.sentry.io https://cloudflareinsights.com",
  "form-action 'self' https://amiable-mosquito-364.convex.site https://polite-marlin-194.convex.site",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ')

export const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
}
