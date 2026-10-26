import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../server.js';
import type { AddressInfo } from 'node:net';

let server: http.Server;
let baseUrl: string;

test.before(async () => {
  server = await createServer();
  await new Promise<void>(resolve => {
    server.listen(0, () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://localhost:${addr.port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

test('API - GET /api/dashboard returns summary', async () => {
  const res = await fetch(`${baseUrl}/api/dashboard`);
  assert.strictEqual(res.status, 200);
  const data = await res.json() as any;
  assert.ok(data.today);
  assert.strictEqual(typeof data.streak, 'number');
  assert.strictEqual(Array.isArray(data.last7Days), true);
  assert.strictEqual(data.last7Days.length, 7);
});

test('API - Projects CRUD lifecycle', async () => {
  // Create
  const createRes = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Deep Learning',
      color: '#10b981',
      description: 'Neural networks and research',
    }),
  });
  assert.strictEqual(createRes.status, 201);
  const created = await createRes.json() as any;
  assert.ok(created.id);
  assert.strictEqual(created.name, 'Deep Learning');

  // List
  const listRes = await fetch(`${baseUrl}/api/projects`);
  const projects = await listRes.json() as any[];
  assert.ok(projects.some((p: any) => p.id === created.id));

  // Update
  const updateRes = await fetch(`${baseUrl}/api/projects/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'AI & Deep Learning' }),
  });
  assert.strictEqual(updateRes.status, 200);
  const updated = await updateRes.json() as any;
  assert.strictEqual(updated.name, 'AI & Deep Learning');

  // Delete
  const delRes = await fetch(`${baseUrl}/api/projects/${created.id}`, {
    method: 'DELETE',
  });
  assert.strictEqual(delRes.status, 200);
});

test('API - Tasks creation and status transition', async () => {
  const postRes = await fetch(`${baseUrl}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Review pull request',
      description: 'Check architecture and unit tests',
      status: 'todo',
      priority: 'high',
      tags: ['code-review'],
    }),
  });
  assert.strictEqual(postRes.status, 201);
  const task = await postRes.json() as any;
  assert.strictEqual(task.title, 'Review pull request');

  // Transition to done
  const putRes = await fetch(`${baseUrl}/api/tasks/${task.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'done' }),
  });
  assert.strictEqual(putRes.status, 200);
  const completedTask = await putRes.json() as any;
  assert.strictEqual(completedTask.status, 'done');
  assert.ok(completedTask.completedAt);
});

test('API - Log Focus Session', async () => {
  const res = await fetch(`${baseUrl}/api/focus`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      durationMinutes: 25,
      type: 'focus',
      notes: 'Morning sprint',
    }),
  });
  assert.strictEqual(res.status, 201);
  const session = await res.json() as any;
  assert.strictEqual(session.durationMinutes, 25);
  assert.strictEqual(session.type, 'focus');
});

test('API - Daily Log upsert', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch(`${baseUrl}/api/logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date: today,
      intentions: ['Focus on core architecture', 'Ship clean tests'],
      retro: 'Productive day with high focus',
      energyRating: 5,
      focusRating: 5,
      notes: 'Evening wrap-up complete',
    }),
  });
  assert.strictEqual(res.status, 200);
  const log = await res.json() as any;
  assert.strictEqual(log.date, today);
  assert.strictEqual(log.energyRating, 5);
});
