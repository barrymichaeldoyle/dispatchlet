import { expect, test } from '@playwright/test'

test('home page loads with the Dispatchlet title', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Dispatchlet/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Your research agent for a fresh Buffer queue.',
  )
})
