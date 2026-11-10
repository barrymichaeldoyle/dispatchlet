import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3131',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // The demo leans on layout details (typed text, view transitions, popovers) that Safari can
    // render differently, and many visitors arrive in Safari, so its spec runs in WebKit too.
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: 'example-run.spec.ts',
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:3131',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
