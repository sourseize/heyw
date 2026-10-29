import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Database } from '../../db/database.js';
import { BackupManager } from '../../db/backup.js';

async function scratch() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'heyw-backup-'));
  const dataFile = path.join(dir, 'database.json');
  return { dir, dataFile, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

test('backup - creates an owner-only copy next to the store and lists it', async () => {
  const s = await scratch();
  try {
    const db = new Database(s.dataFile);
    await db.init();
    const mgr = new BackupManager(s.dataFile);

    const entry = await mgr.create('startup');
    assert.ok(entry, 'a backup should be created');
    assert.equal(path.dirname(entry!.file), path.join(s.dir, 'backups'));
    assert.match(entry!.name, /^database-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-startup\.json$/);
    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(entry!.file)).mode & 0o777, 0o600);
    }
    const list = await mgr.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].reason, 'startup');
    assert.ok(Date.parse(list[0].createdAt) > 0, 'createdAt parses');
  } finally {
    await s.cleanup();
  }
});

test('backup - skips when the store has not changed, copies again once it has', async () => {
  const s = await scratch();
  try {
    const db = new Database(s.dataFile);
    await db.init();
    const mgr = new BackupManager(s.dataFile);

    assert.ok(await mgr.create('startup'));
    assert.equal(await mgr.create('manual'), null, 'unchanged store must not pile up backups');

    db.createTask({ title: 'Something new', description: '', status: 'todo', priority: 'low', tags: [] });
    await db.persist();
    assert.ok(await mgr.create('manual'), 'changed store is backed up');
    assert.equal((await mgr.list()).length, 2);

    // force overrides the dedupe
    assert.ok(await mgr.create('manual', { force: true }));
    assert.equal((await mgr.list()).length, 3);
  } finally {
    await s.cleanup();
  }
});

test('backup - retention keeps recent copies per day and prunes the rest', async () => {
  const s = await scratch();
  try {
    await fs.writeFile(s.dataFile, JSON.stringify({ tasks: [] }), 'utf-8');
    const mgr = new BackupManager(s.dataFile, { keepPerDay: 2, keepDays: 3, maxTotal: 10 });

    // 5 backups a day over 5 days
    for (let day = 1; day <= 5; day++) {
      for (let n = 0; n < 5; n++) {
        await mgr.create('interval', { force: true, now: new Date(Date.UTC(2025, 2, day, 9 + n, 0, 0)) });
      }
    }
    const list = await mgr.list();
    const days = new Set(list.map(e => e.createdAt.slice(0, 10)));
    assert.equal(days.size, 3, 'only the last 3 days are kept');
    assert.ok(list.length <= 6, `at most keepPerDay*keepDays copies, got ${list.length}`);
    assert.equal(list[0].createdAt.slice(0, 10), '2025-03-05', 'newest day survives');
    // the newest of the newest day is always retained
    assert.equal(list[0].createdAt, '2025-03-05T13:00:00Z');
  } finally {
    await s.cleanup();
  }
});

test('backup - restore recovers a fat-fingered manual edit and is itself reversible', async () => {
  const s = await scratch();
  try {
    const db = new Database(s.dataFile);
    await db.init();
    db.createTask({ title: 'Precious work', description: 'do not lose me', status: 'todo', priority: 'high', tags: [] });
    await db.persist();

    const mgr = new BackupManager(s.dataFile);
    const good = await mgr.create('manual');
    assert.ok(good);

    // The user opens the file in an editor and wrecks it
    await fs.writeFile(s.dataFile, '{"tasks": [ oops', 'utf-8');
    const broken = new Database(s.dataFile);
    await assert.rejects(() => broken.init());

    const { restored, safetyCopy } = await mgr.restore('latest');
    assert.equal(restored.name, good!.name);
    assert.ok(safetyCopy, 'the broken file is itself preserved before overwriting');

    const healed = new Database(s.dataFile);
    await healed.init();
    assert.ok(healed.getTasks().some(t => t.title === 'Precious work'));

    // The pre-restore copy holds the broken content, so even the restore can be undone
    assert.equal(await fs.readFile(safetyCopy!.file, 'utf-8'), '{"tasks": [ oops');
  } finally {
    await s.cleanup();
  }
});

test('backup - refuses to restore a corrupt or foreign backup', async () => {
  const s = await scratch();
  try {
    const db = new Database(s.dataFile);
    await db.init();
    const mgr = new BackupManager(s.dataFile);
    await mgr.create('manual');

    const dir = path.join(s.dir, 'backups');
    const bad = path.join(dir, 'database-2025-03-31T10-00-00Z-manual.json');
    await fs.writeFile(bad, '{"tasks": [ broken', 'utf-8');
    await assert.rejects(() => mgr.restore('database-2025-03-31T10-00-00Z-manual.json'), /not readable/);

    const foreign = path.join(dir, 'database-2025-03-31T11-00-00Z-manual.json');
    await fs.writeFile(foreign, JSON.stringify({ tasks: 'nope' }), 'utf-8');
    await assert.rejects(() => mgr.restore('database-2025-03-31T11-00-00Z-manual.json'), /not an array/);

    await assert.rejects(() => mgr.restore('nope.json'), /No such backup/);

    // The store is unharmed by the failed attempts
    const after = new Database(s.dataFile);
    await after.init();
    assert.ok(after.getProjects().length >= 1);
  } finally {
    await s.cleanup();
  }
});

test('backup - createIfDue respects the minimum interval', async () => {
  const s = await scratch();
  try {
    await fs.writeFile(s.dataFile, JSON.stringify({ tasks: [] }), 'utf-8');
    const mgr = new BackupManager(s.dataFile, { minIntervalMs: 60_000 });
    assert.ok(await mgr.createIfDue('interval'), 'first one is due immediately');
    await fs.writeFile(s.dataFile, JSON.stringify({ tasks: [{ id: 'x' }] }), 'utf-8');
    assert.equal(await mgr.createIfDue('interval'), null, 'too soon');
  } finally {
    await s.cleanup();
  }
});

test('backup - no store yet means nothing to back up', async () => {
  const s = await scratch();
  try {
    const mgr = new BackupManager(s.dataFile);
    assert.equal(await mgr.create('startup'), null);
    assert.deepEqual(await mgr.list(), []);
    assert.equal(await mgr.latest(), null);
  } finally {
    await s.cleanup();
  }
});
