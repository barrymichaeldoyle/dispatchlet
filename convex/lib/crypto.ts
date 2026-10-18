/**
 * AES-256-GCM for Buffer tokens at rest. The key is TOKEN_ENC_KEY (32 bytes, base64) in the
 * Convex environment. Each value gets its own random IV, stored as `iv.ciphertext` in base64.
 */
let cachedKey: Promise<CryptoKey> | null = null

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

function key(): Promise<CryptoKey> {
  if (!cachedKey) {
    const raw = process.env.TOKEN_ENC_KEY
    if (!raw) throw new Error('TOKEN_ENC_KEY is not set')
    const bytes = fromBase64(raw)
    if (bytes.length !== 32) throw new Error('TOKEN_ENC_KEY must be 32 bytes, base64 encoded')
    cachedKey = crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
  }
  return cachedKey
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await key(),
    new TextEncoder().encode(plaintext),
  )
  return `${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`
}

export async function decryptSecret(stored: string): Promise<string> {
  const [iv, ciphertext] = stored.split('.')
  if (!iv || !ciphertext) throw new Error('Malformed encrypted value')
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv) },
    await key(),
    fromBase64(ciphertext),
  )
  return new TextDecoder().decode(plaintext)
}
