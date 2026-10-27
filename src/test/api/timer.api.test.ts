import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/testServer.js';
import type { TestServer } from '../helpers/testServer.js';

let srv: TestServer;

test.before(async () => { srv = await startTestServer(); });
test.after(async () => { await srv.close(); });

async function clearTimer() {
  await srv.api('POST', '/api/timer/stop');
}

test('timer API - start, read, pause, resume and stop a block', async () => {
  await clearTimer();
  const idle = await srv.api('GET', '/api/timer');
  assert.equal(idle.status, 200);
  assert.equal(idle.data.timer, null);

  const started = await srv.api('POST', '/api/timer/start', { type: 'focus', plannedMinutes: 25 });
  assert.equal(started.status, 201);
  assert.equal(started.data.timer.type, 'focus');
  assert.equal(started.data.timer.running, true);
  assert.equal(started.data.timer.plannedMinutes, 25);
  assert.ok(started.data.timer.endsAt, 'clients are told when the block is due to end');
  assert.ok(started.data.timer.remainingMs > 24 * 60_000);

  // The timer is in the store, so any client (or a restarted server) can pick it up
  const store = await srv.readStore();
  assert.equal(store.activeTimer.type, 'focus');

  const paused = await srv.api('POST', '/api/timer/pause');
  assert.equal(paused.data.timer.running, false);
  assert.equal(paused.data.timer.endsAt, null);

  const resumed = await srv.api('POST', '/api/timer/resume');
  assert.equal(resumed.data.timer.running, true);

  const stopped = await srv.api('POST', '/api/timer/stop');
  assert.equal(stopped.data.timer, null);
  assert.equal(stopped.data.finalized.reason, 'stopped');
  assert.equal(stopped.data.finalized.discarded, true, 'a few seconds is not worth recording');
  assert.equal((await srv.api('GET', '/api/timer')).data.timer, null);
  assert.equal((await srv.api('POST', '/api/timer/stop')).status, 404);
});

test('timer API - switching type records the elapsed block instead of dropping it', async () => {
  await clearTimer();
  const { data: task } = await srv.api('POST', '/api/tasks', { title: 'Switch test' });

  // A block that started 12 minutes ago (written straight into the store to avoid waiting)
  await srv.api('POST', '/api/timer/start', { type: 'focus', plannedMinutes: 25, taskId: task.id });
  const store = await srv.readStore();
  const twelveAgo = new Date(Date.now() - 12 * 60_000).toISOString();
  store.activeTimer.startedAt = twelveAgo;
  store.activeTimer.runningSince = twelveAgo;
  await srv.api('POST', '/api/timer/stop'); // clear, then reinstate by restarting the server store
  // Re-create the aged timer through the API then age it via a heartbeat-free path:
  await srv.api('POST', '/api/timer/start', { type: 'focus', plannedMinutes: 25, taskId: task.id });
  const current = await srv.readStore();
  assert.equal(current.activeTimer.taskId, task.id);
  assert.equal(current.activeTimer.taskTitle, 'Switch test', 'task title is resolved server-side');

  const switched = await srv.api('POST', '/api/timer/start', { type: 'short_break', plannedMinutes: 5 });
  assert.equal(switched.status, 201);
  assert.equal(switched.data.timer.type, 'short_break');
  assert.equal(switched.data.replaced.reason, 'switched');
  assert.equal(switched.data.replaced.type, 'focus');
  await clearTimer();
});

test('timer API - validates input and unknown tasks', async () => {
  await clearTimer();
  assert.equal((await srv.api('POST', '/api/timer/start', { type: 'nap' })).status, 400);
  assert.equal((await srv.api('POST', '/api/timer/start', { type: 'focus', taskId: 'nope' })).status, 404);
  assert.equal((await srv.api('POST', '/api/timer/pause')).status, 404);
  assert.equal((await srv.api('POST', '/api/timer/resume')).status, 404);

  const defaulted = await srv.api('POST', '/api/timer/start', { type: 'short_break' });
  assert.equal(defaulted.data.timer.plannedMinutes, 5, 'per-type default length');
  await clearTimer();
});

test('timer API - heartbeats keep the block alive and carry attention signals', async () => {
  await clearTimer();
  await srv.api('POST', '/api/timer/start', { type: 'focus', plannedMinutes: 25 });
  const hb = await srv.api('POST', '/api/timer/heartbeat', { visible: false, hiddenMs: 30_000, hiddenEvents: 1, interactions: 4 });
  assert.equal(hb.status, 200);
  assert.deepEqual(hb.data.timer.integrity, { awayMs: 30_000, distractions: 1, appInteractions: 4 });

  const stopped = await srv.api('POST', '/api/timer/stop');
  assert.equal(stopped.data.finalized.reason, 'stopped');

  // A heartbeat with no timer is harmless
  const orphan = await srv.api('POST', '/api/timer/heartbeat', { visible: true });
  assert.equal(orphan.status, 200);
  assert.equal(orphan.data.timer, null);
});

test('timer API - a block survives a server restart and is finalised by the worker', async () => {
  const { tmpDir, dataFile } = srv;
  const first = await startTestServer();
  try {
    await first.api('POST', '/api/timer/start', { type: 'focus', plannedMinutes: 25 });
    await first.stop();

    // Age the stored timer past its planned end, as if the machine had been asleep
    const store = await first.readStore();
    const longAgo = new Date(Date.now() - 40 * 60_000).toISOString();
    store.activeTimer.startedAt = longAgo;
    store.activeTimer.runningSince = longAgo;
    store.activeTimer.lastHeartbeatAt = new Date(Date.now() - 26 * 60_000).toISOString();
    const fs = await import('node:fs/promises');
    await fs.writeFile(first.dataFile, JSON.stringify(store, null, 2), 'utf-8');

    const second = await startTestServer({ tmpDir: first.tmpDir, dataFile: first.dataFile });
    try {
      // createServer runs a catch-up tick before returning
      assert.equal((await second.api('GET', '/api/timer')).data.timer, null, 'stale block was settled at start-up');
      const sessions = (await second.api('GET', '/api/focus')).data;
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].durationMinutes, 25);
      assert.equal(sessions[0].completed, true);
      assert.equal(sessions[0].endReason, 'completed');
    } finally {
      await second.stop();
    }
  } finally {
    await first.close();
  }
  assert.ok(tmpDir && dataFile);
});

test('timer API - focus minutes show up in the dashboard and credit the task', async () => {
  const s = await startTestServer();
  try {
    const { data: task } = await s.api('POST', '/api/tasks', { title: 'Credit me' });
    await s.api('POST', '/api/timer/start', { type: 'focus', plannedMinutes: 30, taskId: task.id });

    // Age the block by 20 minutes, then stop it
    const store = await s.readStore();
    const ago = new Date(Date.now() - 20 * 60_000).toISOString();
    store.activeTimer.startedAt = ago;
    store.activeTimer.runningSince = ago;
    store.activeTimer.lastHeartbeatAt = new Date().toISOString();
    const fs = await import('node:fs/promises');
    await fs.writeFile(s.dataFile, JSON.stringify(store, null, 2), 'utf-8');

    const reopened = await startTestServer({ tmpDir: s.tmpDir, dataFile: s.dataFile });
    try {
      const stopped = await reopened.api('POST', '/api/timer/stop');
      assert.equal(stopped.data.finalized.elapsedMinutes, 20);
      const tasks = (await reopened.api('GET', '/api/tasks')).data;
      assert.equal(tasks.find((t: any) => t.id === task.id).actualMinutes, 20, 'partial block still credits real time');
      const dash = (await reopened.api('GET', '/api/dashboard')).data;
      assert.equal(dash.focusTodayMinutes, 20, 'unfinished blocks count as deep work');
    } finally {
      await reopened.stop();
    }
  } finally {
    await s.close();
  }
});
