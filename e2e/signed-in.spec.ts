import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'

/*
 * The signed-in app, end to end against the dev Convex deployment. It signs in with the test
 * sign-in (convex/e2e.ts), which needs E2E_AUTH_SECRET in .env.local and the same value on the
 * dev deployment. Each sign-in puts the test user's data back to the fixture. Without the
 * secret, or against a deployed site (E2E_BASE_URL), these tests are skipped.
 */

try {
  process.loadEnvFile('.env.local')
} catch {
  // No local env file, as in CI: the tests below skip.
}

const SECRET = process.env.E2E_AUTH_SECRET
const CONVEX_URL = process.env.VITE_CONVEX_URL

test.skip(
  !SECRET || !CONVEX_URL || Boolean(process.env.E2E_BASE_URL),
  'Needs E2E_AUTH_SECRET and VITE_CONVEX_URL in .env.local, against the local dev server.',
)
// One test user, reset on every sign-in, so these run one at a time.
test.describe.configure({ mode: 'serial' })

const signInRef = makeFunctionReference<
  'action',
  { provider: string; params: Record<string, string> },
  { tokens?: { token: string; refreshToken: string } | null }
>('auth:signIn')

/** Signs in as the test user, resetting their data, and returns the session tokens. */
async function signIn() {
  const client = new ConvexHttpClient(CONVEX_URL!)
  const result = await client.action(signInRef, { provider: 'e2e', params: { secret: SECRET! } })
  if (!result.tokens)
    throw new Error('The test sign-in was refused. Is E2E_AUTH_SECRET set on dev?')
  return result.tokens
}

/** Opens the app as the test user, with the session where Convex Auth's client looks for it. */
async function openSignedIn(page: Page, path = '/app') {
  const { token, refreshToken } = await signIn()
  const namespace = CONVEX_URL!.replace(/[^a-zA-Z0-9]/g, '')
  await page.addInitScript(
    ([ns, jwt, refresh]) => {
      localStorage.setItem(`__convexAuthJWT_${ns}`, jwt!)
      localStorage.setItem(`__convexAuthRefreshToken_${ns}`, refresh!)
    },
    [namespace, token, refreshToken],
  )
  await page.goto(path)
  const heading =
    path === '/app'
      ? page.getByRole('heading', { level: 1, name: 'Welcome back, Test' })
      : page.locator('main#main-content h1')
  await expect(heading).toBeVisible({ timeout: 20_000 })
}

// A test may resume the automation, which books a real run; signing in again cancels it.
test.afterAll(async () => {
  if (SECRET && CONVEX_URL && !process.env.E2E_BASE_URL) await signIn()
})

test('home shows the status, the figures, the next post and what went out', async ({ page }) => {
  await openSignedIn(page)
  await expect(page.locator('.app-home-status')).toHaveText(
    // The fixture's next run is the coming 09:00 UTC: today before then, tomorrow after.
    /^All good\. The next post goes out (today|tomorrow), 09:00\.$/,
  )
  const stats = page.locator('.app-stats')
  await expect(stats).toContainText('Free runs left8 of 10')

  const upNext = page.locator('section', { has: page.getByRole('heading', { name: 'Up next' }) })
  await expect(upNext).toContainText('Hunt won the title at Fuji')
  await expect(upNext).toContainText('Scheduled')

  const recent = page.locator('section', {
    has: page.getByRole('heading', { name: 'Recent posts' }),
  })
  await expect(recent).toContainText('Senna won the title at Suzuka')
  await expect(recent).toContainText('Posted')
  await expect(recent.getByRole('link', { name: /^Open in Buffer/ })).toHaveAttribute(
    'href',
    'https://publish.buffer.com/posts/e2e-sent',
  )
})

test('the week strip opens a day’s run, including the failed one', async ({ page }) => {
  await openSignedIn(page)
  const strip = page.getByRole('list', { name: 'Posts in the last seven days' })
  await expect(strip.getByRole('link')).toHaveCount(2)
  const failed = strip.getByRole('link', { name: /run failed\. Open the run\./ })
  await expect(failed).toHaveText('!')
  await failed.click()
  await expect(page).toHaveURL(/\/app\/a\/[^/]+\/runs\/[^/]+$/)
  await expect(page.getByText('Research returned nothing usable.').first()).toBeVisible()
})

test('pausing from the row stops the schedule, and resuming starts it again', async ({ page }) => {
  await openSignedIn(page)
  const row = page.locator('.app-row', { hasText: 'F1 On This Day' })
  await row.getByRole('button', { name: /^Pause/ }).click()
  await expect(row.getByRole('button', { name: /^Resume/ })).toBeVisible()
  await expect(row).toContainText('paused')
  await expect(page.locator('.app-side-group li', { hasText: 'F1 On This Day' })).toContainText(
    'paused',
  )
  await row.getByRole('button', { name: /^Resume/ }).click()
  await expect(row.getByRole('button', { name: /^Pause/ })).toBeVisible()
  await expect(row).toContainText('Next run')
})

test('home fits a phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await openSignedIn(page)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
  const strip = page.getByRole('list', { name: 'Posts in the last seven days' })
  const next = page.locator('.app-row-next')
  const [stripBox, nextBox] = [await strip.boundingBox(), await next.boundingBox()]
  // The next run sits under the strip, not on top of it.
  expect(nextBox!.y).toBeGreaterThanOrEqual(stripBox!.y + stripBox!.height)
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`home passes accessibility checks in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    await openSignedIn(page)
    const { violations } = await new AxeBuilder({ page }).analyze()
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([])
  })
}

test('signing out says so, and never shows the signing-in screen on the way', async ({ page }) => {
  await page.addInitScript(() => {
    const seen: string[] = []
    Object.assign(window, { __headings: seen })
    new MutationObserver(() => {
      const heading = document.querySelector('h1')?.textContent ?? ''
      if (heading && seen.at(-1) !== heading) seen.push(heading)
    }).observe(document, { subtree: true, childList: true, characterData: true })
  })
  await openSignedIn(page)
  await page.evaluate(() => {
    ;(window as unknown as { __headings: string[] }).__headings.length = 0
  })
  await page.locator('.app-side-account').getByRole('button', { name: 'Sign out' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Sign in to Dispatchlet' }),
  ).toBeVisible()
  const headings = await page.evaluate(
    () => (window as unknown as { __headings: string[] }).__headings,
  )
  expect(headings).not.toContain('Signing you in')
  expect(headings.at(-1)).toBe('Sign in to Dispatchlet')
})

test('each page names the tab and takes focus to its heading', async ({ page }) => {
  await openSignedIn(page)
  await expect(page).toHaveTitle('Home | Dispatchlet')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  await page.locator('.app-row-title').first().click()
  await expect(page).toHaveTitle('F1 On This Day | Dispatchlet')
  await expect(page.getByRole('heading', { level: 1, name: 'F1 On This Day' })).toBeFocused()
  await page.locator('.app-tabs').first().getByRole('link', { name: /^Runs/ }).click()
  await page.locator('.app-runs a').first().click()
  await expect(page).toHaveTitle(/^Scheduled run, .+ · F1 On This Day \| Dispatchlet$/)
  await expect(
    page.locator('.app-crumbs').getByRole('link', { name: 'F1 On This Day' }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
})

test('automation tabs live in the address, so Back and shared links keep them', async ({
  page,
}) => {
  await openSignedIn(page)
  await page.locator('.app-row-title').first().click()
  const tabs = page.getByRole('navigation', { name: 'Sections' })
  await expect(tabs.getByRole('link', { name: 'Playbook' })).toHaveAttribute('aria-current', 'page')
  await tabs.getByRole('link', { name: /^Runs/ }).click()
  await expect(page).toHaveURL(/\?tab=runs$/)
  await expect(page.locator('.app-runs')).toBeVisible()
  await page.goBack()
  await expect(tabs.getByRole('link', { name: 'Playbook' })).toHaveAttribute('aria-current', 'page')
  await page.goto(page.url().replace(/(\?.*)?$/, '?tab=schedule'))
  await expect(tabs.getByRole('link', { name: 'Schedule' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('radiogroup', { name: 'How posts reach Buffer' })).toBeVisible()
})

test('the automation tabs and the run page pass accessibility checks', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openSignedIn(page)
  await page.locator('.app-row-title').first().click()
  const base = page.url().split('?')[0]!
  const failures: string[] = []
  for (const [path, ready] of [
    [base, '.app-playbook'],
    [`${base}?tab=schedule`, '[role="radiogroup"]'],
    [`${base}?tab=runs`, '.app-runs'],
  ] as const) {
    await page.goto(path)
    await page.locator(ready).first().waitFor()
    const { violations } = await new AxeBuilder({ page }).analyze()
    failures.push(
      ...violations.map((v) => `${path}: ${v.id} ${v.nodes.map((n) => n.target).join(', ')}`),
    )
  }
  await page.locator('.app-runs a').first().click()
  await page.getByRole('heading', { level: 1 }).waitFor()
  const { violations } = await new AxeBuilder({ page }).analyze()
  failures.push(...violations.map((v) => `run: ${v.id} ${v.nodes.map((n) => n.target).join(', ')}`))
  expect(failures).toEqual([])
})

test('on a phone the Menu opens the whole side bar and gives focus back', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openSignedIn(page)
  const menu = page.getByRole('button', { name: 'Menu' })
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await menu.click()
  const side = page.locator('#app-side')
  await expect(side.getByRole('link', { name: 'New automation' })).toBeVisible()
  await expect(side.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await expect(side.getByRole('button', { name: 'Close menu' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toBeFocused()
  await menu.click()
  await side.getByRole('link', { name: /F1 On This Day/ }).click()
  await expect(page).toHaveTitle('F1 On This Day | Dispatchlet')
  await expect(side.getByRole('link', { name: 'New automation' })).toBeHidden()
})

test('settings splits everyday settings from developer tools, and old links still land', async ({
  page,
}) => {
  await openSignedIn(page, '/app/settings')
  const tabs = page.getByRole('navigation', { name: 'Settings', exact: true })
  await expect(tabs.getByRole('link', { name: 'General' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'API tokens' })).toHaveCount(0)
  await tabs.getByRole('link', { name: 'Developers' }).click()
  await expect(page).toHaveURL(/\?tab=developers$/)
  await expect(page.getByRole('heading', { name: 'API tokens' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Notifications' })).toHaveCount(0)
  await page.goto(page.url().replace(/\?.*$/, '#webhooks'))
  await expect(tabs.getByRole('link', { name: 'Developers' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.getByRole('heading', { name: 'Webhooks' })).toBeInViewport()
})
