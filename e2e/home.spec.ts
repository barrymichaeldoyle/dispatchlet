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

test('inline Buffer wordmarks draw inside their own box', async ({ page }) => {
  await page.goto('/')
  const offsets = await page.locator('.buffer-wordmark svg').evaluateAll((marks) =>
    marks.map((svg) => {
      const box = svg.getBoundingClientRect()
      const drawn = svg.querySelector('use')!.getBoundingClientRect()
      return Math.abs(drawn.left - box.left) + Math.abs(drawn.right - box.right)
    }),
  )
  expect(offsets.length).toBeGreaterThan(10)
  for (const offset of offsets) expect(offset).toBeLessThan(2)
})

test('the header offers the start button once the hero is scrolled past', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto('/')
  await expect(page.locator('#start')).toHaveAttribute('data-enhanced', 'true')
  const header = page.locator('.landing-header')
  await expect(header.getByRole('link', { name: 'Sign in' })).toBeVisible()
  await page.locator('.steps').scrollIntoViewIfNeeded()
  await expect(header.getByRole('link', { name: 'Continue' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})
