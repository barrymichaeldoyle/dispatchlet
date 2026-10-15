const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase()
}

export function isValidEmail(input: string): boolean {
  const email = normalizeEmail(input)
  return email.length <= 254 && EMAIL_PATTERN.test(email)
}
