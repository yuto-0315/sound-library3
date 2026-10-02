// Simple Playwright config for local E2E smoke tests
const { devices } = require('@playwright/test');

/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
  testDir: 'tests/playwright',
  timeout: 120000,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report' }]],
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    actionTimeout: 10000,
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // インストール済みのブラウザの版が @playwright/test と違う場合は E2E_CHROMIUM_PATH で指定する
    // （ファイルごとに launchOptions を指定しているテストは、そちらが優先される）
    launchOptions: process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {}
  },
};
