import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Database } from '../../db/database.js';
import { TimerEngine, normalisePlanned, DEFAULT_PLANNED_MINUTES } from '../../db/timer.js';

/** A controllable clock so timer behaviour can be tested without waiting. */
function clock(startIso: string) {
  let t = Date.parse(startIso);
  return { now: () => t, advance: (ms: number) => (t += ms), set: (iso: string) => (t = Date.parse(iso)) };
}

async function makeDb() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'heyw-timer-'));
  const db = new Database(path.join(dir, 'db.json'));
  await db.init();
  return { db, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

test('timer - runs, reports remaining time, and survives being read back', async () => {
  const { db, cleanup } = await makeDb();
  const c = clock('2025-03-31T09:00:00.000Z');
  try {
    const engine = new TimerEngine(db, { now: c.now });
    assert.equal(engine.view(), null);

    engine.start({ type: 'focus', plannedMinutes: 25 });
    c.advance(5 * 60_000);

    const view = engine.view()!;
    assert.equal(view.running, true);
    assert.equal(view.type, 'focus');
    assert.equal(view.elapsedMs, 5 * 60_000);
    assert.equal(view.remainingMs, 20 * 60_000);
    assert.equal(view.endsAt, '2025-03-31T09:25:00.000Z');
    assert.equal(view.startedAt, '2025-03-31T09:00:00.000Z');

    // The timer is in the store, so a fresh engine (i.e. after a reload) sees it
    const other = new TimerEngine(db, { now: c.now });
    assert.equal(other.view()!.remainingMs, 20 * 60_000);
  } finally {
    await cleanup();
  }
});

test('timer - pause excludes paused time from the elapsed total', async () => {
  const { db, cleanup } = await makeDb();
  const c = clock('2025-03-31T09:00:00.000Z');
  try {
    const engine = new TimerEngine(db, { now: c.now });
    engine.start({ type: 'focus', plannedMinutes: 25 });
    c.advance(10 * 60_000);
    engine.pause();
    assert.equal(engine.view()!.running, false);
    assert.equal(engine.view()!.endsAt, null);

    c.advance(60 * 60_000); // an hour on pause
    assert.equal(engine.view()!.elapsedMs, 10 * 60_000, 'paused time must not count');

    engine.resume();
    c.advance(5 * 60_000);
    assert.equal(engine.view()!.elapsedMs, 15 * 60_000);

    const result = engine.stop()!;
    assert.equal(result.reason, 'stopped');
    assert.equal(result.session!.durationMinutes, 15);
    assert.equal(result.session!.completed, false);
    assert.equal(result.session!.plannedMinutes, 25);
  } finally {
    await cleanup();
  }
});

test('timer - the worker completes a block after the page is closed, crediting the planned length', async () => {
  const { db, cleanup } = await makeDb();
  const c = clock('2025-03-31T09:00:00.000Z');
  try {
    const engine = new TimerEngine(db, { now: c.now, staleAfterMs: 90_000 });
    const task = db.createTask({ title: 'Write the engine', description: '', status: 'in_progress', priority: 'high', tags: [] });
    engine.start({ type: 'focus', plannedMinutes: 25, taskId: task.id, taskTitle: task.title });

    // The page heartbeats for 24 minutes, then the user closes the browser.
    for (let i = 0; i < 24 * 4; i++) {
      c.advance(15_000);
      engine.heartbeat({ visible: true });
    }
    assert.equal(engine.tick(), null, 'not due yet');

    // The worker polls every few seconds, so it notices slightly late — the session
    // must still record exactly the planned 25 minutes.
    c.advance(60_000 + 3_500);
    const result = engine.tick()!;
    assert.equal(result.reason, 'completed');
    assert.equal(result.session!.durationMinutes, 25);
    assert.equal(result.session!.completed, true);
    assert.equal(result.session!.endReason, 'completed');
    assert.equal(result.session!.timestamp, '2025-03-31T09:00:00.000Z', 'timestamp is the block start');
    assert.equal(db.getActiveTimer(), null);
    assert.equal(db.getTask(task.id)!.actualMinutes, 25, 'task credited');
    assert.ok(result.session!.integrity!.unverifiedMs! > 0, 'the silent tail is recorded as unverified');
    assert.equal(engine.tick(), null, 'nothing left to finalize');
  } finally {
    await cleanup();
  }
});

test('timer - switching type finalises the running block instead of discarding it', async () => {
  const { db, cleanup } = await makeDb();
  const c = clock('2025-03-31T09:00:00.000Z');
  try {
    const engine = new TimerEngine(db, { now: c.now });
    const task = db.createTask({ title: 'Deep work', description: '', status: 'in_progress', priority: 'high', tags: [] });
    engine.start({ type: 'focus', plannedMinutes: 25, taskId: task.id, taskTitle: task.title });
    c.advance(12 * 60_000);

    const { timer, replaced } = engine.start({ type: 'short_break', plannedMinutes: 5 });
    assert.equal(replaced!.reason, 'switched');
    assert.equal(replaced!.session!.durationMinutes, 12, 'elapsed focus time is kept');
    assert.equal(replaced!.session!.completed, false);
    assert.equal(replaced!.session!.type, 'focus');
    assert.equal(db.getTask(task.id)!.actualMinutes, 12, 'partial work still credited to the task');
    assert.equal(timer.type, 'short_break');
    assert.equal(engine.view()!.remainingMs, 5 * 60_000);
    assert.equal(db.getFocusSessions().length, 1);
  } finally {
    await cleanup();
  }
});

test('timer - a silent client is abandoned and credited only up to its last heartbeat', async () => {
  const { db, cleanup } = await makeDb();
  const c = clock('2025-03-31T09:00:00.000Z');
  try {
    const engine = new TimerEngine(db, { now: c.now, staleAfterMs: 90_000 });
    engine.start({ type: 'focus', plannedMinutes: 50 });

    for (let i = 0; i < 10; i++) {
      c.advance(60_000);
      engine.heartbeat({ visible: true });
    }
    assert.equal(engine.tick(), null, 'healthy client keeps running');

    c.advance(30 * 60_000); // laptop closed
    const result = engine.tick()!;
    assert.equal(result.reason, 'abandoned');
    assert.equal(result.session!.durationMinutes, 10, 'only the time we had evidence for');
    assert.equal(result.session!.completed, false);
  } finally {
    await cleanup();
  }
});

test('timer - blocks shorter than a minute are dropped rather than logged as noise', async () => {
  const { db, cleanup } = await makeDb();
  const c = clock('2025-03-31T09:00:00.000Z');
  try {
    const engine = new TimerEngine(db, { now: c.now });
    engine.start({ type: 'focus' });
    c.advance(20_000);
    const result = engine.stop()!;
    assert.equal(result.discarded, true);
    assert.equal(result.session, null);
    assert.equal(db.getFocusSessions().length, 0);
    assert.equal(db.getActiveTimer(), null);
  } finally {
    await cleanup();
  }
});

test('timer - attention signals are accumulated and stored on the session', async () => {
  const { db, cleanup } = await makeDb();
  const c = clock('2025-03-31T09:00:00.000Z');
  try {
    const engine = new TimerEngine(db, { now: c.now });
    engine.start({ type: 'focus', plannedMinutes: 25 });
    c.advance(60_000);
    engine.heartbeat({ visible: false, hiddenMs: 45_000, hiddenEvents: 1, interactions: 3 });
    c.advance(60_000);
    engine.heartbeat({ visible: true, hiddenMs: 15_000, hiddenEvents: 1, interactions: 2 });
    c.advance(3 * 60_000);

    const result = engine.stop()!;
    assert.equal(result.session!.integrity!.awayMs, 60_000);
    assert.equal(result.session!.integrity!.distractions, 2);
    assert.equal(result.session!.integrity!.appInteractions, 5);
    assert.equal(result.session!.integrity!.unverifiedMs, 3 * 60_000, 'time since the last heartbeat is flagged');
  } finally {
    await cleanup();
  }
});

test('timer - planned minutes are normalised and defaulted per type', () => {
  assert.equal(normalisePlanned(undefined, 'focus'), DEFAULT_PLANNED_MINUTES.focus);
  assert.equal(normalisePlanned(0, 'short_break'), 5);
  assert.equal(normalisePlanned(-5, 'long_break'), 15);
  assert.equal(normalisePlanned('30' as any, 'focus'), 25);
  assert.equal(normalisePlanned(30, 'focus'), 30);
  assert.equal(normalisePlanned(99999, 'focus'), 480);
});

test('timer - breaks do not credit task time but are still recorded', async () => {
  const { db, cleanup } = await makeDb();
  const c = clock('2025-03-31T09:00:00.000Z');
  try {
    const engine = new TimerEngine(db, { now: c.now });
    const task = db.createTask({ title: 'T', description: '', status: 'todo', priority: 'low', tags: [] });
    engine.start({ type: 'short_break', plannedMinutes: 5, taskId: task.id, taskTitle: 'T' });
    c.advance(5 * 60_000 + 1000);
    const result = engine.tick()!;
    assert.equal(result.session!.type, 'short_break');
    assert.equal(db.getTask(task.id)!.actualMinutes, 0);
  } finally {
    await cleanup();
  }
});

test('timer - trustSilence lets a block finish unattended, still flagging the unverified time', async () => {
  const { db, cleanup } = await makeDb();
  const c = clock('2025-03-31T09:00:00.000Z');
  try {
    const engine = new TimerEngine(db, { now: c.now, staleAfterMs: 90_000, trustSilence: true });
    engine.start({ type: 'focus', plannedMinutes: 25 });

    c.advance(10 * 60_000);
    assert.equal(engine.tick(), null, 'silence does not end the block under this policy');

    c.advance(16 * 60_000);
    const result = engine.tick()!;
    assert.equal(result.reason, 'completed');
    assert.equal(result.session!.durationMinutes, 25);
    assert.equal(result.session!.integrity!.unverifiedMs, 25 * 60_000);
  } finally {
    await cleanup();
  }
});

test('timer - a paused timer left overnight is cleaned up by the worker', async () => {
  const { db, cleanup } = await makeDb();
  const c = clock('2025-03-31T09:00:00.000Z');
  try {
    const engine = new TimerEngine(db, { now: c.now });
    engine.start({ type: 'focus', plannedMinutes: 25 });
    c.advance(8 * 60_000);
    engine.pause();

    c.advance(2 * 60 * 60_000);
    assert.equal(engine.tick(), null, 'a pause of a couple of hours is fine');

    c.advance(23 * 60 * 60_000);
    const result = engine.tick()!;
    assert.equal(result.reason, 'abandoned');
    assert.equal(result.session!.durationMinutes, 8, 'the work done before pausing is kept');
    assert.equal(db.getActiveTimer(), null);
  } finally {
    await cleanup();
  }
});
