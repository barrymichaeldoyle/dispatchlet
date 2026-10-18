/** Comma-separated values from a Convex env var, trimmed and lower-cased. */
function listFromEnv(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Until the public launch only allowlisted Buffer accounts get past sign-in:
 * `ALLOWED_BUFFER_IDS` (Buffer account IDs) or `ALLOWED_EMAILS`. No date opens it.
 */
export function isAllowlisted(bufferId: string | null, email: string | null): boolean {
  return (
    (bufferId !== null && listFromEnv('ALLOWED_BUFFER_IDS').includes(bufferId.toLowerCase())) ||
    (email !== null && listFromEnv('ALLOWED_EMAILS').includes(email.toLowerCase()))
  )
}
