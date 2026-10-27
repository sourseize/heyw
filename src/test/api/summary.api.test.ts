import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/testServer.js';
import { db } from '../../db/database.js';
import { startBackgroundJobs } from '../../server/jobs.js';

/** Writes a finished focus block straight into the live store at a given instant. */
async function seedSession(iso: string, minutes: number, extra: Record<string, any> = {}) {
  const s = db.logFocusSession({ durationMinutes: minutes, type: 'focus', completed: true, notes: '', ...extra });
  s.timestamp = iso;
  await db.persist();
  return s;
}

test('summary API - live month page, archive index and markdown download', async () => {
  const srv = await startTestServer();
  try {
    const thisMonth = new Date().toISOString().slice(0, 7);
    await seedSession(`${thisMonth}-05T09:00:00.000Z`, 50);
    await seedSession(`${thisMonth}-05T10:00:00.000Z`, 25);
    const { data: task } = await srv.api('POST', '/api/tasks', { title: 'Done this month', priority: 'high' });
    await srv.api('PUT', `/api/tasks/${task.id}`, { status: 'done' });

    const page = await srv.api('GET', `/api/summary/monthly?month=${thisMonth}&tz=UTC`);
    assert.equal(page.status, 200);
    assert.equal(page.data.current, true);
    assert.equal(page.data.frozen, false);
    assert.equal(page.data.summary.month, thisMonth);
    assert.equal(page.data.summary.deepWork.totalMinutes, 75);
    assert.equal(page.data.summary.accomplishments.tasksCompleted, 1);

    const defaulted = await srv.api('GET', '/api/summary/monthly?tz=UTC');
    assert.equal(defaulted.data.summary.month, thisMonth, 'defaults to the current month');

    assert.equal((await srv.api('GET', '/api/summary/monthly?month=2025-13')).status, 400);
    assert.equal((await srv.api('GET', '/api/summary/monthly?month=march')).status, 400);

    const index = await srv.api('GET', '/api/summary/months?tz=UTC');
    assert.equal(index.status, 200);
    assert.equal(index.data[0].month, thisMonth);
    assert.equal(index.data[0].current, true);
    assert.equal(index.data[0].deepWorkMinutes, 75);

    const md = await fetch(`${srv.baseUrl}/api/summary/monthly/${thisMonth}.md?tz=UTC`);
    assert.equal(md.status, 200);
    assert.match(md.headers.get('content-type') || '', /text\/markdown/);
    assert.equal(md.headers.get('content-disposition'), `attachment; filename="heywork-book-of-work-${thisMonth}.md"`);
    const text = await md.text();
    assert.match(text, /^# Book of Work — /);
    assert.match(text, /\*\*1\.3h\*\* \(75m\)/);
    assert.match(text, /- \[x\] Done this month/);

    assert.equal((await fetch(`${srv.baseUrl}/api/summary/monthly/2025-13.md`)).status, 400);
    assert.equal((await fetch(`${srv.baseUrl}/api/summary/monthly/2025-03.txt`)).status, 404);
  } finally {
    await srv.close();
  }
});

test('summary API - closed months are frozen at start-up and served from the snapshot', async () => {
  const first = await startTestServer();
  const { tmpDir, dataFile } = first;
  try {
    await seedSession('2025-03-10T09:00:00.000Z', 50);
    await seedSession('2025-02-14T09:00:00.000Z', 25);
    await first.api('GET', '/api/dashboard?tz=Europe/Amsterdam'); // the zone the freezer will use
    await first.stop();

    const second = await startTestServer({ tmpDir, dataFile });
    try {
      const store = await second.readStore();
      const months = store.monthlySummaries.map((m: any) => m.month).sort();
      assert.ok(months.includes('2025-03') && months.includes('2025-02'), `start-up catch-up froze ${months}`);
      assert.equal(store.monthlySummaries.find((m: any) => m.month === '2025-03').timeZone, 'Europe/Amsterdam');

      const page = await second.api('GET', '/api/summary/monthly?month=2025-03&tz=UTC');
      assert.equal(page.data.frozen, true);
      assert.ok(page.data.frozenAt);
      assert.equal(page.data.summary.timeZone, 'Europe/Amsterdam', 'the snapshot keeps the zone it was frozen in');
      assert.equal(page.data.summary.deepWork.totalMinutes, 50);

      // Back-filled data does not alter the frozen page…
      await seedSession('2025-03-20T09:00:00.000Z', 30);
      assert.equal((await second.api('GET', '/api/summary/monthly?month=2025-03')).data.summary.deepWork.totalMinutes, 50);
      // …until it is regenerated on demand
      const regen = await second.api('POST', '/api/summary/monthly/2025-03/freeze?tz=Europe/Amsterdam');
      assert.equal(regen.status, 200);
      assert.equal(regen.data.frozen, true);
      assert.equal((await second.api('GET', '/api/summary/monthly?month=2025-03')).data.summary.deepWork.totalMinutes, 80);

      const thisMonth = new Date().toISOString().slice(0, 7);
      assert.equal((await second.api('POST', `/api/summary/monthly/${thisMonth}/freeze?tz=UTC`)).status, 409, 'the live month cannot be frozen');
      assert.equal((await second.api('POST', '/api/summary/monthly/nope/freeze')).status, 400);

      const md = await fetch(`${second.baseUrl}/api/summary/monthly/2025-03.md`);
      assert.match(await md.text(), /frozen \d{4}-\d{2}-\d{2}/);

      const index = (await second.api('GET', '/api/summary/months?tz=UTC')).data;
      const march = index.find((e: any) => e.month === '2025-03');
      assert.equal(march.frozen, true);
      assert.equal(march.deepWorkMinutes, 80);
    } finally {
      await second.stop();
    }
  } finally {
    await first.close();
  }
});

test('summary API - the scheduled freeze fires at 00:00 UTC on the 1st', async () => {
  const srv = await startTestServer({});
  try {
    await seedSession('2025-05-20T09:00:00.000Z', 40);
    // Pretend it is the last second of May, then roll past midnight UTC.
    let clock = new Date('2025-05-31T23:59:59.000Z');
    const jobs = startBackgroundJobs({ enableBackups: false, now: () => clock });
    try {
      assert.equal(jobs.nextFreezeAt()!.toISOString(), '2025-06-01T00:00:00.000Z');
      assert.equal(db.getMonthlySummaryRecord('2025-05'), undefined, 'May is still open');

      clock = new Date('2025-06-01T00:00:00.500Z');
      const frozen = await jobs.freezeMonths(); // what the scheduler invokes at that instant
      assert.ok(frozen.some(f => f.month === '2025-05'), 'May is frozen once it has closed');
      assert.equal((await srv.readStore()).monthlySummaries.some((m: any) => m.month === '2025-05'), true, 'persisted');
    } finally {
      jobs.stop();
    }
  } finally {
    await srv.close();
  }
});
