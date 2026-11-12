import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
      args: process.env.PLAYWRIGHT_NO_SANDBOX === 'true' ? ['--no-sandbox'] : [],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['iPhone 13'],
  },
})

