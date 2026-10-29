/**
 * U01 — real-browser smoke test (Playwright + chromium-headless-shell).
 * Skips itself when no browser is available so `npm test` never depends on one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/testServer.js';
import type { TestServer } from '../helpers/testServer.js';
import { launchBrowser, saveFailureArtefacts } from '../helpers/browser.js';
import type { BrowserHandle } from '../helpers/browser.js';

let srv: TestServer;
let browser: BrowserHandle;

test.before(async () => {
  browser = await launchBrowser();
  if (browser.available) srv = await startTestServer();
});

test.after(async () => {
  await browser?.close();
  await srv?.close();
});

test('U01 - every view renders via keyboard, theme toggles, timer runs, no page errors', async t => {
  if (!browser.available) {
    t.skip(`UI suite skipped: ${browser.reason}`);
    return;
  }
  const { page, errors, consoleErrors } = await browser.newPage({ timezoneId: 'Europe/Amsterdam' });
  const dashboardCalls: string[] = [];
  page.on('request', (req: any) => {
    if (req.url().includes('/api/dashboard')) dashboardCalls.push(req.url());
  });
  try {
    await page.goto(`${srv.baseUrl}/`);
    await page.waitForSelector('#timer-display');
    assert.equal(await page.title(), 'HeyWork — Focus & Work OS');
    assert.equal(await page.textContent('#timer-display'), '25:00');

    // The client must send its zone with the dashboard request
    assert.ok(dashboardCalls.some(u => u.includes('tz=Europe%2FAmsterdam')), `dashboard calls: ${dashboardCalls.join(', ')}`);

    const views: Array<[string, string, string]> = [
      ['2', 'Tasks & Projects', '#board-add-task-btn'],
      ['3', 'Daily Journal', '#save-journal-btn'],
      ['4', 'Notes & Scratchpad', '#create-note-btn'],
      ['5', 'Insights & Analytics', '#weekly-focus-chart'],
      ['1', 'Focus & Today', '#timer-toggle-btn'],
    ];
    for (const [key, title, selector] of views) {
      await page.keyboard.press(key);
      await page.waitForSelector(selector);
      assert.equal(await page.textContent('#page-title'), title);
    }

    // Journal defaults to the browser's local date (not UTC)
    await page.keyboard.press('3');
    await page.waitForSelector('#journal-date-picker');
    const pickerDate = await page.inputValue('#journal-date-picker');
    const localToday = await page.evaluate('(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })()');
    assert.equal(pickerDate, localToday);

    // Theme toggle
    await page.keyboard.press('1');
    await page.waitForSelector('#timer-toggle-btn');
    await page.keyboard.press('t');
    assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
    await page.keyboard.press('t');
    assert.equal(await page.getAttribute('html', 'data-theme'), 'light');

    // Space starts the block; the card ticks and the corner countdown appears
    await page.keyboard.press('Space');
    await page.waitForSelector('[data-testid="mini-timer-time"]');
    await page.waitForFunction('document.getElementById("timer-display").textContent !== "25:00"', null, { timeout: 5000 });
    assert.equal(await page.textContent('#timer-toggle-btn'), '⏸ Pause');
    await page.click('[data-testid="mini-timer-stop"]');
    await page.waitForFunction('document.getElementById("mini-timer").hidden === true');

    assert.deepEqual(errors, [], 'no uncaught page errors');
    assert.deepEqual(consoleErrors, [], 'no console errors');
  } catch (err) {
    await saveFailureArtefacts('U01-smoke', page, [...errors, ...consoleErrors]);
    throw err;
  }
});
