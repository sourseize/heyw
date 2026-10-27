/**
 * U06 — destructive actions use the application modal, never window.confirm().
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/testServer.js';
import { launchBrowser, saveFailureArtefacts } from '../helpers/browser.js';
import type { BrowserHandle } from '../helpers/browser.js';

let browser: BrowserHandle;
test.before(async () => { browser = await launchBrowser(); });
test.after(async () => { await browser?.close(); });

test('U06 - deleting a task or a note asks through the app modal; cancel, Esc and confirm behave', async t => {
  if (!browser.available) return t.skip(`UI suite skipped: ${browser.reason}`);
  const srv = await startTestServer();
  const { page, errors, consoleErrors } = await browser.newPage();
  let nativeDialogs = 0;
  page.on('dialog', async (d: any) => { nativeDialogs++; await d.dismiss(); });
  try {
    const { data: task } = await srv.api('POST', '/api/tasks', { title: 'Delete me please' });
    await page.goto(`${srv.baseUrl}/#board`);
    await page.waitForSelector('#board-add-task-btn');

    const card = page.locator('.task-card', { hasText: 'Delete me please' });
    await card.locator('.task-del-btn').click();
    await page.waitForSelector('[data-testid="modal"]');
    assert.match(await page.textContent('#modal-title') || '', /Delete this task\?/);
    assert.match(await page.textContent('[data-testid="confirm-message"]') || '', /Delete me please/);
    assert.equal(await page.textContent('[data-testid="modal-confirm"]'), 'Delete');

    // Cancel keeps it
    await page.click('[data-testid="modal-cancel"]');
    await page.waitForFunction('!document.querySelector("[data-testid=modal]")');
    assert.equal((await srv.api('GET', '/api/tasks')).data.some((x: any) => x.id === task.id), true);

    // Esc keeps it too
    await card.locator('.task-del-btn').click();
    await page.waitForSelector('[data-testid="modal"]');
    await page.keyboard.press('Escape');
    await page.waitForFunction('!document.querySelector("[data-testid=modal]")');
    assert.equal((await srv.api('GET', '/api/tasks')).data.some((x: any) => x.id === task.id), true);

    // Confirm deletes
    await card.locator('.task-del-btn').click();
    await page.waitForSelector('[data-testid="modal-confirm"]');
    await page.click('[data-testid="modal-confirm"]');
    await page.waitForFunction('!document.querySelector("[data-testid=modal]")');
    await page.waitForFunction('!document.body.textContent.includes("Delete me please")');
    assert.equal((await srv.api('GET', '/api/tasks')).data.some((x: any) => x.id === task.id), false);

    // Notes use the same modal
    await srv.api('POST', '/api/notes', { title: 'Disposable note', content: 'bye' });
    await page.goto(`${srv.baseUrl}/#notes`);
    await page.waitForSelector('#create-note-btn');
    await page.locator('.note-list-item', { hasText: 'Disposable note' }).click();
    await page.waitForFunction('document.getElementById("edit-note-title")?.value === "Disposable note"');
    await page.click('#delete-note-btn');
    await page.waitForSelector('[data-testid="modal"]');
    assert.match(await page.textContent('#modal-title') || '', /Delete this note\?/);
    await page.click('[data-testid="modal-confirm"]');
    await page.waitForFunction('!document.querySelector("[data-testid=modal]")');
    await page.waitForFunction('!document.body.textContent.includes("Disposable note")');

    assert.equal(nativeDialogs, 0, 'no browser confirm()/alert() dialogs');
    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
  } catch (err) {
    await saveFailureArtefacts('U06-dialogs', page, [...errors, ...consoleErrors]);
    throw err;
  } finally {
    await page.close();
    await srv.close();
  }
});
