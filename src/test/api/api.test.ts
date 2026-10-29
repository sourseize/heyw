import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/testServer.js';
import type { TestServer } from '../helpers/testServer.js';

let srv: TestServer;

test.before(async () => {
  srv = await startTestServer();
});

test.after(async () => {
  await srv.close();
});

test('API - GET /api/dashboard returns summary', async () => {
  const { status, data } = await srv.api('GET', '/api/dashboard');
  assert.strictEqual(status, 200);
  assert.ok(data.today);
  assert.strictEqual(typeof data.streak, 'number');
  assert.strictEqual(Array.isArray(data.last7Days), true);
  assert.strictEqual(data.last7Days.length, 7);
  assert.strictEqual(data.timeZone, 'UTC');
  assert.strictEqual(data.inboxCount, 0);
});

test('API - dashboard honours ?tz=, remembers it, and warns on unknown zones', async () => {
  const ok = await srv.api('GET', '/api/dashboard?tz=Asia/Tokyo');
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.data.timeZone, 'Asia/Tokyo');
  assert.strictEqual(ok.headers.get('x-heywork-warning'), null);
  const store = await srv.readStore();
  assert.strictEqual(store.settings.timeZone, 'Asia/Tokyo');

  const bad = await srv.api('GET', '/api/dashboard?tz=Mars/Olympus');
  assert.strictEqual(bad.status, 200);
  assert.strictEqual(bad.data.timeZone, 'UTC');
  assert.match(bad.headers.get('x-heywork-warning') || '', /Unknown time zone/);
});

test('API - Projects CRUD lifecycle', async () => {
  const createRes = await srv.api('POST', '/api/projects', {
    name: 'Deep Learning',
    color: '#10b981',
    description: 'Neural networks and research',
  });
  assert.strictEqual(createRes.status, 201);
  const created = createRes.data;
  assert.ok(created.id);
  assert.strictEqual(created.name, 'Deep Learning');

  const list = await srv.api('GET', '/api/projects');
  assert.ok(list.data.some((p: any) => p.id === created.id));

  const updateRes = await srv.api('PUT', `/api/projects/${created.id}`, { name: 'AI & Deep Learning' });
  assert.strictEqual(updateRes.status, 200);
  assert.strictEqual(updateRes.data.name, 'AI & Deep Learning');

  const delRes = await srv.api('DELETE', `/api/projects/${created.id}`);
  assert.strictEqual(delRes.status, 200);
  assert.strictEqual((await srv.api('DELETE', `/api/projects/${created.id}`)).status, 404);
});

test('API - Tasks creation and status transition', async () => {
  const postRes = await srv.api('POST', '/api/tasks', {
    title: 'Review pull request',
    description: 'Check architecture and unit tests',
    status: 'todo',
    priority: 'high',
    tags: ['code-review'],
  });
  assert.strictEqual(postRes.status, 201);
  const task = postRes.data;
  assert.strictEqual(task.title, 'Review pull request');

  const putRes = await srv.api('PUT', `/api/tasks/${task.id}`, { status: 'done' });
  assert.strictEqual(putRes.status, 200);
  assert.strictEqual(putRes.data.status, 'done');
  assert.ok(putRes.data.completedAt);
});

test('API - PUT ignores non-allow-listed fields and rejects invalid values (hardening)', async () => {
  const { data: task } = await srv.api('POST', '/api/tasks', { title: 'Immutable identity' });

  const sneaky = await srv.api('PUT', `/api/tasks/${task.id}`, {
    id: 'hijacked',
    createdAt: '1999-01-01T00:00:00.000Z',
    completedAt: '1999-01-01T00:00:00.000Z',
    title: '  Trimmed  ',
  });
  assert.strictEqual(sneaky.status, 200);
  assert.strictEqual(sneaky.data.id, task.id);
  assert.strictEqual(sneaky.data.createdAt, task.createdAt);
  assert.strictEqual(sneaky.data.completedAt, undefined);
  assert.strictEqual(sneaky.data.title, 'Trimmed');

  assert.strictEqual((await srv.api('PUT', `/api/tasks/${task.id}`, { status: 'finished' })).status, 400);
  assert.strictEqual((await srv.api('PUT', `/api/tasks/${task.id}`, { priority: 'asap' })).status, 400);
  assert.strictEqual((await srv.api('PUT', `/api/tasks/${task.id}`, { title: '' })).status, 400);
  assert.strictEqual((await srv.api('PUT', `/api/tasks/${task.id}`, { tags: 'x' })).status, 400);
  assert.strictEqual((await srv.api('POST', '/api/tasks', { title: 'x', status: 'nope' })).status, 400);

  const { data: project } = await srv.api('POST', '/api/projects', { name: 'P' });
  const p2 = await srv.api('PUT', `/api/projects/${project.id}`, { id: 'x', createdAt: 'y', archived: 1 });
  assert.strictEqual(p2.data.id, project.id);
  assert.strictEqual(p2.data.createdAt, project.createdAt);
  assert.strictEqual(p2.data.archived, true);
  assert.strictEqual((await srv.api('PUT', `/api/projects/${project.id}`, { name: '' })).status, 400);

  const { data: note } = await srv.api('POST', '/api/notes', { title: 'N', content: 'c' });
  const n2 = await srv.api('PUT', `/api/notes/${note.id}`, { id: 'x', updatedAt: 'y', pinned: 'yes', content: 'd' });
  assert.strictEqual(n2.data.id, note.id);
  assert.notStrictEqual(n2.data.updatedAt, 'y');
  assert.strictEqual(n2.data.pinned, true);
  assert.strictEqual(n2.data.content, 'd');
  assert.strictEqual((await srv.api('PUT', `/api/notes/${note.id}`, { content: 5 })).status, 400);
});

test('API - Log Focus Session', async () => {
  const res = await srv.api('POST', '/api/focus', { durationMinutes: 25, type: 'focus', notes: 'Morning sprint' });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.data.durationMinutes, 25);
  assert.strictEqual(res.data.type, 'focus');
});

test('API - Daily Log upsert', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const res = await srv.api('POST', '/api/logs', {
    date: today,
    intentions: ['Focus on core architecture', 'Ship clean tests'],
    retro: 'Productive day with high focus',
    energyRating: 5,
    focusRating: 5,
    notes: 'Evening wrap-up complete',
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.date, today);
  assert.strictEqual(res.data.energyRating, 5);
});

test('API - privacy: no CORS headers, cross-origin writes are refused, same-origin accepted', async () => {
  const plain = await fetch(`${srv.baseUrl}/api/tasks`);
  assert.strictEqual(plain.headers.get('access-control-allow-origin'), null);
  assert.strictEqual(plain.headers.get('x-content-type-options'), 'nosniff');

  const preflight = await fetch(`${srv.baseUrl}/api/tasks`, { method: 'OPTIONS', headers: { Origin: 'http://evil.example' } });
  assert.strictEqual(preflight.status, 204);
  assert.strictEqual(preflight.headers.get('access-control-allow-origin'), null);
  assert.strictEqual(preflight.headers.get('access-control-allow-methods'), null);

  const crossSite = await srv.api('POST', '/api/tasks', { title: 'evil' }, { Origin: 'http://evil.example' });
  assert.strictEqual(crossSite.status, 403);

  const sameOrigin = await srv.api('POST', '/api/tasks', { title: 'friendly' }, { Origin: srv.baseUrl });
  assert.strictEqual(sameOrigin.status, 201);

  const fetchMeta = await srv.api('POST', '/api/tasks', { title: 'x' }, { Origin: srv.baseUrl, 'Sec-Fetch-Site': 'cross-site' });
  assert.strictEqual(fetchMeta.status, 403);

  // GETs with a foreign Origin are still served (the browser blocks the *read* because no CORS header is present)
  const read = await srv.api('GET', '/api/tasks', undefined, { Origin: 'http://evil.example' });
  assert.strictEqual(read.status, 200);
  assert.strictEqual(read.headers.get('access-control-allow-origin'), null);
});
