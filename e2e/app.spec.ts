import { expect, test } from '@playwright/test'

test('the app page offers Buffer sign-in and stays out of search', async ({ page, request }) => {
  await page.goto('/app')
  await expect(page.getByRole('heading', { name: 'Sign in to Dispatchlet.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in with Buffer' })).toBeEnabled()
  await expect(page.getByText('your Buffer email goes on the launch list')).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
  const sitemap = await (await request.get('/sitemap.xml')).text()
  expect(sitemap).not.toContain('/app')
})

test('while sign-in finishes, the page names each step', async ({ page }) => {
  // A stored session with no answer from Convex keeps the page in its signing-in state.
  await page.routeWebSocket(/convex\.cloud/, () => {})
  await page.addInitScript(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('__convexAuthJWT_'))
    if (!key) {
      for (const namespace of [
        'httpspolitemarlin194convexcloud',
        'httpsamiablemosquito364convexcloud',
      ]) {
        localStorage.setItem(`__convexAuthJWT_${namespace}`, 'header.eyJleHAiOjQxMDI0NDQ4MDB9.sig')
      }
    }
  })
  await page.goto('/app')
  await expect(page.getByRole('heading', { name: 'Signing you in.' })).toBeVisible()
  const steps = page.locator('.signin-steps [data-active="true"]')
  await expect(steps).toHaveText('Checking with Buffer.')
  await expect(steps).toHaveText('Reading your account.', { timeout: 3000 })
  await page.locator('.signin-dispatch').click()
  await expect(page.locator('.signin-arrow.is-shot')).toHaveCount(1)
})

test('the launch-list link opens the landing page straight into the demo', async ({ page }) => {
  await page.goto('/?demo')
  await expect(page.getByRole('dialog', { name: 'Dispatchlet walkthrough' })).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
})
