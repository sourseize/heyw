/**
 * U05 — connected thinking in a real browser: the `[[` autocomplete, the live
 * link strip, the Connections panel, deep links between views, the "Link to…"
 * picker and the local graph.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/testServer.js';
import type { TestServer } from '../helpers/testServer.js';
import { launchBrowser, saveFailureArtefacts } from '../helpers/browser.js';
import type { BrowserHandle } from '../helpers/browser.js';

let srv: TestServer;
let browser: BrowserHandle;
let seed: { note: any; pricing: any; task: any; thought: any };

test.before(async () => {
  browser = await launchBrowser();
  if (!browser.available) return;
  srv = await startTestServer();
  const task = (await srv.api('POST', '/api/tasks', { title: 'Send invoice', description: 'Follow [[Invoice process]]' })).data;
  const pricing = (await srv.api('POST', '/api/notes', { title: 'Pricing', content: 'Numbers.' })).data;
  const note = (await srv.api('POST', '/api/notes', { title: 'Invoice process', content: 'Prepare [[task:Send invoice]] and [[Missing page]]' })).data;
  const thought = (await srv.api('POST', '/api/thoughts', { text: 'Ask Dana about the pricing page copy', context: { view: 'today', timerRunning: true, timerType: 'focus', taskId: task.id } })).data;
  seed = { note, pricing, task, thought };
});
test.after(async () => {
  await browser?.close();
  await srv?.close();
});

test('U05 - notes: [[ autocomplete inserts a canonical mention; the strip and panel follow', async t => {
  if (!browser.available) return t.skip(`UI suite skipped: ${browser.reason}`);
  const { page, errors, consoleErrors } = await browser.newPage();
  try {
    await page.goto(`${srv.baseUrl}/#notes/${seed.note.id}`);
    await page.waitForSelector('[data-testid="connections-count"]');
    assert.equal(await page.inputValue('[data-testid="note-title"]'), 'Invoice process', 'deep link opens the note');

    // Strip: one resolved task chip, one unresolved mention with a "create note" offer
    await page.waitForSelector('[data-testid="link-strip-item"]');
    assert.equal(await page.locator('[data-testid="link-strip-item"]').count(), 1);
    assert.equal(await page.locator('[data-testid="link-strip-unresolved"]').count(), 1);
    assert.equal(await page.locator('[data-testid="link-strip-create"]').count(), 1);

    // Panel: mentions Send invoice, mentioned in Send invoice
    assert.equal(await page.locator('[data-testid="connections-count"]').textContent(), '2');
    assert.equal(await page.locator('[data-testid="connections-unresolved"]').count(), 1);

    // Autocomplete
    const content = page.locator('[data-testid="note-content"]');
    await content.click();
    await content.press('Control+End');
    await page.keyboard.type('\nSee [[pric');
    await page.waitForSelector('[data-testid="wiki-popover"]');
    const options = await page.locator('[data-testid="wiki-option"]').allTextContents();
    assert.ok(options.some((o: string) => o.includes('Pricing')), `offers the Pricing note: ${options.join(' | ')}`);
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid="wiki-popover"]', { state: 'detached' });
    assert.ok((await content.inputValue()).endsWith('See [[note:Pricing]]'), 'canonical typed syntax is inserted');

    // The strip updates before saving
    await page.waitForFunction('document.querySelectorAll("[data-testid=link-strip-item]").length === 2');

    // Escape inside an open popover closes only the popover
    await page.keyboard.type(' [[send');
    await page.waitForSelector('[data-testid="wiki-popover"]');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid="wiki-popover"]', { state: 'detached' });
    assert.ok((await content.inputValue()).endsWith('[[send'), 'text untouched');

    // Save: the mention is now a real connection
    await page.click('[data-testid="note-save"]');
    await page.waitForSelector('[data-testid="connections-count"]');
    await page.waitForFunction('document.querySelector("[data-testid=connections-count]")?.textContent === "3"');
    const back = (await srv.api('GET', `/api/links?type=note&id=${seed.pricing.id}`)).data;
    assert.ok(back.connections.some((c: any) => c.edge.kind === 'mention' && c.other.id === seed.note.id));

    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
  } catch (err) {
    await saveFailureArtefacts('U05-notes', page, [...errors, ...consoleErrors]);
    throw err;
  } finally {
    await page.close();
  }
});

test('U05 - chips deep-link across views: note → task modal → thought card', async t => {
  if (!browser.available) return t.skip(`UI suite skipped: ${browser.reason}`);
  const { page, errors, consoleErrors } = await browser.newPage();
  try {
    await page.goto(`${srv.baseUrl}/#notes/${seed.note.id}`);
    await page.waitForSelector('[data-testid="link-strip-item"]');
    await page.click('[data-testid="link-strip-item"] a.link-chip-task');
    await page.waitForSelector('[data-testid="task-detail"]');
    assert.equal(await page.inputValue('[data-testid="task-detail-title"]'), 'Send invoice');
    assert.ok(page.url().endsWith(`#board/${seed.task.id}`));
    await page.waitForSelector('[data-testid="task-link-strip"] [data-testid="link-strip-item"]');

    // Leaving by keyboard closes the modal with the view
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid="task-detail"]', { state: 'detached' });
    assert.ok(page.url().endsWith('#board'), 'hash falls back to the board');

    await page.goto(`${srv.baseUrl}/#inbox/${seed.thought.id}`);
    await page.waitForSelector('.thought-card-highlight');
    // The captured-during task is a chip now
    await page.click('.thought-card-highlight .thought-meta a.link-chip-task');
    await page.waitForSelector('[data-testid="task-detail"]');
    await page.waitForFunction('document.querySelector("[data-testid=connections-count]")?.textContent === "3"');
    const rows = await page.locator('[data-testid="connections-row"]').allTextContents();
    assert.ok(rows.some((r: string) => r.includes('thought captured during')), rows.join(' | '));

    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
  } catch (err) {
    await saveFailureArtefacts('U05-deeplinks', page, [...errors, ...consoleErrors]);
    throw err;
  } finally {
    await page.close();
  }
});

test('U05 - "Link to…" picker creates an explicit link; the panel can remove it', async t => {
  if (!browser.available) return t.skip(`UI suite skipped: ${browser.reason}`);
  const { page, errors, consoleErrors } = await browser.newPage();
  try {
    await page.goto(`${srv.baseUrl}/#inbox/${seed.thought.id}`);
    await page.waitForSelector('[data-testid="thought-link"]');
    await page.click('[data-testid="thought-link"]');
    await page.fill('[data-testid="link-picker-query"]', 'Pricing');
    await page.waitForSelector('[data-testid="link-picker-row"]');
    await page.click('[data-testid="link-picker-row"]:has-text("Pricing") input');
    await page.click('[data-testid="modal-confirm"]');
    await page.waitForSelector('[data-testid="modal"]', { state: 'detached' });

    const store = await srv.readStore();
    assert.equal(store.links.length, 1);
    assert.equal(store.links[0].from.id, seed.thought.id);
    assert.equal(store.links[0].fromLabel, 'Ask Dana about the pricing page copy');

    await page.goto(`${srv.baseUrl}/#notes/${store.links[0].to.id}`);
    await page.waitForSelector('[data-testid="connections-unlink"]');
    await page.click('[data-testid="connections-unlink"]');
    await page.waitForSelector('[data-testid="connections-unlink"]', { state: 'detached' });
    assert.equal((await srv.readStore()).links.length, 0);

    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
  } catch (err) {
    await saveFailureArtefacts('U05-picker', page, [...errors, ...consoleErrors]);
    throw err;
  } finally {
    await page.close();
  }
});

test('U05 - connections view: SVG nodes, month stepper, re-centre, keyboard 8', async t => {
  if (!browser.available) return t.skip(`UI suite skipped: ${browser.reason}`);
  const { page, errors, consoleErrors } = await browser.newPage();
  try {
    await page.goto(`${srv.baseUrl}/#connections/note/${seed.note.id}`);
    await page.waitForSelector('[data-testid="graph-svg"]');
    assert.equal(await page.locator('[data-testid="graph-focus-label"]').textContent(), 'Invoice process');
    const nodes = await page.locator('[data-testid="graph-node"]').count();
    assert.ok(nodes >= 3, `focus + neighbours drawn (${nodes})`);
    assert.equal(await page.locator('[data-testid="graph-node"][data-depth="0"]').count(), 1);
    assert.ok((await page.locator('[data-testid="graph-side-row"]').count()) >= 2);

    // Previous month: nothing was active, so the month really filters — only the focus is left,
    // and the toggle says how many quiet connections are hidden.
    await page.click('[data-month-step="-1"]');
    await page.waitForSelector('[data-month-reset]');
    await page.waitForSelector('[data-testid="graph-empty"]');
    assert.equal(await page.locator('[data-testid="graph-node"]').count(), 1);
    const toggle = page.locator('[data-testid="graph-quiet-toggle"]');
    assert.match((await toggle.textContent()) || '', /Show \d+ quiet/);
    await toggle.click();
    await page.waitForSelector('[data-testid="graph-node"].gnode-stale');
    const stale = await page.locator('[data-testid="graph-node"].gnode-stale').count();
    assert.ok(stale >= 2, `quiet direct neighbours come back greyed (${stale})`);
    assert.match((await page.locator('[data-testid="graph-quiet-toggle"]').textContent()) || '', /Hide quiet/);
    await page.click('[data-testid="graph-quiet-toggle"]');
    await page.click('[data-month-reset]');
    await page.waitForSelector('[data-month-reset]', { state: 'detached' });

    // Clicking a neighbour re-centres on it
    await page.click(`[data-testid="graph-node"][data-id="${seed.task.id}"] circle`);
    await page.waitForFunction('document.querySelector("[data-testid=graph-focus-label]")?.textContent === "Send invoice"');
    assert.ok(page.url().endsWith(`#connections/task/${seed.task.id}`));

    // The clicked item is pinned: it survives month changes, and says so
    assert.equal(await page.locator('[data-testid="graph-unpin"]').count(), 1);
    await page.click('[data-month-step="-1"]');
    await page.waitForSelector('[data-month-reset]');
    assert.equal((await page.locator('[data-testid="graph-focus-label"]').textContent())?.trim(), 'Send invoice', 'pinned focus stays when stepping months');
    await page.click('[data-month-reset]');
    await page.waitForSelector('[data-month-reset]', { state: 'detached' });

    // Keyboard shortcut → bare #connections: the pin is released and the server suggests the
    // most connected active item (this is what used to keep one item in the centre forever).
    await page.goto(`${srv.baseUrl}/#today`);
    await page.waitForSelector('[data-testid="timer-display"]');
    await page.keyboard.press('8');
    await page.waitForSelector('[data-testid="graph-svg"]');
    assert.ok(await page.locator('.nav-item[data-page="connections"]').evaluate((el: any) => el.classList.contains('active')));
    assert.equal(await page.locator('[data-testid="graph-unpin"]').count(), 0, 'nothing pinned after bare navigation');
    assert.match((await page.locator('[data-testid="graph-subtitle"]').textContent()) || '', /most connected item this month/);
    assert.ok((await page.locator('[data-testid="graph-node"]').count()) >= 3, 'the suggested focus is a connected one');

    // Release from a pinned state goes back to the suggestion too
    await page.goto(`${srv.baseUrl}/#connections/task/${seed.task.id}`);
    await page.waitForSelector('[data-testid="graph-unpin"]');
    await page.click('[data-testid="graph-unpin"]');
    await page.waitForSelector('[data-testid="graph-unpin"]', { state: 'detached' });
    assert.ok(page.url().endsWith('#connections'));

    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
  } catch (err) {
    await saveFailureArtefacts('U05-graph', page, [...errors, ...consoleErrors]);
    throw err;
  } finally {
    await page.close();
  }
});
