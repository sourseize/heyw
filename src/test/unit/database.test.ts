import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Database } from '../../db/database.js';

test('Database - initialization & seed data', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'heyw-test-'));
  const tmpDbPath = path.join(tmpDir, 'test-db.json');

  try {
    const db = new Database(tmpDbPath);
    await db.init();

    // Verify seed data exists
    const projects = db.getProjects();
    assert.strictEqual(projects.length >= 1, true);
    assert.strictEqual(projects[0].name, 'General');

    const tasks = db.getTasks();
    assert.strictEqual(tasks.length >= 3, true);

    const notes = db.getNotes();
    assert.strictEqual(notes.length >= 1, true);

    const summary = db.getDashboardSummary();
    assert.ok(summary.today);
    assert.strictEqual(typeof summary.streak, 'number');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('Database - Task CRUD operations', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'heyw-test-'));
  const tmpDbPath = path.join(tmpDir, 'test-db.json');

  try {
    const db = new Database(tmpDbPath);
    await db.init();

    // Create task
    const newTask = db.createTask({
      title: 'Write automated tests',
      description: 'Ensure 100% test pass rate',
      status: 'todo',
      priority: 'high',
      tags: ['testing', 'dev'],
    });

    assert.ok(newTask.id);
    assert.strictEqual(newTask.title, 'Write automated tests');
    assert.strictEqual(newTask.status, 'todo');

    // Update task
    const updated = db.updateTask(newTask.id, { status: 'done' });
    assert.strictEqual(updated?.status, 'done');
    assert.ok(updated?.completedAt);

    // Delete task
    const deleted = db.deleteTask(newTask.id);
    assert.strictEqual(deleted, true);
    assert.strictEqual(db.getTask(newTask.id), undefined);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('Database - Focus sessions and time tracking', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'heyw-test-'));
  const tmpDbPath = path.join(tmpDir, 'test-db.json');

  try {
    const db = new Database(tmpDbPath);
    await db.init();

    const task = db.createTask({
      title: 'Deep work block',
      description: 'Focus session testing',
      status: 'in_progress',
      priority: 'urgent',
      tags: ['deepwork'],
    });

    const session = db.logFocusSession({
      taskId: task.id,
      taskTitle: task.title,
      durationMinutes: 25,
      type: 'focus',
      completed: true,
      notes: 'Flow state achieved',
    });

    assert.ok(session.id);
    assert.strictEqual(session.completed, true);

    // Task actual minutes should be incremented
    const refreshedTask = db.getTask(task.id);
    assert.strictEqual(refreshedTask?.actualMinutes, 25);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('Database - dashboard buckets days in the requested time zone', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'heyw-test-'));
  const tmpDbPath = path.join(tmpDir, 'test-db.json');

  try {
    const db = new Database(tmpDbPath);
    await db.init();

    // A session logged "now" at 23:30 UTC on 2025-03-31 is still Monday in UTC/New York
    // but already Tuesday 2025-04-01 in Amsterdam and Auckland.
    const session = db.logFocusSession({ durationMinutes: 25, type: 'focus', completed: true, notes: '' });
    session.timestamp = '2025-03-31T23:30:00.000Z';
    const now = new Date('2025-03-31T23:45:00.000Z');

    const utc = db.getDashboardSummary('UTC', now);
    assert.equal(utc.today, '2025-03-31');
    assert.equal(utc.timeZone, 'UTC');
    assert.equal(utc.focusTodayMinutes, 25);
    assert.equal(utc.streak, 1);
    assert.equal(utc.last7Days[6].date, '2025-03-31');
    assert.equal(utc.last7Days[6].day, 'Mon');
    assert.equal(utc.last7Days[6].focusMinutes, 25);

    const ams = db.getDashboardSummary('Europe/Amsterdam', now);
    assert.equal(ams.today, '2025-04-01');
    assert.equal(ams.focusTodayMinutes, 25, 'session at 01:30 local belongs to the 1st');
    assert.equal(ams.last7Days[6].day, 'Tue');

    const ny = db.getDashboardSummary('America/New_York', now);
    assert.equal(ny.today, '2025-03-31');
    assert.equal(ny.focusTodayMinutes, 25);

    // Streak: yesterday counts when nothing happened today yet
    const nextDay = new Date('2025-04-01T12:00:00.000Z');
    const later = db.getDashboardSummary('UTC', nextDay);
    assert.equal(later.today, '2025-04-01');
    assert.equal(later.focusTodayMinutes, 0);
    assert.equal(later.streak, 1);
    const twoDaysLater = db.getDashboardSummary('UTC', new Date('2025-04-02T12:00:00.000Z'));
    assert.equal(twoDaysLater.streak, 0);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('Database - settings remember the last client time zone', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'heyw-test-'));
  try {
    const db = new Database(path.join(tmpDir, 'db.json'));
    await db.init();
    assert.deepEqual(db.getSettings(), {});
    assert.equal(db.rememberTimeZone('Asia/Tokyo'), true);
    assert.equal(db.rememberTimeZone('Asia/Tokyo'), false);
    assert.equal(db.getSettings().timeZone, 'Asia/Tokyo');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
