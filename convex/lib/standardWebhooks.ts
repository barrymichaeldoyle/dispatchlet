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

/** Whether an IPv4 address (dotted) is private, loopback, link-local, shared or reserved. */
export function isPrivateIPv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  )
}

/** Expands an IPv6 address to eight 16-bit groups, or null when it is not one. */
function ipv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase()
  // A trailing dotted IPv4 (::ffff:1.2.3.4) becomes two groups.
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text)
  if (v4) {
    const n = v4.slice(1).map(Number)
    text = `${text.slice(0, v4.index)}${((n[0]! << 8) | n[1]!).toString(16)}:${((n[2]! << 8) | n[3]!).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0
  const parts = [...head, ...Array(Math.max(fill, 0)).fill('0'), ...tail]
  if (parts.length !== 8 || !parts.every((p) => /^[0-9a-f]{1,4}$/.test(p))) return null
  return parts.map((p) => parseInt(p, 16))
}

/**
 * Whether an IPv6 address can reach something private: loopback, unspecified, unique-local,
 * link- and site-local, multicast, and any form that embeds an IPv4 address (mapped, compatible,
 * NAT64, 6to4), which is judged by that IPv4 address.
 */
export function isPrivateIPv6(ip: string): boolean {
  const g = ipv6Groups(ip)
  if (!g) return true
  const embedded = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
  if (g.slice(0, 6).every((x) => x === 0))
    return g[6] === 0 && g[7]! <= 1 ? true : isPrivateIPv4(embedded(g[6]!, g[7]!))
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff)
    return isPrivateIPv4(embedded(g[6]!, g[7]!))
  if (g[0] === 0x64 && g[1] === 0xff9b) return isPrivateIPv4(embedded(g[6]!, g[7]!))
  if (g[0] === 0x2002) return isPrivateIPv4(embedded(g[1]!, g[2]!))
  const first = g[0]!
  return (
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xffc0) === 0xfec0 ||
    (first & 0xff00) === 0xff00
  )
}

/**
 * Why a webhook URL is refused (SPEC §44.10): not https, a loopback or private host, or a name
 * that cannot be public. Null when it is fine. Checked by name here; `deliver` also resolves the
 * name and refuses private answers, since a public name can point anywhere.
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
  const host = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '')
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa')
  )
    return 'That host is not reachable from the internet.'
  if (host.includes(':')) return isPrivateIPv6(host) ? 'That address is private.' : null
  if (/^[\d.]+$/.test(host)) return isPrivateIPv4(host) ? 'That address is private.' : null
  if (!host.includes('.')) return 'Use a full host name.'
  return null
}
