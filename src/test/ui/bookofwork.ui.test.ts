/**
 * U05 — Book of Work in a real browser: figures, navigation, the archive,
 * and a genuine Markdown download.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { startTestServer } from '../helpers/testServer.js';
import { db } from '../../db/database.js';
import { launchBrowser, saveFailureArtefacts } from '../helpers/browser.js';
import type { BrowserHandle } from '../helpers/browser.js';

let browser: BrowserHandle;
test.before(async () => { browser = await launchBrowser(); });
test.after(async () => { await browser?.close(); });

test('U05 - month page, empty previous month, archive and .md download', async t => {
  if (!browser.available) return t.skip(`UI suite skipped: ${browser.reason}`);
  const srv = await startTestServer();
  const { page, errors, consoleErrors } = await browser.newPage({ timezoneId: 'UTC', viewport: { width: 1280, height: 900 } });
  try {
    const thisMonth = new Date().toISOString().slice(0, 7);
    const { data: project } = await srv.api('POST', '/api/projects', { name: 'Parser' });
    const { data: task } = await srv.api('POST', '/api/tasks', { title: 'Ship the parser', projectId: project.id, priority: 'high', estimatedMinutes: 60 });
    for (const [day, mins] of [[3, 50], [3, 25], [4, 25], [12, 50]] as const) {
      const s = db.logFocusSession({ durationMinutes: mins, type: 'focus', completed: true, notes: '', taskId: task.id, taskTitle: task.title, endReason: 'completed' });
      s.timestamp = `${thisMonth}-${String(day).padStart(2, '0')}T09:00:00.000Z`;
    }
    await db.persist();
    await srv.api('PUT', `/api/tasks/${task.id}`, { status: 'done' });
    await srv.api('POST', '/api/logs', { date: `${thisMonth}-03`, intentions: ['Ship it'], retro: 'Parser finally green.', energyRating: 4, focusRating: 5 });

    await page.goto(`${srv.baseUrl}/`);
    await page.waitForSelector('[data-testid="timer-display"]');
    await page.keyboard.press('7');
    await page.waitForSelector('[data-testid="bow-title"]');
    assert.equal(await page.textContent('#page-title'), 'Book of Work');
    assert.equal(await page.textContent('[data-testid="bow-deepwork"]'), '2.5h');
    assert.equal(await page.textContent('[data-testid="bow-sessions"]'), '4');
    assert.equal(await page.textContent('[data-testid="bow-tasks"]'), '1');
    assert.match(await page.textContent('[data-testid="bow-status"]') || '', /In progress — day \d+ of \d+/);
    assert.match(await page.textContent('[data-testid="bow-accomplishments"]') || '', /Ship the parser/);
    assert.match(await page.textContent('[data-testid="bow-reflections"]') || '', /Parser finally green/);
    assert.ok(await page.locator('[data-testid="bow-next"]').isDisabled(), 'cannot go past the current month');

    // The archive lists the live month
    assert.equal(await page.locator('[data-testid="bow-archive-item"]').count(), 1);

    // Download the Markdown page through the browser and compare with the API
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-testid="bow-download"]'),
    ]);
    assert.equal(download.suggestedFilename(), `heywork-book-of-work-${thisMonth}.md`);
    const downloadedPath = await download.path();
    const downloaded = await fs.readFile(downloadedPath!, 'utf-8');
    const viaApi = await (await fetch(`${srv.baseUrl}/api/summary/monthly/${thisMonth}.md?tz=UTC`)).text();
    assert.match(downloaded, /^# Book of Work — /);
    assert.match(downloaded, /\*\*2\.5h\*\* \(150m\)/);
    // Same content apart from the generation timestamp line
    const strip = (s: string) => s.replace(/generated \d{4}-\d{2}-\d{2}/, 'generated X');
    assert.equal(strip(downloaded), strip(viaApi));

    // Previous month is empty and says so honestly
    await page.click('[data-testid="bow-prev"]');
    await page.waitForFunction(`document.querySelector("[data-testid=bow-deepwork]")?.textContent === "0h"`);
    assert.equal(await page.textContent('[data-testid="bow-sessions"]'), '0');
    assert.match(await page.textContent('#page-content') || '', /No focus blocks this month/);

    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
  } catch (err) {
    await saveFailureArtefacts('U05-bookofwork', page, [...errors, ...consoleErrors]);
    throw err;
  } finally {
    await page.close();
    await srv.close();
  }
});

test('U05 - a frozen month shows its freeze date and can be regenerated from the page', async t => {
  if (!browser.available) return t.skip(`UI suite skipped: ${browser.reason}`);
  const first = await startTestServer();
  const { tmpDir, dataFile } = first;
  const s = db.logFocusSession({ durationMinutes: 50, type: 'focus', completed: true, notes: '' });
  s.timestamp = '2025-03-10T09:00:00.000Z';
  await db.persist();
  await first.stop();
  const srv = await startTestServer({ tmpDir, dataFile }); // start-up catch-up freezes March 2025
  const { page, errors, consoleErrors } = await browser.newPage({ timezoneId: 'UTC' });
  try {
    await page.goto(`${srv.baseUrl}/#bookofwork`);
    await page.waitForSelector('[data-testid="bow-title"]');
    const item = page.locator('[data-testid="bow-archive-item"]', { hasText: 'March 2025' });
    assert.equal(await item.count(), 1, 'March 2025 is in the archive');
    assert.match(await item.textContent() || '', /frozen/);
    await item.click();
    await page.waitForFunction('document.querySelector("[data-testid=bow-title]")?.textContent === "March 2025"');
    assert.match((await page.textContent('[data-testid="bow-status"]') || '').trim(), /^Frozen /);
    assert.equal(await page.textContent('[data-testid="bow-deepwork"]'), '0.8h');

    // Back-fill a block, then regenerate from the page
    const late = db.logFocusSession({ durationMinutes: 40, type: 'focus', completed: true, notes: '' });
    late.timestamp = '2025-03-20T09:00:00.000Z';
    await db.persist();
    await page.click('[data-testid="bow-freeze"]');
    await page.waitForFunction(`document.querySelector("[data-testid=bow-deepwork]")?.textContent === "1.5h"`);

    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
  } catch (err) {
    await saveFailureArtefacts('U05-frozen', page, [...errors, ...consoleErrors]);
    throw err;
  } finally {
    await page.close();
    await srv.close();
  }
});

test('U05 - with the generated dataset, the UI shows exactly the figures in the validation report', async t => {
  if (!browser.available) return t.skip(`UI suite skipped: ${browser.reason}`);
  const { generateDataset } = await import('../../tools/testdata/generator.js');
  const { buildReport } = await import('../../tools/testdata/report.js');
  const { data, manifest } = generateDataset({ anchor: '2025-03-31', tz: 'UTC' });
  const report = buildReport(data, manifest, 'UTC');
  const srv = await startTestServer({ initialStore: data });
  const { page, errors, consoleErrors } = await browser.newPage({ timezoneId: 'UTC', viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(`${srv.baseUrl}/#bookofwork`);
    await page.waitForSelector('[data-testid="bow-archive-item"]');
    for (const m of report.months.filter(x => x.month !== '2025-03' || true)) {
      const [y, mm] = m.month.split('-').map(Number);
      const title = `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][mm - 1]} ${y}`;
      await page.locator('[data-testid="bow-archive-item"]', { hasText: title }).click();
      await page.waitForFunction(`document.querySelector("[data-testid=bow-title]")?.textContent === ${JSON.stringify(title)}`);
      assert.equal(await page.textContent('[data-testid="bow-deepwork"]'), `${m.deepWorkHours}h`, `${m.month} deep work`);
      assert.equal(await page.textContent('[data-testid="bow-sessions"]'), String(m.sessions), `${m.month} blocks`);
      assert.equal(await page.textContent('[data-testid="bow-tasks"]'), String(m.tasksCompleted), `${m.month} tasks`);
    }
    // The inbox badge equals the report's inbox count
    await page.waitForFunction(`document.querySelector("[data-testid=inbox-badge]")?.textContent === "${report.dashboard.inboxCount}"`);

    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
  } catch (err) {
    await saveFailureArtefacts('U05-report-vs-ui', page, [...errors, ...consoleErrors]);
    throw err;
  } finally {
    await page.close();
    await srv.close();
  }
});
