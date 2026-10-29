/**
 * Personal API tokens and inbound hook tokens (SPEC §44.2, §44.5). A token is a prefix plus 32
 * random bytes in base64url. Only its SHA-256 hash is stored; the first eight characters after
 * the prefix are kept for display, so a person can tell tokens apart without seeing them again.
 */

export const TOKEN_PREFIX = 'dl_'
export const HOOK_PREFIX = 'dlh_'

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** A new secret with the given prefix. 32 random bytes, 43 characters of base64url. */
export function generateSecret(prefix: string): string {
  return prefix + base64url(crypto.getRandomValues(new Uint8Array(32)))
}

/** SHA-256 of the whole token, hex. What the database keeps. */
export async function hashSecret(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** The part shown in settings: the prefix and the first eight characters after it. */
export function displayPrefix(token: string, prefix: string): string {
  return prefix + token.slice(prefix.length, prefix.length + 8)
}

/** Whether a string has the shape of one of our tokens. Cheap check before a database read. */
export function looksLikeSecret(token: string, prefix: string): boolean {
  return (
    token.startsWith(prefix) &&
    token.length === prefix.length + 43 &&
    /^[A-Za-z0-9_-]+$/.test(token.slice(prefix.length))
  )
}

/** The bearer token from an Authorization header, or null. */
export function bearerFrom(header: string | null): string | null {
  if (!header) return null
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  return match?.[1] ?? null
}
