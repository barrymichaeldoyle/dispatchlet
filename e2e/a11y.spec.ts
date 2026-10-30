import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

// The screens a judge meets before they have an account, in both themes, phone and desktop.
const PAGES: [string, string][] = [
  ['/app', 'Sign in to Dispatchlet.'],
  ['/oauth/consent?handle=x&client=Claude&redirect=claude.ai', 'Sign in to connect Claude.'],
  ['/docs', 'How Dispatchlet works'],
  ['/docs/api', 'The Dispatchlet API'],
  ['/docs/webhooks', 'Webhooks'],
  ['/docs/hooks', 'Inbound hooks'],
  ['/docs/mcp', 'The MCP server'],
  ['/privacy', 'Privacy policy'],
]

for (const colorScheme of ['light', 'dark'] as const) {
  test(`sign-in, consent and docs pass accessibility checks in ${colorScheme} mode`, async ({
    page,
  }) => {
    test.slow()
    await page.setViewportSize({ width: colorScheme === 'light' ? 390 : 1360, height: 900 })
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    for (const [path, heading] of PAGES) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
      const { violations } = await new AxeBuilder({ page }).analyze()
      expect(
        violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
        `${path} in ${colorScheme} mode`,
      ).toEqual([])
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `${path} fits the screen`,
      ).toBe(true)
    }
  })
}
