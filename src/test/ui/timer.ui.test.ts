/**
 * U02 — the focus timer in a real browser: it must survive navigation and reloads,
 * never silently lose elapsed time, follow the user as a mini countdown, and be
 * poppable into its own small window.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, ageActiveTimer } from '../helpers/testServer.js';
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

test('U02 - the running block ticks on its own tab with Pause/Stop/Reset, and survives navigation and reload', async t => {
  if (!browser.available) return t.skip(`UI suite skipped: ${browser.reason}`);
  const { page, errors, consoleErrors } = await browser.newPage();
  try {
    await page.goto(`${srv.baseUrl}/`);
    await page.waitForSelector('[data-testid="timer-display"]');
    assert.equal(await page.textContent('[data-testid="timer-toggle"]'), '▶ Start Flow');

    await page.click('[data-testid="timer-toggle"]');
    await page.waitForSelector('[data-testid="timer-stop"]');
    assert.equal(await page.textContent('[data-testid="timer-toggle"]'), '⏸ Pause', 'no Start Flow while its block runs');
    assert.equal(await page.locator('[data-testid="timer-reset"]').count(), 1);
    await page.waitForFunction('document.querySelector("[data-testid=timer-display]").textContent !== "25:00"', null, { timeout: 5000 });
    assert.match(await page.textContent('[data-testid="timer-display"]') || '', /^24:\d\d$/, 'the card ticks');
    await page.waitForSelector('[data-testid="mini-timer-time"]');

    // Navigate away: the corner countdown follows, and the Board really renders
    await page.keyboard.press('2');
    await page.waitForSelector('#board-add-task-btn');
    await page.waitForTimeout(600);
    assert.equal(await page.locator('#board-add-task-btn').count(), 1, 'the Board view stays on screen while the timer ticks');
    assert.equal(await page.locator('[data-testid="timer-display"]').count(), 0, 'the Focus view must not redraw itself over the Board');
    assert.match(await page.textContent('[data-testid="mini-timer-time"]') || '', /^2[0-4]:\d\d$/);

    // Reload (still on the Board view): the block is there because the server owns it
    await page.reload();
    await page.waitForSelector('[data-testid="mini-timer-time"]');

    // Back on the Focus view the card follows the running block again
    await page.keyboard.press('1');
    await page.waitForSelector('[data-testid="timer-stop"]');
    assert.match(await page.textContent('[data-testid="timer-display"]') || '', /^2[0-4]:\d\d$/, 'ticking, not static');
    assert.ok(await page.isVisible('[data-testid="mini-timer"]'), 'mini timer is visible on the Focus view too');

    // Pause from the card, resume from the card
    await page.click('[data-testid="timer-toggle"]');
    await page.waitForFunction('document.querySelector("[data-testid=timer-toggle]").textContent === "▶ Resume"');
    assert.equal((await srv.api('GET', '/api/timer')).data.timer.running, false);
    await page.click('[data-testid="timer-toggle"]');
    await page.waitForFunction('document.querySelector("[data-testid=timer-toggle]").textContent === "⏸ Pause"');

    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
  } catch (err) {
    await saveFailureArtefacts('U02-timer-persistence', page, [...errors, ...consoleErrors]);
    throw err;
  } finally {
    await page.close();
    await srv.api('POST', '/api/timer/stop');
  }
});

test('U02 - other tabs are static and only "Start ‹block›" switches; Reset restarts; Stop ends', async t => {
  if (!browser.available) return t.skip(`UI suite skipped: ${browser.reason}`);
  const { page, errors, consoleErrors } = await browser.newPage();
  try {
    await page.goto(`${srv.baseUrl}/`);
    await page.waitForSelector('[data-testid="timer-display"]');
    await page.click('[data-testid="timer-toggle"]');
    await page.waitForSelector('[data-testid="timer-stop"]');
    const running = (await srv.api('GET', '/api/timer')).data.timer;
    await ageActiveTimer(12);
    await page.evaluate('FocusTimer.sync()');

    // Click "Short Break": static 05:00, an explicit switch button, and Deep Focus keeps running
    await page.click('[data-testid="tab-short_break"]');
    await page.waitForSelector('[data-testid="timer-switch"]');
    assert.equal(await page.textContent('[data-testid="timer-display"]'), '05:00');
    assert.equal(await page.textContent('[data-testid="timer-switch"]'), '▶ Start Short Break');
    assert.equal(await page.locator('[data-testid="timer-toggle"]').count(), 0, 'no Pause/Start Flow on a non-running tab');
    await page.waitForTimeout(700);
    assert.equal(await page.textContent('[data-testid="timer-display"]'), '05:00', 'static, not ticking');
    const stillRunning = (await srv.api('GET', '/api/timer')).data.timer;
    assert.equal(stillRunning.id, running.id, 'same block');
    assert.equal(stillRunning.running, true);
    assert.equal((await srv.api('GET', '/api/focus')).data.length, 0, 'nothing was recorded yet');
    assert.match(await page.textContent('[data-testid="mini-timer-time"]') || '', /^1[23]:\d\d$/, 'the corner still counts Deep Focus down');

    // Back on the running tab it ticks again
    await page.click('[data-testid="tab-focus"]');
    await page.waitForSelector('[data-testid="timer-stop"]');
    assert.match(await page.textContent('[data-testid="timer-display"]') || '', /^1[23]:\d\d$/);

    // Start Short Break: the 12 focus minutes are banked and the break ticks on the card
    await page.click('[data-testid="tab-short_break"]');
    await page.waitForSelector('[data-testid="timer-switch"]');
    await page.click('[data-testid="timer-switch"]');
    await page.waitForSelector('[data-testid="timer-stop"]');
    await page.waitForFunction('document.querySelector("[data-testid=timer-display]").textContent.startsWith("04:")');
    const sessions = (await srv.api('GET', '/api/focus')).data;
    const focusSession = sessions.find((s: any) => s.type === 'focus');
    assert.ok(focusSession, 'the interrupted focus block was recorded');
    assert.equal(focusSession.durationMinutes, 12);
    assert.equal(focusSession.endReason, 'switched');
    assert.equal((await srv.api('GET', '/api/timer')).data.timer.type, 'short_break');

    // Reset: the break restarts from the top, the elapsed part is recorded as stopped
    await ageActiveTimer(2);
    await page.evaluate('FocusTimer.sync()');
    await page.click('[data-testid="timer-reset"]');
    await page.waitForFunction('document.querySelector("[data-testid=timer-display]").textContent.startsWith("0") && document.querySelector("[data-testid=timer-display]").textContent > "04:50"');
    const afterReset = (await srv.api('GET', '/api/focus')).data;
    const breakSession = afterReset.find((s: any) => s.type === 'short_break');
    assert.ok(breakSession, 'the 2 break minutes were recorded');
    assert.equal(breakSession.durationMinutes, 2);
    assert.equal(breakSession.endReason, 'stopped');
    assert.equal((await srv.api('GET', '/api/timer')).data.timer.type, 'short_break', 'a fresh break is running');

    // Stop: the card returns to the launcher
    await page.click('[data-testid="timer-stop"]');
    await page.waitForSelector('[data-testid="timer-toggle"]');
    assert.equal(await page.textContent('[data-testid="timer-toggle"]'), '▶ Start Flow');
    assert.equal(await page.textContent('[data-testid="timer-display"]'), '25:00');
    assert.equal((await srv.api('GET', '/api/timer')).data.timer, null);
    await page.waitForFunction('document.getElementById("mini-timer").hidden === true');

    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
  } catch (err) {
    await saveFailureArtefacts('U02-timer-switch', page, [...errors, ...consoleErrors]);
    throw err;
  } finally {
    await page.close();
    await srv.api('POST', '/api/timer/stop');
  }
});

test('U02 - mini timer controls the block, and the pop-out window keeps it alive', async t => {
  if (!browser.available) return t.skip(`UI suite skipped: ${browser.reason}`);
  const { page, context, errors, consoleErrors } = await browser.newPage();
  try {
    await page.goto(`${srv.baseUrl}/`);
    await page.waitForSelector('[data-testid="timer-display"]');
    await page.click('[data-testid="timer-toggle"]');
    await page.waitForSelector('[data-testid="mini-timer-time"]');

    // A focus block dims the chrome (gentle zen mode)
    assert.ok(await page.evaluate('document.body.classList.contains("focus-running")'));

    await page.keyboard.press('3');
    await page.waitForSelector('[data-testid="mini-timer-toggle"]');
    await page.click('[data-testid="mini-timer-toggle"]');
    await page.waitForFunction('document.querySelector("[data-testid=mini-timer-toggle]").textContent === "▶"');
    assert.equal((await srv.api('GET', '/api/timer')).data.timer.running, false, 'paused from the mini timer');
    await page.click('[data-testid="mini-timer-toggle"]');
    await page.waitForFunction('document.querySelector("[data-testid=mini-timer-toggle]").textContent === "⏸"');

    // The pop-out is a real page, so it works even if the main window is closed
    const popout = await context.newPage();
    await popout.goto(`${srv.baseUrl}/timer.html`);
    await popout.waitForSelector('[data-testid="popout-time"]');
    await popout.waitForFunction('document.querySelector("[data-testid=popout-time]").textContent !== "--:--"');
    assert.equal(await popout.textContent('[data-testid="popout-type"]'), 'Deep Focus');
    assert.match(await popout.textContent('[data-testid="popout-time"]') || '', /^\d\d:\d\d$/);

    await page.close(); // close the app; only the pop-out remains
    await popout.click('[data-testid="popout-stop"]');
    await popout.waitForFunction('document.querySelector("[data-testid=popout-time]").textContent === "--:--"');
    assert.equal((await srv.api('GET', '/api/timer')).data.timer, null, 'stopped from the pop-out');
    await popout.close();

    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
  } catch (err) {
    await saveFailureArtefacts('U02-mini-popout', page, [...errors, ...consoleErrors]);
    throw err;
  } finally {
    await srv.api('POST', '/api/timer/stop');
  }
});

test('U03 - S cycles the soundscape through off → rain → brown → white → off', async t => {
  if (!browser.available) return t.skip(`UI suite skipped: ${browser.reason}`);
  const { page, errors, consoleErrors } = await browser.newPage();
  try {
    await page.goto(`${srv.baseUrl}/`);
    await page.waitForSelector('.sound-btn');
    assert.equal(await page.evaluate('AmbientAudio.activeType'), null);

    const expected = ['rain', 'brown', 'white', null];
    for (const want of expected) {
      await page.keyboard.press('s');
      await page.waitForTimeout(60);
      const active = await page.evaluate('AmbientAudio.activeType');
      assert.equal(active, want, `after pressing S the soundscape should be ${want}`);
      const highlighted = await page.evaluate('document.querySelector(".sound-btn.active")?.dataset.sound');
      assert.equal(highlighted, want || 'none', 'the button row reflects the active soundscape');
    }

    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
  } catch (err) {
    await saveFailureArtefacts('U03-sound-cycle', page, [...errors, ...consoleErrors]);
    throw err;
  } finally {
    await page.close();
  }
});
