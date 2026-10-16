import { expect, test } from '@playwright/test'

test('full-screen walkthrough plays from brief to scheduled posts, pauses, and replays', async ({
  page,
}) => {
  await page.clock.install()
  await page.goto('/')
  await expect(page.locator('form')).toHaveAttribute('data-enhanced', 'true')
  await expect(page.getByText('You bring the direction.')).toBeVisible()
  await page.getByRole('button', { name: 'Play the demo', exact: true }).click()
  const demo = page.getByRole('dialog', { name: 'Dispatchlet walkthrough' })
  await expect(demo).toBeVisible()
  await page.clock.runFor(2000)
  const brief = demo.getByLabel('Example brief').locator('.flow-stream')
  await expect(brief).toContainText('Find positive news')
  await expect(brief).not.toContainText('schedule the stories three hours apart.')
  await demo.getByRole('button', { name: 'Pause walkthrough', exact: true }).click()
  const pausedBrief = await brief.textContent()
  await page.clock.runFor(3000)
  await expect(brief).toHaveText(pausedBrief ?? '')
  await demo.getByRole('button', { name: 'Resume walkthrough', exact: true }).click()
  await page.clock.runFor(5000)
  await expect(
    demo.getByRole('heading', { name: 'A playbook built around your brief.' }),
  ).toBeVisible()
  await page.clock.runFor(12000)
  await expect(demo.getByText('Searching trusted sources')).toBeVisible()
  await expect(
    demo
      .locator('.flow-event .flow-stream')
      .filter({ hasText: '7 searches · 11 pages read. Original reporting verified.' }),
  ).toBeVisible()
  await page.clock.runFor(23000)
  await expect(demo.locator('.flow-post')).toHaveCount(3)
  await expect(
    demo.locator('.flow-post[data-revealed="true"]').getByText('2 posts ready', { exact: true }),
  ).toBeVisible()
  await page.clock.runFor(6000)
  await expect(demo.locator('.flow-player')).toContainText('Walkthrough complete')
  await expect(demo.getByText('6 posts scheduled', { exact: true })).toBeVisible()
  await demo.getByRole('button', { name: 'Replay walkthrough' }).click()
  await expect(demo.getByRole('heading', { name: 'Start with what you care about.' })).toBeVisible()
  await expect(demo.getByText('6 posts scheduled', { exact: true })).toHaveCount(0)
})

test('closing pauses playback, restores focus and page position, and allows resuming', async ({
  page,
}) => {
  await page.clock.install()
  await page.goto('/')
  const opener = page.getByRole('button', { name: 'Play the full walkthrough' })
  await expect(opener).toBeEnabled()
  await opener.scrollIntoViewIfNeeded()
  const before = await page.evaluate(() => window.scrollY)
  await opener.click()
  const demo = page.getByRole('dialog')
  await page.clock.runFor(2000)
  const progress = await demo.getByRole('progressbar').getAttribute('aria-valuenow')
  await demo.getByRole('button', { name: 'Close walkthrough' }).click()
  await expect(demo).not.toBeVisible()
  await expect(opener).toBeFocused()
  expect(await page.evaluate(() => window.scrollY)).toBe(before)
  await page.clock.runFor(3000)
  await expect(page.locator('.flow-progress')).toHaveAttribute('aria-valuenow', progress ?? '')
  await page.getByRole('button', { name: 'Resume demo', exact: true }).click()
  await expect(demo).toBeVisible()
  await page.clock.runFor(1000)
  expect(Number(await demo.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeGreaterThan(
    Number(progress),
  )
  await page.keyboard.press('Escape')
  await expect(demo).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Resume demo', exact: true })).toBeFocused()
  await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden')
})

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1360, height: 900 },
  { width: 844, height: 390 },
]) {
  test(`focused player fills ${viewport.width}×${viewport.height} with persistent controls`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await page.getByRole('button', { name: 'Play the demo', exact: true }).click()
    const demo = page.getByRole('dialog')
    await expect(demo).toBeVisible()
    const assertViewport = async () => {
      const bounds = await demo.boundingBox()
      expect(bounds?.x).toBe(0)
      expect(bounds?.y).toBe(0)
      expect(bounds?.width).toBe(viewport.width)
      expect(bounds?.height).toBe(viewport.height)
      for (const name of ['Close walkthrough', 'Read instead']) {
        const button = await demo.getByRole('button', { name, exact: true }).boundingBox()
        expect(button!.y).toBeGreaterThanOrEqual(0)
        expect(button!.y + button!.height).toBeLessThanOrEqual(viewport.height)
      }
      const transport = await demo.locator('.flow-transport').boundingBox()
      expect(transport!.y + transport!.height).toBeLessThanOrEqual(viewport.height)
      expect(
        await demo.evaluate(
          (el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight,
        ),
      ).toBe(true)
    }
    await assertViewport()
    await expect(demo).toHaveCSS('animation-name', 'none')
    for (const chapter of ['Your brief', 'The playbook', 'Research', 'Your posts', 'In Buffer']) {
      await demo.getByRole('button', { name: chapter, exact: true }).click()
      await assertViewport()
    }
    await page.keyboard.press('Escape')
    await expect(demo).not.toBeVisible()
  })
}

test('focus stays inside the player and Read instead opens the native transcript', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Play the demo', exact: true }).click()
  const demo = page.getByRole('dialog')
  await expect(demo.getByRole('button', { name: 'Close walkthrough' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(demo.getByRole('button', { name: 'Read instead' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(demo.getByRole('button', { name: 'Close walkthrough' })).toBeFocused()
  const backgroundScroll = await page.evaluate(() => window.scrollY)
  await page.mouse.wheel(0, 600)
  expect(await page.evaluate(() => window.scrollY)).toBe(backgroundScroll)
  await demo.getByRole('button', { name: 'Read instead' }).click()
  await expect(demo).not.toBeVisible()
  await expect(page.getByText('Read the full walkthrough', { exact: true })).toBeFocused()
  await expect(page.getByRole('heading', { name: 'Review your playbook' })).toBeVisible()
})

test('player adapts to orientation changes without changing the landing page scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Play the demo', exact: true }).click()
  const demo = page.getByRole('dialog')
  await expect(demo).toBeVisible()
  await page.setViewportSize({ width: 844, height: 390 })
  await expect.poll(async () => (await demo.boundingBox())?.height).toBe(390)
  await expect(demo.getByRole('button', { name: 'Close walkthrough' })).toBeInViewport()
  await expect(demo.getByRole('button', { name: 'Pause walkthrough' })).toBeInViewport()
  await expect(demo.getByRole('button', { name: 'Read instead' })).toBeInViewport()
})

for (const viewport of [
  { width: 1360, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
]) {
  test(`streaming content stays anchored at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.clock.install()
    await page.goto('/')
    await page.getByRole('button', { name: 'Play the demo', exact: true }).click()
    const demo = page.getByRole('dialog')
    await expect(demo).toBeVisible()
    const scene = demo.locator('.flow-scene')
    const origin = (await scene.boundingBox())!.y
    const recorded = new Map<string, { y: number; height: number }>()
    let previous = 0
    for (const time of [
      1000, 3000, 5100, 6000, 7200, 8200, 9500, 11000, 13000, 15000, 17500, 19500, 22000, 23500,
      25000, 27000, 28500, 30000, 32000, 35000, 37500, 40000, 43500, 45000, 48000,
    ]) {
      await page.clock.fastForward(time - previous)
      previous = time
      await expect(demo.getByRole('progressbar')).toHaveAttribute(
        'aria-valuenow',
        String((time / 1000) | 0),
      )
      expect(
        Math.abs((await scene.boundingBox())!.y - origin),
        `chapter origin at ${time}ms`,
      ).toBeLessThan(1)
      const items = await demo
        .locator('.flow-input, .flow-document-title, .flow-reveal[data-revealed="true"]')
        .evaluateAll((elements) =>
          elements.map((element) => {
            const rect = element.getBoundingClientRect()
            const key = element.classList.contains('flow-input')
              ? 'brief'
              : element.classList.contains('flow-document-title')
                ? 'document'
                : (element.querySelector('strong')?.textContent ??
                  element.querySelector(':scope > span')?.textContent ??
                  element.className)
            return { key: `${element.className}:${key}`, y: rect.y, height: rect.height }
          }),
        )
      for (const item of items) {
        const before = recorded.get(item.key)
        if (before) {
          expect(Math.abs(item.y - before.y), `${item.key} moved at ${time}ms`).toBeLessThan(1)
          expect(
            Math.abs(item.height - before.height),
            `${item.key} resized at ${time}ms`,
          ).toBeLessThan(1)
        } else recorded.set(item.key, item)
      }
    }
  })
}

test('research skips previous coverage and spreads three fresh stories across both channels', async ({
  page,
}) => {
  await page.clock.install()
  await page.goto('/')
  await page.getByRole('button', { name: 'Play the demo', exact: true }).click()
  const demo = page.getByRole('dialog')
  await page.clock.runFor(23000)
  const candidates = demo.locator('.flow-candidates')
  await expect(candidates.locator('li')).toHaveCount(5)
  await expect(candidates.locator('.is-selected')).toHaveCount(3)
  await expect(
    candidates.locator('li').filter({ hasText: 'The urban garden story' }),
  ).toContainText('Already posted · skipped')
  await expect(candidates).toContainText('matches a previous post')
  await page.clock.runFor(18000)
  await expect(demo.locator('.flow-post[data-revealed="true"]')).toContainText('Community solar')
  await expect(demo.locator('.flow-post[data-revealed="true"] .flow-channel')).toHaveText([
    'X',
    'LinkedIn',
  ])
  await demo.getByRole('button', { name: 'Wildlife makes a comeback' }).click()
  await expect(demo.locator('.flow-post[data-revealed="true"]')).toContainText(
    'habitat restoration',
  )
  await expect(demo.locator('.flow-player')).toContainText('Paused')
  await demo.getByRole('button', { name: 'In Buffer', exact: true }).click()
  await expect(demo.locator('.flow-schedule time')).toHaveText(['09:00', '12:00', '15:00'])
  await expect(demo.locator('.flow-schedule li')).toHaveCount(3)
  await expect(demo.locator('.flow-schedule')).not.toContainText('urban garden')
  await expect(demo.locator('.flow-schedule')).not.toContainText('company')
  await expect(demo.getByText('6 posts scheduled', { exact: true })).toBeVisible()
})
