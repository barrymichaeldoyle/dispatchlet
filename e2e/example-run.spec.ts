import { expect, test } from '@playwright/test'

test('walkthrough plays from brief to drafts, pauses, and replays', async ({ page }) => {
  await page.clock.install()
  await page.goto('/')
  await expect(page.locator('form')).toHaveAttribute('data-enhanced', 'true')
  const demo = page.getByRole('region', { name: 'Example run' })
  await expect(demo.getByText('You bring the direction.')).toBeVisible()
  await expect(demo.getByText('2 drafts saved')).toHaveCount(0)
  await demo.getByRole('button', { name: 'Play the demo', exact: true }).click()
  await page.clock.runFor(2000)
  await expect(demo.getByLabel('Example brief').locator('.flow-stream')).toContainText(
    'Find positive news',
  )
  await expect(demo.getByLabel('Example brief').locator('.flow-stream')).not.toContainText(
    'Save drafts for me to review.',
  )
  await demo.getByRole('button', { name: 'Pause demo', exact: true }).click()
  const brief = await demo.getByLabel('Example brief').locator('.flow-stream').textContent()
  await page.clock.runFor(3000)
  await expect(demo.getByLabel('Example brief').locator('.flow-stream')).toHaveText(brief ?? '')
  await demo.getByRole('button', { name: 'Resume demo', exact: true }).click()
  await page.clock.runFor(5000)
  await expect(
    demo.getByRole('heading', { name: 'A playbook built around your brief.' }),
  ).toBeVisible()
  await page.clock.runFor(11000)
  await expect(demo.getByText('Searching trusted sources')).toBeVisible()
  await expect(
    demo.getByText('7 searches · 11 pages read. Checking dates and original reporting.'),
  ).toBeVisible()
  await page.clock.runFor(14000)
  await expect(demo.locator('.flow-post')).toHaveCount(2)
  await expect(demo.getByText('Draft ready')).toHaveCount(2)
  await page.clock.runFor(4000)
  await expect(demo.locator('.flow-player')).toContainText('Walkthrough complete')
  await expect(demo.getByText('2 drafts saved')).toBeVisible()
  await demo.getByRole('button', { name: 'Replay demo' }).click()
  await expect(demo.getByRole('heading', { name: 'Start with what you care about.' })).toBeVisible()
  await expect(demo.getByText('2 drafts saved')).toHaveCount(0)
})

test('walkthrough pauses when it leaves the viewport', async ({ page }) => {
  await page.clock.install()
  await page.goto('/')
  await expect(page.locator('form')).toHaveAttribute('data-enhanced', 'true')
  const demo = page.getByRole('region', { name: 'Example run' })
  await demo.getByRole('button', { name: 'Play the demo', exact: true }).click()
  await page.clock.runFor(1000)
  await page.setViewportSize({ width: 1360, height: 500 })
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await expect(demo.getByRole('button', { name: 'Resume demo' })).toBeAttached()
})

for (const width of [320, 390, 1360]) {
  test(`walkthrough fits at ${width}px with reduced motion`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.clock.install()
    await page.goto('/')
    await expect(page.locator('form')).toHaveAttribute('data-enhanced', 'true')
    const demo = page.getByRole('region', { name: 'Example run' })
    await demo.getByRole('button', { name: 'Play the demo', exact: true }).click()
    await page.clock.runFor(1000)
    await expect(demo.getByLabel('Example brief').locator('.flow-stream')).toContainText(
      'Save drafts for me to review.',
    )
    await expect(demo.locator('.flow-caret')).toHaveCSS('animation-name', 'none')
    await page.clock.runFor(31000)
    await expect(demo.locator('.flow-post')).toHaveCount(2)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.clock.runFor(4000)
    await expect(demo.getByText('2 drafts saved')).toBeVisible()
  })
}
