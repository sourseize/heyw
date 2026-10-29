import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Database } from '../../db/database.js';

async function makeDb() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'heyw-thoughts-'));
  const db = new Database(path.join(dir, 'db.json'));
  await db.init();
  return { db, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

test('thoughts - captured thoughts start in the inbox, newest first, with context', async () => {
  const { db, cleanup } = await makeDb();
  try {
    const first = db.createThought({ text: 'Check the retry logic' });
    await new Promise(r => setTimeout(r, 5));
    const second = db.createThought({
      text: 'Call the dentist',
      context: { view: 'today', timerRunning: true, timerType: 'focus', taskId: 'abc', taskTitle: 'Ship the parser' },
    });

    assert.equal(first.status, 'inbox');
    assert.equal(first.reviewedAt, undefined);
    assert.ok(first.capturedAt);

    const inbox = db.getThoughts({ status: 'inbox' });
    assert.deepEqual(inbox.map(t => t.id), [second.id, first.id], 'newest first');
    assert.equal(inbox[0].context!.taskTitle, 'Ship the parser');
    assert.equal(db.countThoughts('inbox'), 2);
  } finally {
    await cleanup();
  }
});

test('thoughts - keep, discard and restore move status without ever deleting', async () => {
  const { db, cleanup } = await makeDb();
  try {
    const t = db.createThought({ text: 'Maybe rewrite the importer' });

    const kept = db.updateThought(t.id, { status: 'kept' })!;
    assert.equal(kept.status, 'kept');
    assert.ok(kept.reviewedAt, 'triage time recorded');

    const discarded = db.updateThought(t.id, { status: 'discarded' })!;
    assert.equal(discarded.status, 'discarded');
    assert.equal(db.getThoughts({ status: 'inbox' }).length, 0, 'out of sight');
    assert.equal(db.getThoughts({ status: 'kept' }).length, 0);
    assert.equal(db.getThoughts().length, 1, 'but still there');

    const restored = db.updateThought(t.id, { status: 'inbox' })!;
    assert.equal(restored.status, 'inbox');
    assert.equal(restored.reviewedAt, undefined, 'back to untriaged');

    assert.equal(db.updateThought('missing', { status: 'kept' }), null);
  } finally {
    await cleanup();
  }
});

test('thoughts - converting creates a task and links both ways', async () => {
  const { db, cleanup } = await makeDb();
  try {
    const thought = db.createThought({ text: 'Write the migration guide' });
    const { thought: updated, task } = db.convertThoughtToTask(thought.id, { priority: 'high' })!;

    assert.equal(task.title, 'Write the migration guide', 'the text becomes the title by default');
    assert.equal(task.status, 'todo');
    assert.equal(task.priority, 'high');
    assert.equal(task.estimatedMinutes, 25);
    assert.equal(updated.status, 'converted');
    assert.equal(updated.taskId, task.id);
    assert.ok(updated.reviewedAt);
    assert.equal(db.getTask(task.id)!.id, task.id);

    // An explicit title wins over the raw thought text
    const other = db.createThought({ text: 'vague mumble about caching' });
    const { task: renamed } = db.convertThoughtToTask(other.id, { title: 'Add an LRU cache to the parser' })!;
    assert.equal(renamed.title, 'Add an LRU cache to the parser');

    assert.equal(db.convertThoughtToTask('missing'), null);
  } finally {
    await cleanup();
  }
});

test('thoughts - the dashboard reports how many are waiting', async () => {
  const { db, cleanup } = await makeDb();
  try {
    assert.equal(db.getDashboardSummary().inboxCount, 0);
    const a = db.createThought({ text: 'one' });
    db.createThought({ text: 'two' });
    assert.equal(db.getDashboardSummary().inboxCount, 2);
    db.updateThought(a.id, { status: 'discarded' });
    assert.equal(db.getDashboardSummary().inboxCount, 1, 'discarded thoughts stop nagging');
  } finally {
    await cleanup();
  }
});

test('thoughts - survive a round trip through the store', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'heyw-thoughts-'));
  const file = path.join(dir, 'db.json');
  try {
    const db = new Database(file);
    await db.init();
    db.createThought({ text: 'persist me', context: { view: 'today', timerRunning: true } });
    await db.persist();

    const again = new Database(file);
    await again.init();
    const [t] = again.getThoughts();
    assert.equal(t.text, 'persist me');
    assert.equal(t.context!.timerRunning, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
