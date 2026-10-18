import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test('keyboard users can skip navigation and keep focus when starting the demo', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('form')).toHaveAttribute('data-enhanced', 'true')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()
  const demo = page.getByRole('region', { name: 'Example run' })
  await demo.getByRole('button', { name: 'Play the demo' }).focus()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Close walkthrough' }),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(demo.locator('.flow-launch-action')).toBeFocused()
})

test('chapters allow inspection without waiting, and Read instead leaves the player', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('form')).toHaveAttribute('data-enhanced', 'true')
  await page.getByRole('button', { name: 'Play the demo', exact: true }).click()
  const demo = page.getByRole('dialog')
  await demo.getByRole('button', { name: 'Your posts', exact: true }).click()
  await expect(demo.locator('.flow-post[data-selected="true"]')).toHaveCount(1)
  await expect(demo.locator('.flow-player')).toContainText(
    'It writes a post for each channel. Paused.',
  )
  await demo.getByRole('button', { name: 'The playbook', exact: true }).click()
  await demo.getByRole('button', { name: 'Resume walkthrough', exact: true }).click()
  await demo.getByRole('button', { name: 'Read instead' }).click()
  await expect(
    page.getByRole('heading', { name: 'It writes a playbook you can edit.' }),
  ).toBeVisible()
  await expect(demo).not.toBeVisible()
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`page and demo chapters pass accessibility checks in ${colorScheme} mode`, async ({
    page,
  }) => {
    // Ten full-page axe audits, which outlast the default timeout on a busy machine.
    test.slow()
    await page.setViewportSize({ width: colorScheme === 'light' ? 320 : 1360, height: 900 })
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    await page.goto('/')
    await expect(page.locator('form')).toHaveAttribute('data-enhanced', 'true')
    const audit = () => new AxeBuilder({ page }).analyze()
    expect((await audit()).violations).toEqual([])
    await page.getByText('Can I review posts before they go out?', { exact: true }).click()
    await page.getByText('How is my data handled?', { exact: true }).click()
    expect((await audit()).violations, `expanded review/privacy in ${colorScheme} mode`).toEqual([])
    await page.getByText('Can I review posts before they go out?', { exact: true }).click()
    await page.getByText('How is my data handled?', { exact: true }).click()
    await page.getByRole('button', { name: 'Play the demo', exact: true }).click()
    const demo = page.getByRole('dialog')
    for (const step of ['Your answers', 'The playbook', 'Research', 'Your posts', 'In Buffer']) {
      await demo.getByRole('button', { name: step, exact: true }).click()
      expect((await audit()).violations, `${step} in ${colorScheme} mode`).toEqual([])
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true)
    }
    await demo.getByRole('button', { name: 'Research', exact: true }).click()
    await demo.getByRole('button', { name: 'The urban garden story: why it was skipped' }).click()
    expect((await audit()).violations, `duplicate explanation in ${colorScheme} mode`).toEqual([])
    await page.keyboard.press('Escape')
    await demo.getByRole('button', { name: 'In Buffer', exact: true }).click()
    await demo
      .locator('.flow-schedule')
      .getByRole('button', { name: 'Community solar funds local projects' })
      .click()
    expect((await audit()).violations, `selected story in ${colorScheme} mode`).toEqual([])
    await demo.getByRole('button', { name: 'Read instead' }).click()
    expect((await audit()).violations).toEqual([])
  })
}

test('signup remains usable on slow requests and announces confirmation with focus', async ({
  page,
}) => {
  let finish: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  await page.route('**/waitlist', async (route) => {
    await pending
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, position: 7 }),
    })
  })
  await page.goto('/')
  await expect(page.locator('form')).toHaveAttribute('data-enhanced', 'true')
  await page.getByLabel('Email', { exact: true }).fill('quality@example.com')
  await page.getByRole('button', { name: 'Notify me at launch' }).click()
  await expect(page.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  await expect(page.getByRole('form')).toHaveAttribute('aria-busy', 'true')
  finish?.()
  await expect(page.getByRole('status')).toContainText('You are number 7.')
  await expect(page.getByRole('status')).toBeFocused()
  await expect(page.getByRole('link', { name: 'Watch the demo' })).toBeVisible()
})

test('offline signup keeps the address and supports recovery', async ({ page }) => {
  await page.route('**/waitlist', (route) => route.abort('failed'))
  await page.goto('/')
  await expect(page.locator('form')).toHaveAttribute('data-enhanced', 'true')
  await page.getByLabel('Email', { exact: true }).fill('offline@example.com')
  await page.getByRole('button', { name: 'Notify me at launch' }).click()
  await expect(page.getByText('Something went wrong. Try again in a minute.')).toBeVisible()
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('offline@example.com')
  await expect(page.getByLabel('Email', { exact: true })).not.toHaveAttribute(
    'aria-invalid',
    'true',
  )
  await expect(page.getByRole('button', { name: 'Notify me at launch' })).toBeEnabled()
})

test('search and social metadata are rendered on the server', async ({
  browser,
  baseURL,
  request,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  const response = await page.goto(baseURL ?? 'http://localhost:3131')
  expect(response?.status()).toBe(200)
  await expect(page).toHaveTitle(
    'Dispatchlet | An agent that researches and writes your Buffer posts',
  )
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://dispatchlet.com/',
  )
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow')
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    /skips what you’ve already posted/,
  )
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    'content',
    'https://dispatchlet.com/og.png',
  )
  await expect(page.locator('meta[name="twitter:image:alt"]')).toHaveAttribute(
    'content',
    /Dispatchlet/,
  )
  const structuredData = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent()) ?? '{}',
  )
  expect(structuredData).toMatchObject({
    '@type': 'WebSite',
    name: 'Dispatchlet',
    url: 'https://dispatchlet.com/',
  })
  await expect(page.getByRole('button', { name: 'Play the demo', exact: true })).toBeDisabled()
  await expect(
    page.getByRole('heading', { name: 'It writes a playbook you can edit.' }),
  ).toBeVisible()
  const robots = await request.get('/robots.txt')
  expect(robots.status()).toBe(200)
  expect(await robots.text()).toContain('Sitemap: https://dispatchlet.com/sitemap.xml')
  const sitemap = await request.get('/sitemap.xml')
  expect(sitemap.status()).toBe(200)
  expect(await sitemap.text()).toContain('<loc>https://dispatchlet.com/</loc>')
  await context.close()
})

test('missing pages return a real 404 and are not indexed', async ({ page }) => {
  const response = await page.goto('/this-page-does-not-exist')
  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'This page isn’t here.' })).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow')
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0)
  await page.getByRole('link', { name: 'Back to Dispatchlet' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('An agent that researches')
})

test('layout reflows with enlarged text on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto('/')
  await expect(page.locator('form')).toHaveAttribute('data-enhanced', 'true')
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await expect(page.getByRole('button', { name: 'Notify me at launch' })).toBeVisible()
  await page.getByRole('button', { name: 'Play the demo', exact: true }).click()
  const demo = page.getByRole('dialog')
  await demo.getByRole('button', { name: 'Your posts', exact: true }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})

test('optional analytics and count downloads cannot block the main experience', async ({
  page,
}) => {
  await page.route(/waitlist-count|module\.slim|posthog-js_dist_module/, (route) =>
    route.abort('failed'),
  )
  await page.route('**/waitlist', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, position: 7 }),
    }),
  )
  await page.goto('/')
  await expect(page.locator('form')).toHaveAttribute('data-enhanced', 'true')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('An agent that researches')
  await page.getByRole('button', { name: 'Play the demo', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Your posts', exact: true }).click()
  await expect(page.locator('.flow-post[data-selected="true"]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Close walkthrough' }).click()
  await page.getByLabel('Email', { exact: true }).fill('optional@example.com')
  await page.getByRole('button', { name: 'Notify me at launch' }).click()
  await expect(page.getByRole('status')).toContainText('You are number 7.')
})
