import { expect, test } from '@playwright/test'

test('home page loads with the tagline and a way to start', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#start')).toHaveAttribute('data-enhanced', 'true')
  await expect(page).toHaveTitle(/Dispatchlet/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'An agent that researches and writes your Buffer posts.',
  )
  await expect(page.getByRole('link', { name: 'Start with Buffer' }).first()).toHaveAttribute(
    'href',
    '/app',
  )
  await expect(page.getByText('Your first 10 runs are free, and no card is needed.')).toBeVisible()
})

test('the start link works without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto(baseURL ?? 'http://localhost:3131')
  await expect(page.locator('#start')).toHaveAttribute('href', '/app')
  await context.close()
})

test('the step-by-step run reads in full without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto('/')
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
  const research = page.locator('.step.is-wide .step-figure')
  await expect(research).toHaveAttribute('data-state', 'waiting')
  await research.scrollIntoViewIfNeeded()
  await expect(research).toHaveAttribute('data-state', 'done')
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(research).toHaveAttribute('data-state', 'done')
})

test('the closing section opens the demo and offers a start', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#start')).toHaveAttribute('data-enhanced', 'true')
  await page.getByRole('button', { name: 'Watch the full run' }).click()
  await expect(page.getByRole('dialog', { name: 'Dispatchlet walkthrough' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(
    page.locator('.landing-closing').getByRole('link', { name: 'Start with Buffer' }),
  ).toHaveAttribute('href', '/app')
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
