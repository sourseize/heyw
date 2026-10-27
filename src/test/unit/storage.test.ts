import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Database, DatabaseFileError, emptySchema, normaliseSchema, jsonCodec } from '../../db/database.js';
import type { StorageCodec } from '../../db/database.js';

async function tmpFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'heyw-storage-'));
  return { dir, file: path.join(dir, 'db.json'), cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

test('storage - fresh install seeds and writes an owner-only file', async () => {
  const t = await tmpFile();
  try {
    const db = new Database(t.file);
    await db.init();
    const stat = await fs.stat(t.file);
    if (process.platform !== 'win32') {
      assert.equal(stat.mode & 0o777, 0o600, 'data file must be 0600');
    }
    const parsed = JSON.parse(await fs.readFile(t.file, 'utf-8'));
    assert.deepEqual(Object.keys(parsed).sort(), Object.keys(emptySchema()).sort());
    assert.equal(parsed.thoughts.length, 0);
    assert.equal(parsed.monthlySummaries.length, 0);
    assert.deepEqual(parsed.settings, {});
  } finally {
    await t.cleanup();
  }
});

test('storage - a pre-existing v1 file (no thoughts/monthlySummaries/settings) loads and is upgraded on persist', async () => {
  const t = await tmpFile();
  try {
    const v1 = {
      projects: [{ id: 'p1', name: 'Old', color: '#000', description: '', archived: false, createdAt: '2024-01-01T00:00:00.000Z' }],
      tasks: [],
      focusSessions: [],
      dailyLogs: [],
      notes: [],
    };
    await fs.writeFile(t.file, JSON.stringify(v1), 'utf-8');
    const db = new Database(t.file);
    await db.init();
    assert.equal(db.getProjects()[0].name, 'Old', 'no welcome seed on an existing file');
    assert.equal(db.getTasks().length, 0);
    assert.equal(db.getDashboardSummary().inboxCount, 0);
    await db.persist();
    const parsed = JSON.parse(await fs.readFile(t.file, 'utf-8'));
    assert.deepEqual(parsed.thoughts, []);
    assert.deepEqual(parsed.monthlySummaries, []);
    assert.deepEqual(parsed.settings, {});
    assert.equal(parsed.projects[0].id, 'p1');
  } finally {
    await t.cleanup();
  }
});

test('storage - a corrupt file is refused and left untouched (never overwritten by the seed)', async () => {
  const t = await tmpFile();
  try {
    const garbage = '{"projects": [1, 2'; // truncated JSON
    await fs.writeFile(t.file, garbage, 'utf-8');
    const db = new Database(t.file);
    await assert.rejects(() => db.init(), (err: any) => err instanceof DatabaseFileError && err.filePath === t.file);
    assert.equal(await fs.readFile(t.file, 'utf-8'), garbage, 'file content must be preserved');
    assert.equal(db.isInitialized, false);
  } finally {
    await t.cleanup();
  }
});

test('storage - a JSON file of the wrong shape is refused', async () => {
  const t = await tmpFile();
  try {
    await fs.writeFile(t.file, JSON.stringify({ tasks: 'nope' }), 'utf-8');
    await assert.rejects(() => new Database(t.file).init(), DatabaseFileError);
    await fs.writeFile(t.file, JSON.stringify([1, 2, 3]), 'utf-8');
    await assert.rejects(() => new Database(t.file).init(), DatabaseFileError);
    assert.throws(() => normaliseSchema(null), DatabaseFileError);
    assert.throws(() => normaliseSchema({ settings: [] }), DatabaseFileError);
  } finally {
    await t.cleanup();
  }
});

test('storage - persist is atomic: no temp files linger and content round-trips', async () => {
  const t = await tmpFile();
  try {
    const db = new Database(t.file);
    await db.init();
    db.createNote({ title: 'Round trip', content: 'ünïcödé ✓', tags: ['x'], pinned: false });
    await db.persist();
    const files = await fs.readdir(t.dir);
    assert.deepEqual(files, ['db.json']);
    const again = new Database(t.file);
    await again.init();
    assert.equal(again.getNotes('x')[0].content, 'ünïcödé ✓');
  } finally {
    await t.cleanup();
  }
});

test('storage - useFile() re-targets an instance (singleton support for createServer/tests)', async () => {
  const a = await tmpFile();
  const b = await tmpFile();
  try {
    const db = new Database(a.file);
    await db.init();
    db.createProject({ name: 'Only in A', color: '#fff', description: '', archived: false });
    await db.persist();
    db.useFile(b.file);
    assert.equal(db.isInitialized, false);
    await db.init();
    assert.equal(db.file, b.file);
    assert.ok(!db.getProjects().some(p => p.name === 'Only in A'));
  } finally {
    await a.cleanup();
    await b.cleanup();
  }
});

test('storage - codec seam: a custom codec is used for both encode and decode', async () => {
  const t = await tmpFile();
  try {
    // A trivially "encrypting" codec (reverse the bytes) proves the seam is honoured end-to-end.
    const reversing: StorageCodec = {
      encode: (data) => Buffer.from(Buffer.from(jsonCodec.encode(data) as string, 'utf-8').reverse()),
      decode: (raw) => jsonCodec.decode(Buffer.from(raw).reverse()),
    };
    const db = new Database(t.file, { codec: reversing });
    await db.init();
    db.createNote({ title: 'Secret', content: 'hidden', tags: [], pinned: false });
    await db.persist();
    const onDisk = await fs.readFile(t.file, 'utf-8');
    assert.ok(!onDisk.includes('"Secret"'), 'plain text must not be on disk with the custom codec');
    const again = new Database(t.file, { codec: reversing });
    await again.init();
    assert.ok(again.getNotes().some(n => n.title === 'Secret' && n.content === 'hidden'));
    // And the plain codec must refuse the encoded file rather than seed over it
    await assert.rejects(() => new Database(t.file).init(), DatabaseFileError);
    assert.equal(await fs.readFile(t.file, 'utf-8'), onDisk);
  } finally {
    await t.cleanup();
  }
});

test('storage - HEYW_DATA_FILE env is honoured when no path is given', async () => {
  const t = await tmpFile();
  const prev = process.env.HEYW_DATA_FILE;
  try {
    process.env.HEYW_DATA_FILE = t.file;
    const db = new Database();
    assert.equal(db.file, t.file);
  } finally {
    if (prev === undefined) delete process.env.HEYW_DATA_FILE;
    else process.env.HEYW_DATA_FILE = prev;
    await t.cleanup();
  }
});
