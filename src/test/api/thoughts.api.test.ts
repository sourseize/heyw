import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/testServer.js';
import type { TestServer } from '../helpers/testServer.js';

let srv: TestServer;
test.before(async () => { srv = await startTestServer(); });
test.after(async () => { await srv.close(); });

test('thoughts API - capture, list by status, and triage', async () => {
  const captured = await srv.api('POST', '/api/thoughts', { text: '  Check the webhook retries  ' });
  assert.equal(captured.status, 201);
  assert.equal(captured.data.text, 'Check the webhook retries', 'text is trimmed');
  assert.equal(captured.data.status, 'inbox');

  const inbox = await srv.api('GET', '/api/thoughts?status=inbox');
  assert.equal(inbox.data.length, 1);

  const kept = await srv.api('PUT', `/api/thoughts/${captured.data.id}`, { status: 'kept' });
  assert.equal(kept.data.status, 'kept');
  assert.equal((await srv.api('GET', '/api/thoughts?status=inbox')).data.length, 0);
  assert.equal((await srv.api('GET', '/api/thoughts?status=kept')).data.length, 1);

  const discarded = await srv.api('PUT', `/api/thoughts/${captured.data.id}`, { status: 'discarded' });
  assert.equal(discarded.data.status, 'discarded');
  assert.equal((await srv.api('GET', '/api/thoughts')).data.length, 1, 'still in the store, just hidden');

  const restored = await srv.api('PUT', `/api/thoughts/${captured.data.id}`, { status: 'inbox' });
  assert.equal(restored.data.status, 'inbox');

  assert.equal((await srv.api('PUT', '/api/thoughts/nope', { status: 'kept' })).status, 404);
});

test('thoughts API - capture during a focus block records the context', async () => {
  const { data: task } = await srv.api('POST', '/api/tasks', { title: 'Ship the parser' });
  await srv.api('POST', '/api/timer/start', { type: 'focus', plannedMinutes: 25, taskId: task.id });

  const res = await srv.api('POST', '/api/thoughts', {
    text: 'Ask about the pricing page copy',
    context: { view: 'today', timerRunning: true, timerType: 'focus', taskId: task.id },
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.context.timerRunning, true);
  assert.equal(res.data.context.timerType, 'focus');
  assert.equal(res.data.context.taskTitle, 'Ship the parser', 'the task title is resolved server-side');

  // The block is untouched by capturing
  const timer = (await srv.api('GET', '/api/timer')).data.timer;
  assert.equal(timer.running, true);
  assert.equal(timer.type, 'focus');
  await srv.api('POST', '/api/timer/stop');

  // Rubbish context is dropped rather than trusted
  const junk = await srv.api('POST', '/api/thoughts', {
    text: 'junk context',
    context: { view: 42, timerType: 'nap', taskId: 'does-not-exist' },
  });
  assert.equal(junk.data.context.view, 'unknown');
  assert.equal(junk.data.context.timerType, undefined);
  assert.equal(junk.data.context.taskId, undefined);
});

test('thoughts API - converting makes a task, links it, and refuses a second time', async () => {
  const { data: thought } = await srv.api('POST', '/api/thoughts', { text: 'Refactor the date helpers' });

  const converted = await srv.api('POST', `/api/thoughts/${thought.id}/convert`, { priority: 'high', status: 'backlog' });
  assert.equal(converted.status, 201);
  assert.equal(converted.data.task.title, 'Refactor the date helpers');
  assert.equal(converted.data.task.priority, 'high');
  assert.equal(converted.data.task.status, 'backlog');
  assert.equal(converted.data.thought.status, 'converted');
  assert.equal(converted.data.thought.taskId, converted.data.task.id);

  const onBoard = (await srv.api('GET', '/api/tasks')).data.find((t: any) => t.id === converted.data.task.id);
  assert.ok(onBoard, 'the task is on the board');

  const again = await srv.api('POST', `/api/thoughts/${thought.id}/convert`, {});
  assert.equal(again.status, 409);
  assert.equal(again.data.taskId, converted.data.task.id);

  assert.equal((await srv.api('POST', '/api/thoughts/nope/convert', {})).status, 404);
  assert.equal((await srv.api('GET', '/api/tasks')).data.filter((t: any) => t.title === 'Refactor the date helpers').length, 1,
    'exactly one task, no duplicates');
});

test('thoughts API - validates input', async () => {
  assert.equal((await srv.api('POST', '/api/thoughts', { text: '   ' })).status, 400);
  assert.equal((await srv.api('POST', '/api/thoughts', {})).status, 400);
  assert.equal((await srv.api('POST', '/api/thoughts', { text: 'x'.repeat(501) })).status, 400);
  assert.equal((await srv.api('GET', '/api/thoughts?status=bogus')).status, 400);

  const { data: t } = await srv.api('POST', '/api/thoughts', { text: 'valid' });
  assert.equal((await srv.api('PUT', `/api/thoughts/${t.id}`, { status: 'bogus' })).status, 400);
  assert.equal((await srv.api('PUT', `/api/thoughts/${t.id}`, { text: '' })).status, 400);

  const sneaky = await srv.api('PUT', `/api/thoughts/${t.id}`, { id: 'hijack', capturedAt: '1999-01-01T00:00:00.000Z', text: 'edited' });
  assert.equal(sneaky.data.id, t.id);
  assert.equal(sneaky.data.capturedAt, t.capturedAt);
  assert.equal(sneaky.data.text, 'edited');
});

test('thoughts API - the dashboard exposes the waiting count', async () => {
  const s = await startTestServer();
  try {
    assert.equal((await s.api('GET', '/api/dashboard')).data.inboxCount, 0);
    await s.api('POST', '/api/thoughts', { text: 'one' });
    await s.api('POST', '/api/thoughts', { text: 'two' });
    assert.equal((await s.api('GET', '/api/dashboard')).data.inboxCount, 2);
  } finally {
    await s.close();
  }
});
