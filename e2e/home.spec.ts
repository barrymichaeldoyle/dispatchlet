import { expect, test } from '@playwright/test'

test('home page loads with the tagline and the waiting list', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('form')).toHaveAttribute('data-enhanced', 'true')
  await expect(page).toHaveTitle(/Dispatchlet/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'An agent that researches and writes your posts.',
  )
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Join the waiting list' })).toBeVisible()
  await expect(page.getByText('Opens 28 October.')).toBeVisible()
})

test('joining the waiting list shows a position', async ({ page }) => {
  test.skip(
    Boolean(process.env.E2E_BASE_URL),
    'Submits only against the local dev deployment, so production gets no test rows.',
  )
  await page.goto('/')
  await expect(page.locator('form')).toHaveAttribute('data-enhanced', 'true')
  const join = page.getByRole('button', { name: 'Join the waiting list' })
  const email = page.getByLabel('Email', { exact: true })
  await expect(email).toBeVisible()

  await email.fill('not an email')
  await join.click()
  await expect(page.getByText('That email does not look right.')).toBeVisible()

  await email.fill(`e2e-${Date.now()}@example.com`)
  await join.click()
  await expect(page.getByText(/You are number \d+\. Check your email to confirm\./)).toBeVisible()
})

test('signup errors preserve the email and allow a retry', async ({ page }) => {
  let attempts = 0
  await page.route('**/waitlist', async (route) => {
    attempts++
    await route.fulfill({
      status: attempts === 1 ? 429 : 200,
      contentType: 'application/json',
      body: JSON.stringify(
        attempts === 1 ? { ok: false, error: 'rate_limited' } : { ok: true, position: 7 },
      ),
    })
  })
  await page.goto('/')
  await expect(page.locator('form')).toHaveAttribute('data-enhanced', 'true')
  const join = page.getByRole('button', { name: 'Join the waiting list' })
  const email = page.getByLabel('Email', { exact: true })
  await email.fill('retry@example.com')
  await join.click()
  await expect(page.getByText('Too many tries, wait a minute.')).toBeVisible()
  await expect(email).toHaveValue('retry@example.com')
  await join.click()
  await expect(page.getByRole('status')).toContainText('You are number 7.')
})

for (const width of [390, 768, 1360]) {
  test(`signup keeps the example run in place at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/waitlist', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, position: 7 }),
      }),
    )
    await page.goto('/')
    await expect(page.locator('form')).toHaveAttribute('data-enhanced', 'true')
    await page.evaluate(() => document.fonts.ready)
    const run = page.getByRole('region', { name: 'Example run' })
    const top = await run.evaluate(
      (element) => element.getBoundingClientRect().top + window.scrollY,
    )
    const assertPosition = async () => {
      const current = await run.evaluate(
        (element) => element.getBoundingClientRect().top + window.scrollY,
      )
      expect(Math.abs(current - top)).toBeLessThan(1)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true)
    }
    const join = page.getByRole('button', { name: 'Join the waiting list' })
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
    await page.getByLabel('Email', { exact: true }).fill('layout@example.com')
    await join.click()
    await expect(page.getByRole('status')).toContainText('You are number 7.')
    await assertPosition()
  })
}

test('email field is available without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto(baseURL ?? 'http://localhost:3131')
  const email = page.getByLabel('Email', { exact: true })
  await expect(email).toBeVisible()
  await email.fill('noscript@example.com')
  const form = page.locator('form')
  await expect(form).toHaveAttribute('method', 'post')
  await expect(form).toHaveAttribute('action', /\/waitlist$/)
  await context.close()
})
