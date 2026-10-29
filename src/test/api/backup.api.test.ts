import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startTestServer } from '../helpers/testServer.js';

test('backup API - a start-up backup exists, manual ones can be made, and a restore rolls the store back', async () => {
  const srv = await startTestServer();
  try {
    const initial = await srv.api('GET', '/api/backups');
    assert.equal(initial.status, 200);
    assert.equal(initial.data.directory, path.join(srv.tmpDir, 'backups'));
    assert.equal(initial.data.backups.length, 1, 'the server backs the store up at start-up');
    assert.equal(initial.data.backups[0].reason, 'startup');

    await srv.api('POST', '/api/tasks', { title: 'Created after the backup' });
    const created = await srv.api('POST', '/api/backups');
    assert.equal(created.status, 201);
    assert.equal(created.data.created.reason, 'manual');

    const unchanged = await srv.api('POST', '/api/backups');
    assert.equal(unchanged.status, 200);
    assert.equal(unchanged.data.created, null, 'no duplicate backup for an unchanged store');

    // Lose some work, then restore the start-up copy
    await srv.api('POST', '/api/tasks', { title: 'Accidental nonsense' });
    const restore = await srv.api('POST', `/api/backups/${initial.data.backups[0].name}/restore`);
    assert.equal(restore.status, 200);
    assert.equal(restore.data.restored, initial.data.backups[0].name);
    assert.ok(restore.data.safetyCopy, 'the pre-restore state is kept');

    const titles = (await srv.api('GET', '/api/tasks')).data.map((t: any) => t.title);
    assert.ok(!titles.includes('Accidental nonsense'));
    assert.ok(!titles.includes('Created after the backup'));
    assert.ok(titles.some((t: string) => t.includes('Welcome to HeyWork')), 'seed data is back');

    assert.equal((await srv.api('POST', '/api/backups/not-a-backup.json/restore')).status, 404);
  } finally {
    await srv.close();
  }
});

test('backup API - backups are real copies on disk, readable as stores', async () => {
  const srv = await startTestServer();
  try {
    const list = (await srv.api('GET', '/api/backups')).data;
    const file = path.join(list.directory, list.backups[0].name);
    const parsed = JSON.parse(await fs.readFile(file, 'utf-8'));
    assert.ok(Array.isArray(parsed.tasks));
    assert.ok(Array.isArray(parsed.thoughts));
    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    }
  } finally {
    await srv.close();
  }
});
