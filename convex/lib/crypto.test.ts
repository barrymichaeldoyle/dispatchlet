import { beforeAll, describe, expect, it, vi } from 'vitest'

// 32 zero bytes, base64: a fixed key so the tests are repeatable.
const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

beforeAll(() => {
  vi.stubEnv('TOKEN_ENC_KEY', KEY)
})

describe('token encryption', () => {
  it('round-trips a secret and never stores it in plain text', async () => {
    const { decryptSecret, encryptSecret } = await import('./crypto')
    const stored = await encryptSecret('buffer-access-token')
    expect(stored).not.toContain('buffer-access-token')
    expect(await decryptSecret(stored)).toBe('buffer-access-token')
  })

  it('uses a fresh IV for every value', async () => {
    const { encryptSecret } = await import('./crypto')
    expect(await encryptSecret('same')).not.toBe(await encryptSecret('same'))
  })

  it('rejects a tampered value', async () => {
    const { decryptSecret, encryptSecret } = await import('./crypto')
    const [iv, ciphertext] = (await encryptSecret('secret')).split('.')
    const flipped = ciphertext.startsWith('A')
      ? `B${ciphertext.slice(1)}`
      : `A${ciphertext.slice(1)}`
    await expect(decryptSecret(`${iv}.${flipped}`)).rejects.toThrow()
  })
})
