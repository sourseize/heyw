/**
 * U04 — capture and triage in a real browser. The point of the feature is that
 * capturing must not break the flow, so these tests check the timer keeps running
 * and the page does not jump around while a thought is parked.
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

test('U04 - parking a thought mid-block does not disturb the timer', async t => {
  if (!browser.available) return t.skip(`UI suite skipped: ${browser.reason}`);
  const { page, errors, consoleErrors } = await browser.newPage();
  try {
    await page.goto(`${srv.baseUrl}/`);
    await page.waitForSelector('[data-testid="timer-display"]');

    // Attach a task so the captured thought remembers what was being worked on
    await page.selectOption('[data-testid="focus-task-select"]', { index: 1 });
    const taskTitle = await page.locator('[data-testid="focus-task-select"] option:checked').textContent();
    await page.click('[data-testid="timer-toggle"]');
    await page.waitForSelector('[data-testid="timer-stop"]');
    const before = (await srv.api('GET', '/api/timer')).data.timer;

    await page.fill('[data-testid="focus-capture-input"]', 'Ask design about the empty state');
    await page.press('[data-testid="focus-capture-input"]', 'Enter');
    await page.waitForSelector('.toast');

    // The block is untouched and the field is cleared, ready for the next thought
    const after = (await srv.api('GET', '/api/timer')).data.timer;
    assert.equal(after.id, before.id, 'same block');
    assert.equal(after.running, true, 'still running');
    assert.equal(await page.inputValue('[data-testid="focus-capture-input"]'), '');
    assert.equal(await page.locator('[data-testid="timer-display"]').count(), 1, 'no navigation, no modal');

    const thoughts = (await srv.api('GET', '/api/thoughts')).data;
    assert.equal(thoughts.length, 1);
    assert.equal(thoughts[0].text, 'Ask design about the empty state');
    assert.equal(thoughts[0].context.timerRunning, true);
    assert.equal(thoughts[0].context.timerType, 'focus');
    assert.equal(thoughts[0].context.taskTitle, (taskTitle || '').trim());

    // The sidebar badge shows the waiting count
    await page.waitForFunction('document.querySelector("[data-testid=inbox-badge]")?.textContent === "1"');

    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
  } catch (err) {
    await saveFailureArtefacts('U04-capture', page, [...errors, ...consoleErrors]);
    throw err;
  } finally {
    await page.close();
    await srv.api('POST', '/api/timer/stop');
  }
});

test('U04 - P opens the capture bar anywhere, Esc dismisses it', async t => {
  if (!browser.available) return t.skip(`UI suite skipped: ${browser.reason}`);
  const { page, errors, consoleErrors } = await browser.newPage();
  try {
    await page.goto(`${srv.baseUrl}/`);
    await page.waitForSelector('[data-testid="timer-display"]');
    await page.keyboard.press('2'); // Board view
    await page.waitForSelector('#board-add-task-btn');

    assert.ok(await page.isHidden('[data-testid="capture-bar"]'));
    await page.keyboard.press('p');
    await page.waitForSelector('[data-testid="capture-bar-input"]', { state: 'visible' });
    assert.ok(await page.evaluate('document.activeElement === document.getElementById("capture-bar-input")'), 'input is focused');

    await page.keyboard.type('Spike: can we stream the export?');
    await page.keyboard.press('Enter');
    await page.waitForFunction('document.getElementById("capture-bar").hidden === true');

    const texts = (await srv.api('GET', '/api/thoughts')).data.map((t: any) => t.text);
    assert.ok(texts.includes('Spike: can we stream the export?'));

    // Esc closes without saving
    await page.keyboard.press('p');
    await page.waitForSelector('[data-testid="capture-bar-input"]', { state: 'visible' });
    await page.keyboard.type('never mind');
    await page.keyboard.press('Escape');
    await page.waitForFunction('document.getElementById("capture-bar").hidden === true');
    const after = (await srv.api('GET', '/api/thoughts')).data.map((t: any) => t.text);
    assert.ok(!after.includes('never mind'), 'Esc discards the draft');

    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
  } catch (err) {
    await saveFailureArtefacts('U04-capture-bar', page, [...errors, ...consoleErrors]);
    throw err;
  } finally {
    await page.close();
  }
});

test('U04 - triage: convert to task, keep, discard and restore', async t => {
  if (!browser.available) return t.skip(`UI suite skipped: ${browser.reason}`);
  const s = await startTestServer();
  const { page, errors, consoleErrors } = await browser.newPage();
  try {
    await s.api('POST', '/api/thoughts', { text: 'Thought to convert' });
    await s.api('POST', '/api/thoughts', { text: 'Thought to keep' });
    await s.api('POST', '/api/thoughts', { text: 'Thought to discard' });

    await page.goto(`${s.baseUrl}/#inbox`);
    await page.waitForSelector('[data-testid="thought-list"]');
    assert.equal(await page.locator('[data-testid="thought-card"]').count(), 3);
    assert.equal(await page.textContent('#page-title'), 'Thought Inbox');

    // Discard the third one: it leaves the inbox but stays retrievable
    const discardCard = page.locator('[data-testid="thought-card"]', { hasText: 'Thought to discard' });
    await discardCard.locator('[data-testid="thought-discard"]').click();
    await page.waitForFunction('document.querySelectorAll("[data-testid=thought-card]").length === 2');

    await page.click('[data-testid="inbox-tab-discarded"]');
    await page.waitForSelector('[data-testid="thought-restore"]');
    assert.equal(await page.locator('[data-testid="thought-card"]').count(), 1);
    await page.click('[data-testid="thought-restore"]');
    await page.waitForFunction('document.querySelectorAll("[data-testid=thought-card]").length === 0');

    await page.click('[data-testid="inbox-tab-inbox"]');
    await page.waitForFunction('document.querySelectorAll("[data-testid=thought-card]").length === 3', null, { timeout: 5000 });

    // Keep one for later
    await page.locator('[data-testid="thought-card"]', { hasText: 'Thought to keep' }).locator('[data-testid="thought-keep"]').click();
    await page.waitForFunction('document.querySelectorAll("[data-testid=thought-card]").length === 2');
    await page.click('[data-testid="inbox-tab-kept"]');
    await page.waitForSelector('[data-testid="thought-card"]');
    assert.equal(await page.locator('[data-testid="thought-card"]').count(), 1);

    // Convert one into a task through the pre-filled modal
    await page.click('[data-testid="inbox-tab-inbox"]');
    await page.waitForSelector('[data-testid="thought-convert"]');
    await page.locator('[data-testid="thought-card"]', { hasText: 'Thought to convert' }).locator('[data-testid="thought-convert"]').click();
    await page.waitForSelector('[data-testid="convert-title"]');
    assert.equal(await page.inputValue('[data-testid="convert-title"]'), 'Thought to convert', 'modal is pre-filled');
    await page.fill('[data-testid="convert-title"]', 'Convert this thought into a real task');
    await page.click('.confirm-modal-btn');
    await page.waitForFunction('document.querySelectorAll("[data-testid=thought-card]").length === 1');

    const tasks = (await s.api('GET', '/api/tasks')).data;
    assert.ok(tasks.some((t: any) => t.title === 'Convert this thought into a real task'), 'task created from the thought');

    await page.click('[data-testid="inbox-tab-converted"]');
    await page.waitForSelector('[data-testid="thought-linked"]');

    // It really is on the board
    await page.keyboard.press('2');
    await page.waitForSelector('#board-add-task-btn');
    assert.equal(await page.locator('.task-card', { hasText: 'Convert this thought into a real task' }).count(), 1);

    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
  } catch (err) {
    await saveFailureArtefacts('U04-triage', page, [...errors, ...consoleErrors]);
    throw err;
  } finally {
    await page.close();
    await s.close();
  }
});
