/**
 * Foundation regression scenarios (workbook R01–R03, R11): the real server over HTTP,
 * static shell included, against an isolated temp store.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { startTestServer } from '../helpers/testServer.js';

test('R01 - boot & static shell: index, every referenced script, SPA fallback, API 404, no CORS', async () => {
  const srv = await startTestServer();
  try {
    const index = await fetch(`${srv.baseUrl}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type') || '', /text\/html/);
    const html = await index.text();
    assert.match(html, /<div class="app-container">/);

    const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
    assert.ok(scripts.length >= 9, 'expected the SPA script bundle list');
    for (const src of scripts) {
      const res = await fetch(`${srv.baseUrl}${src}`);
      assert.equal(res.status, 200, `${src} should be served`);
      assert.match(res.headers.get('content-type') || '', /javascript/, `${src} MIME`);
    }
    const css = await fetch(`${srv.baseUrl}/css/style.css`);
    assert.match(css.headers.get('content-type') || '', /text\/css/);

    const fallback = await fetch(`${srv.baseUrl}/some/client/route`);
    assert.equal(fallback.status, 200);
    assert.match(await fallback.text(), /<div class="app-container">/);

    const traversal = await fetch(`${srv.baseUrl}/../package.json`);
    assert.doesNotMatch(await traversal.text(), /"name": "heyw"/, 'must not leak files outside public/');

    const missing = await srv.api('GET', '/api/does-not-exist');
    assert.equal(missing.status, 404);
    assert.equal(missing.data.error, 'Endpoint not found');

    const anyRes = await fetch(`${srv.baseUrl}/api/dashboard`);
    assert.equal(anyRes.headers.get('access-control-allow-origin'), null);

    // Server is bound to loopback only
    assert.equal((srv.server.address() as any).address, '127.0.0.1');
  } finally {
    await srv.close();
  }
});

test('R02 - fresh install: welcome seed, file created owner-only with the full schema', async () => {
  const srv = await startTestServer();
  try {
    const projects = (await srv.api('GET', '/api/projects')).data;
    assert.equal(projects.length, 1);
    assert.equal(projects[0].name, 'General');
    assert.equal((await srv.api('GET', '/api/tasks')).data.length, 3);
    assert.equal((await srv.api('GET', '/api/notes')).data.length, 1);
    assert.equal((await srv.api('GET', '/api/logs')).data.length, 1);

    const store = await srv.readStore();
    assert.deepEqual(store.thoughts, []);
    assert.deepEqual(store.monthlySummaries, []);
    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(srv.dataFile)).mode & 0o777, 0o600);
    }
  } finally {
    await srv.close();
  }
});

test('R03 - persistence: data survives a server restart; a corrupt file refuses to start and is untouched', async () => {
  const first = await startTestServer();
  const { tmpDir, dataFile } = first;
  try {
    const { data: project } = await first.api('POST', '/api/projects', { name: 'Persist me', color: '#123456' });
    const { data: task } = await first.api('POST', '/api/tasks', { title: 'Survive restart', projectId: project.id, priority: 'urgent' });
    await first.api('PUT', `/api/tasks/${task.id}`, { status: 'done' });
    await first.api('POST', '/api/focus', { durationMinutes: 50, taskId: task.id, taskTitle: task.title });
    await first.api('POST', '/api/notes', { title: 'Sticky', content: 'still here', pinned: true });
    await first.api('POST', '/api/logs', { date: '2025-03-31', intentions: ['a'], retro: 'b', energyRating: 2, focusRating: 3 });
    await first.stop();

    const second = await startTestServer({ tmpDir, dataFile });
    try {
      const tasks = (await second.api('GET', '/api/tasks')).data;
      const t = tasks.find((x: any) => x.id === task.id);
      assert.ok(t, 'task persisted');
      assert.equal(t.status, 'done');
      assert.equal(t.actualMinutes, 50, 'focus credit persisted');
      assert.equal(t.projectId, project.id);
      assert.ok((await second.api('GET', '/api/projects')).data.some((p: any) => p.id === project.id));
      assert.equal((await second.api('GET', '/api/notes?q=still')).data[0].title, 'Sticky');
      assert.equal((await second.api('GET', '/api/logs/2025-03-31')).data.retro, 'b');
      await second.stop();
    } catch (err) {
      await second.stop().catch(() => {});
      throw err;
    }

    // Corrupt the file: the server must refuse to start and must not overwrite it
    const corrupt = '{"projects": [ truncated';
    await fs.writeFile(dataFile, corrupt, 'utf-8');
    await assert.rejects(() => startTestServer({ tmpDir, dataFile }), /corrupt|not in the expected format/i);
    assert.equal(await fs.readFile(dataFile, 'utf-8'), corrupt);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('R11 - backward compatibility: a v1 store (no thoughts/monthlySummaries/settings) is served and upgraded in place', async () => {
  const v1 = {
    projects: [{ id: 'p-legacy', name: 'Legacy', color: '#000000', description: '', archived: false, createdAt: '2024-05-01T00:00:00.000Z' }],
    tasks: [{ id: 't-legacy', projectId: 'p-legacy', title: 'Old task', description: '', status: 'todo', priority: 'low', actualMinutes: 0, tags: [], order: 0, createdAt: '2024-05-01T00:00:00.000Z' }],
    focusSessions: [],
    dailyLogs: [],
    notes: [],
  };
  const srv = await startTestServer({ initialStore: v1 });
  try {
    assert.equal((await srv.api('GET', '/api/projects')).data[0].name, 'Legacy', 'no welcome seed over user data');
    assert.equal((await srv.api('GET', '/api/tasks')).data[0].id, 't-legacy');
    const dash = await srv.api('GET', '/api/dashboard?tz=Europe/Amsterdam');
    assert.equal(dash.data.inboxCount, 0);
    const store = await srv.readStore(); // persisted when the tz was remembered
    assert.deepEqual(store.thoughts, []);
    // The start-up catch-up froze the one closed month with data (the legacy task's creation month)
    assert.deepEqual(store.monthlySummaries.map((m: any) => [m.month, m.timeZone]), [['2024-05', 'UTC']]);
    assert.equal(store.settings.timeZone, 'Europe/Amsterdam');
    assert.equal(store.projects[0].id, 'p-legacy');
  } finally {
    await srv.close();
  }
});
