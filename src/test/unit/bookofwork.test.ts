import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Database } from '../../db/database.js';
import {
  archiveIndex, currentMonth, freezeClosedMonths, freezeMonth, getSummaryPage, isClosedMonth,
  nextFreezeInstant, nextLocalMonthStart, nextUtcMonthStart,
} from '../../db/bookofwork.js';

async function makeDb() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'heyw-bow-'));
  const db = new Database(path.join(dir, 'db.json'));
  await db.init();
  return { db, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

function seedMarch(db: Database) {
  const s = db.logFocusSession({ durationMinutes: 50, type: 'focus', completed: true, notes: '' });
  s.timestamp = '2025-03-10T09:00:00.000Z';
  const f = db.logFocusSession({ durationMinutes: 25, type: 'focus', completed: true, notes: '' });
  f.timestamp = '2025-02-14T09:00:00.000Z';
}

test('book of work - closed months are frozen once; the current month stays live', async () => {
  const { db, cleanup } = await makeDb();
  try {
    seedMarch(db);
    const now = new Date('2025-04-02T10:00:00.000Z');
    assert.equal(currentMonth('UTC', now), '2025-04');
    assert.equal(isClosedMonth('2025-03', 'UTC', now), true);
    assert.equal(isClosedMonth('2025-04', 'UTC', now), false);

    const frozen = freezeClosedMonths(db, now);
    assert.deepEqual(frozen.map(f => f.month).sort(), ['2025-02', '2025-03'], 'every closed month with data');
    assert.equal(frozen[0].timeZone, 'UTC', 'no client zone seen yet → UTC');

    const again = freezeClosedMonths(db, now);
    assert.equal(again.length, 0, 'already frozen months are left alone');

    // The page for March comes from the snapshot, April is computed live
    const march = getSummaryPage(db, '2025-03', 'UTC', now);
    assert.equal(march.frozen, true);
    assert.equal(march.summary.deepWork.totalMinutes, 50);
    assert.equal(march.frozenAt, now.toISOString());
    const april = getSummaryPage(db, '2025-04', 'UTC', now);
    assert.equal(april.frozen, false);
    assert.equal(april.current, true);

    // Back-filled data does not change a frozen page until it is regenerated
    const late = db.logFocusSession({ durationMinutes: 30, type: 'focus', completed: true, notes: '' });
    late.timestamp = '2025-03-20T09:00:00.000Z';
    assert.equal(getSummaryPage(db, '2025-03', 'UTC', now).summary.deepWork.totalMinutes, 50, 'snapshot is stable');
    freezeMonth(db, '2025-03', 'UTC', now, { force: true });
    assert.equal(getSummaryPage(db, '2025-03', 'UTC', now).summary.deepWork.totalMinutes, 80, 'regenerated on demand');

    // The current month cannot be frozen
    assert.equal(freezeMonth(db, '2025-04', 'UTC', now), null);
  } finally {
    await cleanup();
  }
});

test('book of work - freezing uses the zone the client last reported', async () => {
  const { db, cleanup } = await makeDb();
  try {
    const s = db.logFocusSession({ durationMinutes: 25, type: 'focus', completed: true, notes: '' });
    s.timestamp = '2025-03-31T23:30:00.000Z'; // 1 April in Amsterdam
    db.rememberTimeZone('Europe/Amsterdam');

    const now = new Date('2025-05-01T00:00:00.000Z');
    const frozen = freezeClosedMonths(db, now);
    assert.deepEqual(frozen.map(f => [f.month, f.timeZone]), [['2025-04', 'Europe/Amsterdam']]);
    assert.equal(db.getMonthlySummaryRecord('2025-03'), undefined, 'March has no data in that zone');
  } finally {
    await cleanup();
  }
});

test('book of work - archive index lists frozen months, the live month, and skips empty ones', async () => {
  const { db, cleanup } = await makeDb();
  try {
    seedMarch(db);
    const now = new Date('2025-04-02T10:00:00.000Z');
    freezeClosedMonths(db, now);
    // The welcome seed creates tasks/logs "today" (real clock), which fall in whatever
    // month the test runs in; filter them out to keep this check about March/April.
    const index = archiveIndex(db, 'UTC', now).filter(e => ['2025-04', '2025-03', '2025-02'].includes(e.month));
    assert.deepEqual(index.map(e => [e.month, e.current, e.frozen, e.deepWorkMinutes]), [
      ['2025-04', true, false, 0],
      ['2025-03', false, true, 50],
      ['2025-02', false, true, 25],
    ]);
  } finally {
    await cleanup();
  }
});

test('book of work - the freeze job runs at 00:00 UTC on the 1st, or when the local month turns if later', () => {
  const now = new Date('2025-03-15T12:00:00.000Z');
  assert.equal(nextUtcMonthStart(now).toISOString(), '2025-04-01T00:00:00.000Z');
  // Amsterdam (ahead of UTC) turns first, UTC midnight is what we wait for
  assert.equal(nextFreezeInstant(now, 'Europe/Amsterdam').toISOString(), '2025-03-31T22:00:00.000Z');
  // New York (behind UTC): 00:00 UTC comes first, then the local rollover at 04:00 UTC
  assert.equal(nextFreezeInstant(now, 'America/New_York').toISOString(), '2025-04-01T00:00:00.000Z');
  const afterUtcMidnight = new Date('2025-04-01T00:00:01.000Z');
  assert.equal(nextLocalMonthStart(afterUtcMidnight, 'America/New_York').toISOString().slice(0, 16), '2025-04-01T04:00');
  assert.equal(nextFreezeInstant(afterUtcMidnight, 'America/New_York').toISOString().slice(0, 16), '2025-04-01T04:00');
  assert.equal(nextFreezeInstant(now, 'UTC').toISOString(), '2025-04-01T00:00:00.000Z');
  // December rolls into the next year
  assert.equal(nextUtcMonthStart(new Date('2025-12-31T23:59:59.000Z')).toISOString(), '2026-01-01T00:00:00.000Z');
});
