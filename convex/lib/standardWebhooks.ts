/**
 * Outbound webhooks (SPEC §44.4), signed the Standard Webhooks way: `webhook-id`,
 * `webhook-timestamp` (unix seconds) and `webhook-signature` = "v1," + base64(HMAC-SHA256(secret,
 * `${id}.${timestamp}.${body}`)). Any Standard Webhooks library verifies it; so does the ten-line
 * verifier on /docs/webhooks.
 */

export const WEBHOOK_EVENTS = [
  'run.finished',
  'post.created',
  'post.approved',
  'post.sent',
  'automation.paused',
  'buffer.reauth_needed',
  'ping',
] as const
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]

export const SECRET_PREFIX = 'whsec_'

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** A new signing secret: `whsec_` plus 24 random bytes in base64. */
export function generateWebhookSecret(): string {
  return SECRET_PREFIX + toBase64(crypto.getRandomValues(new Uint8Array(24)))
}

/** The key bytes: the base64 after `whsec_` when that decodes, else the secret's own bytes. */
function keyBytes(secret: string): Uint8Array<ArrayBuffer> {
  if (secret.startsWith(SECRET_PREFIX)) {
    try {
      return fromBase64(secret.slice(SECRET_PREFIX.length))
    } catch {
      // Not base64: fall through and use the text as the key, as the spec's libraries do.
    }
  }
  return new TextEncoder().encode(secret) as Uint8Array<ArrayBuffer>
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'raw',
    keyBytes(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

/** The `webhook-signature` header value for one delivery. */
export async function signWebhook(
  secret: string,
  id: string,
  timestamp: number,
  body: string,
): Promise<string> {
  const data = new TextEncoder().encode(`${id}.${timestamp}.${body}`)
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(secret), data)
  return `v1,${toBase64(new Uint8Array(mac))}`
}

/** The verifier receivers can copy. Accepts any `v1,` signature in the header, 5 minutes of skew. */
export async function verifyWebhook(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  now = Date.now(),
): Promise<boolean> {
  if (!headers.id || !headers.timestamp || !headers.signature) return false
  const ts = Number(headers.timestamp)
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false
  const expected = await signWebhook(secret, headers.id, ts, body)
  return headers.signature.split(' ').some((candidate) => candidate === expected)
}

/** The envelope every delivery carries. */
export function envelope(id: string, type: WebhookEvent, createdAt: number, data: unknown): string {
  return JSON.stringify({ id, type, createdAt, data })
}

/**
 * Why a webhook URL is refused (SPEC §44.10): not https, a loopback or private host, or a name
 * that cannot be public. Null when it is fine. Checked by name only; DNS is not consulted.
 */
export function webhookUrlProblem(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'That is not a URL.'
  }
  if (url.protocol !== 'https:') return 'Webhook URLs must use https.'
  if (url.username || url.password) return 'Leave credentials out of the URL.'
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  )
    return 'That host is not reachable from the internet.'
  if (!host.includes('.') && !host.includes(':')) return 'Use a full host name.'
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    )
      return 'That address is private.'
  }
  if (host.includes(':')) {
    if (host === '::1' || host === '::' || /^f[cd]/i.test(host) || /^fe[89ab]/i.test(host))
      return 'That address is private.'
  }
  return null
}
