import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Database } from '../db/database.js';

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
