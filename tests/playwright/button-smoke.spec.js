const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// pages to visit in order（HashRouter なので # の後ろがページ。以前は存在しない /sound-library を開いていた）
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5050';
const PAGES = [
  '/#/',
  '/#/library',
  '/#/cloud',
  '/#/daw'
];

// 録音開始ボタンも押すので、偽のマイクを使う（マイクの無い環境では「マイクの取得に失敗」と出るため）
test.use({
  permissions: ['microphone'],
  launchOptions: {
    executablePath: process.env.E2E_CHROMIUM_PATH || undefined,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  }
});

// selectors of common buttons to try click (will be attempted if present)
const COMMON_BUTTONS = [
  'button',
  '.play-sound-btn',
  '.place-sound-btn',
  '.library-play-btn',
  '.track-add-btn',
  '.remove-track-btn',
  '.zoom-btn',
  '.button-primary',
  '.button-secondary'
];

// helper to collect console messages
async function collectConsole(page) {
  const messages = [];
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error' || type === 'warning') {
      messages.push({ type, text });
    }
  });
  return messages;
}

test.beforeEach(async ({ page }) => {
  // no-op
});

test('button smoke test - click common buttons and check console', async ({ page, browserName }) => {
  const report = [];

  for (const route of PAGES) {
    const url = `${BASE_URL}${route}`;
    await page.goto(url, { waitUntil: 'load' });

    const messages = [];
    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      if (type === 'error' || type === 'warning') {
        messages.push({ type, text });
      }
    });

    // try clicking a few visible clickable elements
    for (const selector of COMMON_BUTTONS) {
      const elements = await page.$$(selector);
      for (let i = 0; i < elements.length && i < 3; i++) {
        try {
          const el = elements[i];
          const visible = await el.isVisible();
          if (!visible) continue;
          const enabled = await el.isEnabled().catch(() => true);
          if (!enabled) continue;

          // try to click, but don't throw on failure
          await el.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(200);
        } catch (err) {
          // ignore per-element errors
        }
      }
    }

    // take screenshot for reference
    const screenshotPath = path.join('playwright-report', `screenshot-${route.replace(/\W/g, '_')}.png`);
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } catch (err) {}

    report.push({ route, messages });
  }

  // write report
  const outPath = path.join('playwright-report', 'button-smoke-report.json');
  try {
    fs.mkdirSync('playwright-report', { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  } catch (err) {}

  // assert that there were no errors of type error (warnings allowed)
  const allErrors = report.flatMap(r => r.messages.filter(m => m.type === 'error'));
  expect(allErrors.length).toBe(0);
});
