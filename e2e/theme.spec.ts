import { expect, test } from '@playwright/test'

test('follows the system until a choice is saved, then preserves it on reload', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  const body = page.locator('body')
  await expect(body).toHaveCSS('background-color', 'rgb(244, 244, 241)')

  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(body).toHaveCSS('background-color', 'rgb(22, 22, 22)')
  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  await expect(body).toHaveCSS('background-color', 'rgb(244, 244, 241)')
  await page.reload()
  await expect(body).toHaveCSS('background-color', 'rgb(244, 244, 241)')
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await expect(body).toHaveCSS('background-color', 'rgb(22, 22, 22)')
  await page.reload()
  await expect(body).toHaveCSS('background-color', 'rgb(22, 22, 22)')
})

test('theme toggle works with keyboard and without storage access', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('Storage unavailable')
      },
    })
  })
  await page.goto('/')
  const toggle = page.getByRole('button', { name: 'Switch to dark mode' })
  await toggle.focus()
  await toggle.press('Enter')
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(22, 22, 22)')
  await page.getByRole('button', { name: 'Switch to light mode' }).press('Space')
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(244, 244, 241)')
})
