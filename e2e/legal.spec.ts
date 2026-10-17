import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

for (const [path, heading] of [
  ['/privacy', 'Privacy policy'],
  ['/terms', 'Terms of use'],
] as const) {
  test(`${path} is reachable from the footer and passes axe`, async ({ page }) => {
    await page.goto('/')
    await page
      .getByRole('contentinfo')
      .getByRole('link', { name: heading.split(' ')[0] })
      .click()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading)
    await expect(page.getByRole('link', { name: 'barry@dispatchlet.com' }).first()).toBeVisible()
    const { violations } = await new AxeBuilder({ page }).analyze()
    expect(violations).toEqual([])
  })
}
