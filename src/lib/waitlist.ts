const cloudUrl = import.meta.env.VITE_CONVEX_URL as string | undefined

/** The Convex HTTP actions domain, derived from the deployment URL when not set directly. */
const CONVEX_SITE_URL: string | undefined =
  (import.meta.env.VITE_CONVEX_SITE_URL as string | undefined) ??
  cloudUrl?.replace('.convex.cloud', '.convex.site')

export const WAITLIST_ACTION = `${CONVEX_SITE_URL ?? ''}/waitlist`
