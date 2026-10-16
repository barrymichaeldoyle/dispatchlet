import { expect, test } from '@playwright/test'

test('full-screen walkthrough plays from brief to scheduled posts, pauses, and replays', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.clock.install()
  await page.goto('/')
  await expect(page.locator('form')).toHaveAttribute('data-enhanced', 'true')
  await expect(page.getByText('You bring the direction.')).toBeVisible()
  await page.getByRole('button', { name: 'Play the demo', exact: true }).click()
  const demo = page.getByRole('dialog', { name: 'Dispatchlet walkthrough' })
  await expect(demo).toBeVisible()
  await page.clock.runFor(2000)
  const brief = demo.getByLabel('Example brief').locator('.flow-stream')
  await expect(brief).toContainText('Find three positive')
  await expect(brief).not.toContainText('schedule each story three hours apart.')
  await demo.getByRole('button', { name: 'Pause walkthrough', exact: true }).click()
  const pausedBrief = await brief.textContent()
  await page.clock.runFor(3000)
  await expect(brief).toHaveText(pausedBrief ?? '')
  await demo.getByRole('button', { name: 'Resume walkthrough', exact: true }).click()
  await page.clock.runFor(10000)
  await expect(
    demo.getByRole('heading', { name: 'A playbook built around your brief.' }),
  ).toBeVisible()
  await page.clock.runFor(20000)
  await expect(demo.getByText('Searching trusted sources')).toBeVisible()
  await expect(
    demo
      .locator('.flow-event p')
      .filter({ hasText: '7 searches · 11 pages read. Original reporting verified.' }),
  ).toBeVisible()
  await page.clock.runFor(20000)
  await expect(demo.locator('.flow-post[data-selected="true"]')).toHaveCount(1)
  await expect(
    demo.locator('.flow-post[data-selected="true"]').getByText('2 posts ready', { exact: true }),
  ).toBeVisible()
  await page.clock.runFor(7000)
  await expect(demo.locator('.flow-schedule li[data-revealed="true"]')).toHaveCount(3)
  await page.clock.runFor(5000)
  await expect(demo.locator('.flow-schedule')).toBeVisible()
  await expect(demo.locator('.flow-player')).not.toContainText('Walkthrough complete')
  await page.clock.runFor(1000)
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
      for (const control of await demo.locator('.flow-transport').all()) {
        const transport = await control.boundingBox()
        expect(transport!.x).toBeGreaterThanOrEqual(0)
        expect(transport!.x + transport!.width).toBeLessThanOrEqual(viewport.width)
        expect(transport!.y + transport!.height).toBeLessThanOrEqual(viewport.height)
      }
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
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100))
    const scene = demo.locator('.flow-scene')
    const origin = (await scene.boundingBox())!.y
    const recorded = new Map<string, { y: number; height: number }>()
    let previous = 0
    for (const time of [
      1000, 3000, 6500, 8000, 9500, 10500, 12000, 14000, 16000, 18000, 20500, 22500, 24000, 27500,
      31000, 34500, 37500, 40500, 42000, 43500, 45000, 47000, 49500, 51000, 53500, 55000, 57000,
      59000, 63000, 65000,
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
        .locator(
          '.flow-input, .flow-document-title, .flow-post[data-selected="true"], .flow-reveal[data-revealed="true"]',
        )
        .evaluateAll((elements) =>
          elements
            .filter(
              (element) =>
                element.getClientRects().length > 0 &&
                getComputedStyle(element).visibility !== 'hidden',
            )
            .map((element) => {
              const rect = element.getBoundingClientRect()
              const key = element.classList.contains('flow-input')
                ? 'brief'
                : element.classList.contains('flow-document-title')
                  ? 'document'
                  : (element.querySelector('strong')?.textContent ??
                    element.querySelector(':scope > span')?.textContent ??
                    element.className)
              return {
                key: `${element.closest('.flow-panel')?.getAttribute('aria-label')}:${element.className}:${key}`,
                y: rect.y,
                height: rect.height,
              }
            }),
        )
      const chapter = await demo.locator('.flow-stages [aria-current="step"]').textContent()
      for (const item of items) {
        const stableKey = `${chapter}:${item.key}`
        const before = recorded.get(stableKey)
        if (before) {
          expect(Math.abs(item.y - before.y), `${item.key} moved at ${time}ms`).toBeLessThan(1)
          expect(
            Math.abs(item.height - before.height),
            `${item.key} resized at ${time}ms`,
          ).toBeLessThan(1)
        } else recorded.set(stableKey, item)
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
  await page.clock.runFor(35000)
  const candidates = demo.locator('.flow-candidates')
  await expect(candidates.locator('li')).toHaveCount(5)
  await expect(candidates.locator('.is-selected')).toHaveCount(3)
  await expect(
    candidates.locator('li').filter({ hasText: 'The urban garden story' }),
  ).toContainText('Already posted · skipped')
  await expect(candidates).toContainText('matches a previous post')
  // Hold the duplicate decision before moving to writing.
  await page.clock.runFor(5000)
  await expect(candidates).toBeVisible()
  await page.clock.runFor(12000)
  await expect(demo.locator('.flow-post[data-selected="true"]')).toHaveCount(1)
  await expect(demo.locator('.flow-post[data-selected="true"]')).toContainText(
    'Wildlife makes a comeback',
  )
  await expect(demo.locator('.flow-post[data-selected="true"] .flow-channel')).toHaveText([
    'X',
    'LinkedIn',
  ])
  await expect(demo.locator('.flow-story-results li[data-revealed="true"]')).toHaveCount(2)
  const example = await demo
    .locator('.flow-post[data-selected="true"] .flow-stream')
    .allTextContents()
  await page.clock.runFor(1000)
  await expect(demo.locator('.flow-post[data-selected="true"] .flow-stream')).toHaveText(example)
  await demo.getByRole('button', { name: 'In Buffer', exact: true }).click()
  await expect(demo.locator('.flow-schedule time')).toHaveText(['09:00', '12:00', '15:00'])
  await expect(demo.locator('.flow-schedule li')).toHaveCount(3)
  await expect(demo.locator('.flow-schedule')).not.toContainText('urban garden')
  await expect(demo.locator('.flow-schedule')).not.toContainText('company')
  await expect(demo.getByText('6 posts scheduled', { exact: true })).toBeVisible()
})

test('restart begins a fresh run from playing, paused and partially typed states', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.clock.install()
  await page.goto('/')
  await page.getByRole('button', { name: 'Play the demo', exact: true }).click()
  const demo = page.getByRole('dialog')
  const restart = demo.getByRole('button', { name: 'Restart walkthrough' })
  const progress = demo.getByRole('progressbar')
  await page.clock.runFor(35000)
  await expect(demo.locator('.flow-candidates')).toBeVisible()
  await restart.click()
  await expect(progress).toHaveAttribute('aria-valuenow', '0')
  await expect(demo.getByRole('heading', { name: 'Start with what you care about.' })).toBeVisible()
  await expect(restart).toBeFocused()
  await expect(demo.getByRole('button', { name: 'Pause walkthrough' })).toBeVisible()
  await expect(demo.getByLabel('Example brief').locator('.flow-stream')).toBeEmpty()
  await page.clock.runFor(2000)
  await expect(demo.getByLabel('Example brief').locator('.flow-stream')).toContainText(
    'Find three positive',
  )
  await restart.press('Enter')
  await expect(progress).toHaveAttribute('aria-valuenow', '0')
  await expect(demo.getByLabel('Example brief').locator('.flow-stream')).toBeEmpty()
  await demo.getByRole('button', { name: 'Your posts', exact: true }).click()
  await expect(demo.getByRole('button', { name: 'Resume walkthrough' })).toBeVisible()
  await restart.click()
  await expect(progress).toHaveAttribute('aria-valuenow', '0')
  await expect(demo.locator('.flow-player')).toContainText('Playing · Your brief')
  expect(await demo.locator('.flow-workspace').evaluate((el) => el.scrollTop)).toBe(0)
  await page.clock.runFor(12000)
  await expect(
    demo.getByRole('heading', { name: 'A playbook built around your brief.' }),
  ).toBeVisible()
})

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test(`desktop builds one persistent workspace at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.clock.install()
    await page.goto('/')
    await page.getByRole('button', { name: 'Play the demo', exact: true }).click()
    const demo = page.getByRole('dialog')
    await expect(demo.locator('.flow-workspace')).toHaveClass(/is-overview/)
    const brief = demo.getByLabel('Example brief')
    const original = await brief.elementHandle()
    const bounds = await brief.boundingBox()
    const columns = demo.locator('.flow-context, .flow-scene > .flow-panel')
    const initialColumns = await columns.evaluateAll((elements) =>
      elements.map((el) => {
        const rect = el.getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }),
    )
    expect(initialColumns).toHaveLength(4)
    await expect(demo.locator('.flow-panel-waiting')).toHaveCount(4)
    await expect(demo.locator('.flow-post[data-selected="true"]')).toHaveCount(0)
    let previous = 0
    for (const time of [8000, 22000, 39000, 52000, 65000]) {
      await page.clock.fastForward(time - previous)
      previous = time
      expect(await original!.evaluate((el) => el.isConnected)).toBe(true)
      expect(await brief.boundingBox()).toEqual(bounds)
      expect(
        await columns.evaluateAll((elements) =>
          elements.map((el) => {
            const rect = el.getBoundingClientRect()
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          }),
        ),
      ).toEqual(initialColumns)
    }
    await expect(demo.locator('.flow-panel-waiting')).toHaveCount(0)
    for (const selector of [
      '.flow-input',
      '.flow-playbook',
      '.is-duplicate',
      '.flow-post[data-selected="true"]',
      '.flow-schedule',
    ]) {
      await expect(demo.locator(selector)).toBeVisible()
    }
    // All four columns stay within the viewport. Scroll remains available for enlarged text.
    for (const column of await columns.all()) {
      const rect = (await column.boundingBox())!
      expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width)
      expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height)
      expect(await column.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
    }
    await demo.getByRole('button', { name: 'Replay walkthrough' }).click()
    await expect(demo.locator('.flow-panel-waiting')).toHaveCount(4)
    await expect(demo.locator('.flow-post[data-selected="true"]')).toHaveCount(0)
    await expect(demo.locator('.flow-workspace')).toHaveClass(/is-overview/)
  })
}

test('resizing preserves progress while switching between overview and focused chapters', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.clock.install()
  await page.goto('/')
  await page.getByRole('button', { name: 'Play the demo', exact: true }).click()
  const demo = page.getByRole('dialog')
  await page.clock.fastForward(52000)
  await demo.getByRole('button', { name: 'Pause walkthrough' }).click()
  await expect(demo.locator('.flow-playbook')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(demo.locator('.flow-workspace')).not.toHaveClass(/is-overview/)
  await expect(
    demo.getByRole('heading', { name: 'One story, written for each channel.' }),
  ).toBeVisible()
  await expect(demo.locator('.flow-playbook')).toHaveCount(0)
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(demo.locator('.flow-workspace')).toHaveClass(/is-overview/)
  await expect(demo.locator('.flow-playbook')).toBeVisible()
  await expect(demo.locator('.flow-candidates')).toBeVisible()
  await expect(demo.locator('.flow-post[data-selected="true"]')).toBeVisible()
  await expect(demo.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '52')
})

test('feedback confirms completed work without an elapsed-seconds counter', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.clock.install()
  await page.goto('/')
  await page.getByRole('button', { name: 'Play the demo', exact: true }).click()
  const demo = page.getByRole('dialog')
  await expect(demo.locator('.flow-player')).not.toContainText(/\d+.*sec/)
  await page.clock.fastForward(8000)
  await expect(demo.locator('.flow-submit-label .is-active')).toHaveText('Create playbook')
  await page.clock.fastForward(4000)
  await expect(demo.locator('.flow-submit-label .is-active')).toHaveText('Playbook created')
  await page.clock.fastForward(43000)
  await expect(demo.locator('.flow-finish-status .is-active')).toContainText('Scheduling in Buffer')
  await expect(demo.locator('.flow-receipt')).not.toBeVisible()
  await expect(demo.getByRole('button', { name: 'Join the waiting list' })).toHaveCount(0)
  await page.clock.fastForward(4000)
  await expect(demo.locator('.flow-finish-status .is-active')).toContainText('6 posts scheduled')
  await expect(demo.locator('.flow-receipt')).toBeVisible()
  await expect(demo.locator('.flow-player')).not.toContainText(/\d+.*sec/)
})

for (const viewport of [
  { width: 320, height: 568 },
  { width: 1440, height: 900 },
]) {
  test(`completed demo returns to signup without submitting at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.clock.install()
    let submissions = 0
    await page.route('**/waitlist', async (route) => {
      submissions += 1
      await route.abort()
    })
    await page.goto('/')
    await page.getByRole('button', { name: 'Play the demo', exact: true }).click()
    const demo = page.getByRole('dialog')
    await page.clock.fastForward(65000)
    const join = demo.getByRole('button', { name: 'Join the waiting list' })
    await expect(join).toBeInViewport()
    await join.focus()
    await page.keyboard.press('Enter')
    await expect(demo).not.toBeVisible()
    await expect(page.getByLabel('Email', { exact: true })).toBeFocused()
    await expect(page.getByLabel('Email', { exact: true })).toBeInViewport()
    expect(submissions).toBe(0)
    await page.getByRole('button', { name: 'Replay demo', exact: true }).click()
    await expect(demo).toBeVisible()
    await expect(demo.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })
}

test('desktop story inspection pauses, links the workspace and keeps every preview in place', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.clock.install()
  await page.goto('/')
  await page.getByRole('button', { name: 'Play the demo', exact: true }).click()
  const demo = page.getByRole('dialog', { name: 'Dispatchlet walkthrough' })
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100))
  await page.clock.fastForward(35000)
  await demo
    .locator('.flow-candidates')
    .getByRole('button', { name: 'Community solar funds local projects' })
    .click()
  const active = demo.locator('.flow-post[data-selected="true"]')
  await expect(active).toContainText('Community-owned solar')
  await expect(demo.locator('.flow-player')).toContainText('Paused')
  const progress = await demo.getByRole('progressbar').getAttribute('aria-valuenow')
  await page.clock.fastForward(5000)
  await expect(demo.getByRole('progressbar')).toHaveAttribute('aria-valuenow', progress!)
  await demo.getByRole('button', { name: 'In Buffer', exact: true }).click()
  const previews = demo.locator('.flow-post-previews')
  const original = await previews.boundingBox()
  for (const name of [
    'Wildlife makes a comeback',
    'A repair café brings neighbours together',
    'Community solar funds local projects',
  ]) {
    await demo.locator('.flow-schedule').getByRole('button', { name, exact: true }).click()
    await expect(active).toHaveAttribute('aria-label', `${name} posts`)
    await expect(demo.locator('.flow-candidates li[data-highlighted="true"]')).toContainText(name)
    await expect(demo.locator('.flow-schedule li[data-highlighted="true"]')).toContainText(name)
    expect(await previews.boundingBox()).toEqual(original)
    for (const column of await demo.locator('.flow-context, .flow-scene > .flow-panel').all()) {
      expect(await column.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
    }
  }
  await demo.getByRole('button', { name: 'Replay walkthrough' }).click()
  await expect(demo.locator('.flow-panel-waiting')).toHaveCount(4)
  await expect(demo.locator('[data-highlighted="true"]')).toHaveCount(0)
})

test('phone story previews are keyboard accessible and resume the original example', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.clock.install()
  await page.goto('/')
  await page.getByRole('button', { name: 'Play the demo', exact: true }).click()
  const demo = page.getByRole('dialog', { name: 'Dispatchlet walkthrough' })
  await demo.getByRole('button', { name: 'In Buffer', exact: true }).click()
  const story = demo
    .locator('.flow-schedule')
    .getByRole('button', { name: 'Community solar funds local projects' })
  await story.focus()
  await story.press('Enter')
  const active = demo.locator('.flow-post[data-selected="true"]')
  await expect(active).toBeFocused()
  await expect(active).toContainText('Community-owned solar')
  await expect(
    demo.getByRole('heading', { name: 'One story, written for each channel.' }),
  ).toBeVisible()
  await active.getByRole('button', { name: 'First story' }).click()
  await expect(active).toBeFocused()
  await expect(active).toContainText('Wildlife makes a comeback')
  await demo.getByRole('button', { name: 'Your posts', exact: true }).click()
  await demo
    .locator('.flow-story-results')
    .getByRole('button', { name: 'A repair café brings neighbours together' })
    .click()
  await expect(active).toContainText('Volunteers share their skills')
  await demo.getByRole('button', { name: 'Resume walkthrough', exact: true }).click()
  await expect(active).toContainText('Wildlife makes a comeback')
  await expect(demo.locator('.flow-player')).toContainText('Playing')
})

test('duplicate evidence pauses playback and Escape returns to the same run', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.clock.install()
  await page.goto('/')
  await page.getByRole('button', { name: 'Play the demo', exact: true }).click()
  const demo = page.getByRole('dialog', { name: 'Dispatchlet walkthrough' })
  await page.clock.fastForward(35000)
  const trigger = demo.getByRole('button', { name: 'The urban garden story: why it was skipped' })
  await trigger.click()
  const detail = page.getByRole('dialog', { name: 'Already shared. Skipped this time.' })
  await expect(detail).toBeVisible()
  await expect(detail).toContainText('Previous post · illustrative example')
  await expect(detail).toContainText('A neighbourhood garden')
  await expect(detail.getByRole('button', { name: 'Close duplicate explanation' })).toBeFocused()
  const progress = await demo.getByRole('progressbar').getAttribute('aria-valuenow')
  await page.clock.runFor(5000)
  await expect(demo.getByRole('progressbar')).toHaveAttribute('aria-valuenow', progress!)
  await page.keyboard.press('Escape')
  await expect(detail).not.toBeVisible()
  await expect(demo).toBeVisible()
  await expect(trigger).toBeFocused()
  await expect(demo.locator('.flow-player')).toContainText('Paused')
})
