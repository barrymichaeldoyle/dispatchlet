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
  const theme = page.getByRole('radiogroup', { name: 'Theme' })
  await theme.getByRole('radio', { name: 'Light' }).click()
  await expect(body).toHaveCSS('background-color', 'rgb(244, 244, 241)')
  await page.reload()
  await expect(body).toHaveCSS('background-color', 'rgb(244, 244, 241)')
  await expect(theme.getByRole('radio', { name: 'Light' })).toBeChecked()
  await theme.getByRole('radio', { name: 'Dark' }).click()
  await expect(body).toHaveCSS('background-color', 'rgb(22, 22, 22)')
  await page.reload()
  await expect(body).toHaveCSS('background-color', 'rgb(22, 22, 22)')
  await expect(theme.getByRole('radio', { name: 'Dark' })).toBeChecked()
  await theme.getByRole('radio', { name: 'System' }).click()
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(body).toHaveCSS('background-color', 'rgb(244, 244, 241)')
  await page.reload()
  await expect(theme.getByRole('radio', { name: 'System' })).toBeChecked()
  await expect(body).toHaveCSS('background-color', 'rgb(244, 244, 241)')
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
  const theme = page.getByRole('radiogroup', { name: 'Theme' })
  const system = theme.getByRole('radio', { name: 'System' })
  await expect(system).toBeChecked()
  await system.focus()
  await system.press('ArrowLeft')
  await expect(theme.getByRole('radio', { name: 'Dark' })).toBeChecked()
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(22, 22, 22)')
  await page.keyboard.press('ArrowLeft')
  await expect(theme.getByRole('radio', { name: 'Light' })).toBeChecked()
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(244, 244, 241)')
})

test('theme can be changed from the demo and stays in sync', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  await page.getByRole('button', { name: 'Play the demo', exact: true }).click()
  const demo = page.getByRole('dialog')
  await demo.getByRole('radio', { name: 'Dark' }).click()
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(22, 22, 22)')
  await expect(demo.getByRole('radio', { name: 'Dark' })).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked()
  await page.reload()
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked()
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(22, 22, 22)')
})
