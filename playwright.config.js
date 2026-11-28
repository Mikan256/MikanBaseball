import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.PORT ?? 4173)
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  // WebGL (three.js) はソフトウェアレンダリングの CI で重いので余裕を持たせる
  timeout: 60000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 3,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node scripts/serve.js --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
