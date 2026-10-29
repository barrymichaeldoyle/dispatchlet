// Renders scripts/icons/icon.html to public/icon-512.png and public/icon-192.png for the manifest.
import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('./icon.html', import.meta.url))
const browser = await chromium.launch()
for (const size of [512, 192]) {
  const page = await browser.newPage({
    viewport: { width: 512, height: 512 },
    deviceScaleFactor: size / 512,
  })
  await page.goto(`file://${source}`)
  const target = fileURLToPath(new URL(`../../public/icon-${size}.png`, import.meta.url))
  await page.screenshot({ path: target })
  await page.close()
  process.stdout.write(`Wrote ${target}\n`)
}
await browser.close()
