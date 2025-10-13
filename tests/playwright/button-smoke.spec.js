const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// pages to visit in order
const PAGES = [
  '/',
  '/sound-library',
  '/cloud',
  '/daw'
];

// selectors of common buttons to try click (will be attempted if present)
const COMMON_BUTTONS = [
  'button',
  'a[role="button"]',
  '.play-sound-btn',
  '.play-button',
  '.download-button',
  '.track-add-btn',
  '.remove-track-btn',
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
    const url = `http://localhost:5000${route}`;
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
