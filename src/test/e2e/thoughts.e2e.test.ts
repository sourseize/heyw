/**
 * R05 — the whole capture → triage journey over HTTP, including the interaction
 * with focus blocks and the store.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/testServer.js';

test('R05 - capture during a block, then turn one thought into a task, keep one, discard one', async () => {
  const srv = await startTestServer();
  try {
    const { data: task } = await srv.api('POST', '/api/tasks', { title: 'Ship the importer', priority: 'high' });
    await srv.api('POST', '/api/timer/start', { type: 'focus', plannedMinutes: 25, taskId: task.id });

    const texts = ['Check the webhook retries', 'Book the dentist', 'Maybe rename the export button'];
    const captured = [];
    for (const text of texts) {
      const res = await srv.api('POST', '/api/thoughts', {
        text,
        context: { view: 'today', timerRunning: true, timerType: 'focus', taskId: task.id },
      });
      assert.equal(res.status, 201);
      captured.push(res.data);
    }

    // Capturing never disturbs the block
    const timer = (await srv.api('GET', '/api/timer')).data.timer;
    assert.equal(timer.running, true);
    assert.equal(timer.taskId, task.id);

    // Inbox is newest-first and the dashboard nags with the count
    const inbox = (await srv.api('GET', '/api/thoughts?status=inbox')).data;
    assert.deepEqual(inbox.map((t: any) => t.text), [...texts].reverse());
    assert.equal((await srv.api('GET', '/api/dashboard')).data.inboxCount, 3);

    // Triage: one becomes a task, one is kept, one is discarded
    const convert = await srv.api('POST', `/api/thoughts/${captured[0].id}/convert`, { priority: 'urgent' });
    assert.equal(convert.status, 201);
    await srv.api('PUT', `/api/thoughts/${captured[1].id}`, { status: 'kept' });
    await srv.api('PUT', `/api/thoughts/${captured[2].id}`, { status: 'discarded' });

    assert.equal((await srv.api('GET', '/api/thoughts?status=inbox')).data.length, 0);
    assert.equal((await srv.api('GET', '/api/dashboard')).data.inboxCount, 0, 'a clear inbox stops nagging');
    assert.equal((await srv.api('GET', '/api/thoughts?status=kept')).data.length, 1);
    assert.equal((await srv.api('GET', '/api/thoughts?status=discarded')).data.length, 1);
    assert.equal((await srv.api('GET', '/api/thoughts')).data.length, 3, 'nothing was deleted');

    const board = (await srv.api('GET', '/api/tasks')).data;
    assert.ok(board.some((t: any) => t.title === 'Check the webhook retries' && t.priority === 'urgent'));

    await srv.api('POST', '/api/timer/stop');
  } finally {
    await srv.close();
  }
});

test('R05 - thoughts and their links survive a restart', async () => {
  const first = await startTestServer();
  const { tmpDir, dataFile } = first;
  try {
    const { data: thought } = await first.api('POST', '/api/thoughts', { text: 'Survive the restart' });
    const { data: converted } = await first.api('POST', `/api/thoughts/${thought.id}/convert`, {});
    const { data: discarded } = await first.api('POST', '/api/thoughts', { text: 'Out of sight' });
    await first.api('PUT', `/api/thoughts/${discarded.id}`, { status: 'discarded' });
    await first.stop();

    const second = await startTestServer({ tmpDir, dataFile });
    try {
      const all = (await second.api('GET', '/api/thoughts')).data;
      assert.equal(all.length, 2);
      const link = all.find((t: any) => t.id === thought.id);
      assert.equal(link.status, 'converted');
      assert.equal(link.taskId, converted.task.id);
      assert.ok((await second.api('GET', '/api/tasks')).data.some((t: any) => t.id === converted.task.id));
      assert.equal((await second.api('GET', '/api/thoughts?status=discarded')).data.length, 1);
    } finally {
      await second.stop();
    }
  } finally {
    await first.close();
  }
});
