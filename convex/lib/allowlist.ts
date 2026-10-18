/** Comma-separated values from a Convex env var, trimmed and lower-cased. */
function listFromEnv(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

/** Sign-up is open to everyone once `SIGNUP_OPEN` is `true`. It is set by hand on launch day. */
export function isSignupOpen(): boolean {
  return process.env.SIGNUP_OPEN?.trim().toLowerCase() === 'true'
}

/**
 * Until the public launch only allowlisted Buffer accounts get past sign-in:
 * `ALLOWED_BUFFER_IDS` (Buffer account IDs) or `ALLOWED_EMAILS`. No date opens it; setting
 * `SIGNUP_OPEN=true` lets everyone in.
 */
export function isAllowlisted(bufferId: string | null, email: string | null): boolean {
  return (
    isSignupOpen() ||
    (bufferId !== null && listFromEnv('ALLOWED_BUFFER_IDS').includes(bufferId.toLowerCase())) ||
    (email !== null && listFromEnv('ALLOWED_EMAILS').includes(email.toLowerCase()))
  )
}
