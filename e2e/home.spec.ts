import { expect, test } from '@playwright/test'

test('home page loads with the tagline and a way to start', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#start')).toHaveAttribute('data-enhanced', 'true')
  await expect(page).toHaveTitle(/Dispatchlet/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Fresh posts on your topic, researched and written for you.',
  )
  await expect(page.getByRole('link', { name: 'Continue with Buffer' }).first()).toHaveAttribute(
    'href',
    '/app?signin',
  )
  await expect(page.getByText('Your first 10 runs are free, and no card is needed.')).toBeVisible()
  await expect(
    page.locator('.landing-header').getByRole('link', { name: 'Sign in' }),
  ).toHaveAttribute('href', '/app?signin')
})

test('the start link works without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto(baseURL ?? 'http://localhost:3131')
  await expect(page.locator('#start')).toHaveAttribute('href', '/app?signin')
  await context.close()
})

test('the step-by-step run reads in full without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto('/')
  await expect(page.locator('.steps-summary li')).toHaveCount(6)
  await page.getByText('See each step with the demo’s screens').click()
  await expect(page.locator('.steps-summary')).toBeHidden()
  await expect(page.locator('.step')).toHaveCount(6)
  await expect(page.locator('.step-figure[data-state="done"]')).toHaveCount(6)
  const steps = page.locator('.steps')
  await expect(steps.locator('.flow-candidates').getByText('Already posted, skipped')).toBeVisible()
  await expect(steps.getByText('Why one story was skipped')).toBeVisible()
  await expect(
    steps.getByRole('heading', { name: 'It runs again on its own.', exact: true }),
  ).toBeVisible()
  await context.close()
})

test('steps below the fold play once when they scroll into view', async ({ page }) => {
  await page.goto('/')
  await page.getByText('See each step with the demo’s screens').click()
  const research = page.locator('.step.is-wide .step-figure')
  await expect(research).toHaveAttribute('data-state', 'waiting')
  await research.scrollIntoViewIfNeeded()
  await expect(research).toHaveAttribute('data-state', 'done')
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(research).toHaveAttribute('data-state', 'done')
})

test('the closing section offers a start and opens the demo', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#start')).toHaveAttribute('data-enhanced', 'true')
  await expect(
    page.locator('.landing-closing').getByRole('link', { name: 'Continue with Buffer' }),
  ).toHaveAttribute('href', '/app?signin')
  await page.getByRole('button', { name: 'Watch the demo first' }).click()
  await expect(page.getByRole('dialog', { name: 'Dispatchlet walkthrough' })).toBeVisible()
  await page.keyboard.press('Escape')
})

test('the nudge under the demo plays it and returns focus to the play button', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#start')).toHaveAttribute('data-enhanced', 'true')
  await page.getByRole('button', { name: 'Seriously, watch the demo.' }).click()
  await expect(page.getByRole('dialog', { name: 'Dispatchlet walkthrough' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Seriously, watch the demo.' })).toHaveCount(0)
  await expect(page.locator('.flow-launch-action')).toBeFocused()
})
