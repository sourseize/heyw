import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySchema } from '../../db/database.js';
import type { DatabaseSchema, FocusSession, Task } from '../../db/database.js';
import { computeMonthlySummary, monthHasData, monthsWithData, weekBuckets } from '../../db/summary.js';
import { renderMonthlyMarkdown, monthTitle } from '../../db/summary-markdown.js';

/** A small, hand-checkable March 2025 in UTC. */
function fixture(): DatabaseSchema {
  const d = emptySchema();
  d.projects.push(
    { id: 'p-app', name: 'App', color: '#000', description: '', archived: false, createdAt: '2025-01-01T00:00:00.000Z' },
    { id: 'p-writing', name: 'Writing', color: '#111', description: '', archived: false, createdAt: '2025-01-01T00:00:00.000Z' },
  );
  const task = (id: string, title: string, extra: Partial<Task> = {}): Task => ({
    id, title, description: '', status: 'todo', priority: 'medium', actualMinutes: 0, tags: [], order: 0,
    createdAt: '2025-03-01T09:00:00.000Z', ...extra,
  });
  d.tasks.push(
    task('t1', 'Ship parser', { projectId: 'p-app', status: 'done', priority: 'high', completedAt: '2025-03-04T16:00:00.000Z', estimatedMinutes: 60, actualMinutes: 75 }),
    task('t2', 'Write chapter 3', { projectId: 'p-writing', status: 'done', priority: 'medium', completedAt: '2025-03-12T10:00:00.000Z', estimatedMinutes: 120, actualMinutes: 90 }),
    task('t3', 'Fix flaky test', { projectId: 'p-app', status: 'done', priority: 'urgent', completedAt: '2025-03-31T23:30:00.000Z', estimatedMinutes: 30, actualMinutes: 30 }),
    task('t4', 'Open item', { projectId: 'p-app', status: 'in_progress' }),
    task('t5', 'Done in April', { status: 'done', completedAt: '2025-04-01T00:10:00.000Z', createdAt: '2025-03-20T00:00:00.000Z' }),
  );
  const session = (ts: string, minutes: number, extra: Partial<FocusSession> = {}): FocusSession => ({
    id: `s-${ts}`, durationMinutes: minutes, type: 'focus', completed: true, timestamp: ts, ...extra,
  });
  d.focusSessions.push(
    session('2025-03-03T09:00:00.000Z', 25, { taskId: 't1', integrity: { awayMs: 0, distractions: 0, appInteractions: 0 }, endReason: 'completed' }),
    session('2025-03-03T10:00:00.000Z', 50, { taskId: 't1', integrity: { awayMs: 120000, distractions: 2, appInteractions: 5 }, endReason: 'completed' }),
    session('2025-03-04T09:00:00.000Z', 20, { taskId: 't2', completed: false, endReason: 'switched' }),
    session('2025-03-05T09:00:00.000Z', 25, {}),
    session('2025-03-12T09:00:00.000Z', 45, { taskId: 't2', endReason: 'stopped', completed: false }),
    session('2025-03-31T23:30:00.000Z', 25, { taskId: 't3', endReason: 'completed' }),
    session('2025-03-10T09:00:00.000Z', 5, { type: 'short_break' }),
    session('2025-03-10T12:00:00.000Z', 0, { completed: false, endReason: 'stopped' }), // zero-minute noise must not count
    session('2025-02-28T23:00:00.000Z', 25, {}), // previous month
  );
  d.dailyLogs.push(
    { id: 'l1', date: '2025-03-03', intentions: ['Ship it'], retro: 'Good day', energyRating: 4, focusRating: 5, notes: '', updatedAt: '' },
    { id: 'l2', date: '2025-03-12', intentions: [], retro: '', energyRating: 2, focusRating: 3, notes: '', updatedAt: '' },
    { id: 'l3', date: '2025-02-27', intentions: [], retro: 'Feb', energyRating: 5, focusRating: 5, notes: '', updatedAt: '' },
  );
  d.thoughts.push(
    { id: 'th1', text: 'a', status: 'converted', capturedAt: '2025-03-03T09:10:00.000Z', context: { view: 'today', timerRunning: true, timerType: 'focus' } },
    { id: 'th2', text: 'b', status: 'kept', capturedAt: '2025-03-04T09:10:00.000Z' },
    { id: 'th3', text: 'c', status: 'discarded', capturedAt: '2025-03-05T09:10:00.000Z' },
    { id: 'th4', text: 'd', status: 'inbox', capturedAt: '2025-03-06T09:10:00.000Z', context: { view: 'board', timerRunning: false } },
  );
  d.notes.push(
    { id: 'n1', title: 'New', content: '', tags: [], pinned: false, createdAt: '2025-03-02T00:00:00.000Z', updatedAt: '2025-03-02T00:00:00.000Z' },
    { id: 'n2', title: 'Old but edited', content: '', tags: [], pinned: false, createdAt: '2024-12-01T00:00:00.000Z', updatedAt: '2025-03-09T00:00:00.000Z' },
  );
  return d;
}

const NOW = new Date('2025-04-15T12:00:00.000Z');

test('summary - deep work totals, streaks, weeks and projects for a closed month', () => {
  const s = computeMonthlySummary(fixture(), '2025-03', 'UTC', { now: NOW });
  assert.equal(s.from, '2025-03-01');
  assert.equal(s.to, '2025-03-31');
  assert.equal(s.daysInMonth, 31);
  assert.equal(s.daysElapsed, 31);

  assert.equal(s.deepWork.totalMinutes, 25 + 50 + 20 + 25 + 45 + 25);
  assert.equal(s.deepWork.totalHours, 3.2);
  assert.equal(s.deepWork.sessions, 6, 'zero-minute and break sessions are not deep work');
  assert.equal(s.deepWork.completedSessions, 4);
  assert.equal(s.deepWork.avgSessionMinutes, 32);
  assert.equal(s.deepWork.activeDays, 5);
  assert.equal(s.deepWork.longestStreakDays, 3, '3rd, 4th, 5th');
  assert.deepEqual(s.deepWork.bestDay, { date: '2025-03-03', minutes: 75 });
  assert.equal(s.deepWork.breakMinutes, 5);

  assert.deepEqual(s.deepWork.byWeek.map(w => [w.weekStart, w.weekEnd, w.minutes, w.sessions]), [
    ['2025-03-01', '2025-03-02', 0, 0],
    ['2025-03-03', '2025-03-09', 120, 4],
    ['2025-03-10', '2025-03-16', 45, 1],
    ['2025-03-17', '2025-03-23', 0, 0],
    ['2025-03-24', '2025-03-30', 0, 0],
    ['2025-03-31', '2025-03-31', 25, 1],
  ]);

  assert.deepEqual(s.deepWork.byProject.map(p => [p.projectName, p.minutes, p.sessions]), [
    ['App', 100, 3],
    ['Writing', 65, 2],
    ['No project', 25, 1],
  ]);
});

test('summary - flow integrity and endings', () => {
  const s = computeMonthlySummary(fixture(), '2025-03', 'UTC', { now: NOW });
  assert.equal(s.flow.sessionsWithSignals, 2);
  assert.equal(s.flow.uninterruptedSessions, 1);
  assert.equal(s.flow.awayMinutes, 2);
  assert.equal(s.flow.distractions, 2);
  assert.equal(s.flow.appInteractions, 5);
  assert.deepEqual(s.flow.endings, { completed: 4, stopped: 1, switched: 1, abandoned: 0, unknown: 0 });
});

test('summary - accomplishments grouped by project with estimation accuracy', () => {
  const s = computeMonthlySummary(fixture(), '2025-03', 'UTC', { now: NOW });
  assert.equal(s.accomplishments.tasksCompleted, 3, 'the April completion is excluded');
  assert.deepEqual(s.accomplishments.byPriority, { low: 0, medium: 1, high: 1, urgent: 1 });
  assert.deepEqual(s.accomplishments.byProject.map(p => [p.projectName, p.tasks.map(t => t.title)]), [
    ['App', ['Ship parser', 'Fix flaky test']],
    ['Writing', ['Write chapter 3']],
  ]);
  assert.deepEqual(s.accomplishments.estimationAccuracy, { estimated: 210, actual: 195, ratio: 0.9 });
  assert.equal(s.accomplishments.tasksCreated, 5);
  assert.equal(s.accomplishments.tasksStillOpen, 1);
});

test('summary - reflections, thoughts and notes', () => {
  const s = computeMonthlySummary(fixture(), '2025-03', 'UTC', { now: NOW });
  assert.equal(s.reflections.journalDays, 2);
  assert.equal(s.reflections.avgEnergy, 3);
  assert.equal(s.reflections.avgFocus, 4);
  assert.equal(s.reflections.entries[0].retro, 'Good day');
  const w2 = s.reflections.ratingsByWeek.find(w => w.weekStart === '2025-03-03')!;
  assert.deepEqual([w2.days, w2.energy, w2.focus], [1, 4, 5]);
  const w1 = s.reflections.ratingsByWeek[0];
  assert.deepEqual([w1.days, w1.energy, w1.focus], [0, null, null]);

  assert.deepEqual(s.thoughts, { captured: 4, converted: 1, kept: 1, discarded: 1, pendingInbox: 1, capturedDuringFocus: 1 });
  assert.deepEqual(s.notes, { created: 1, updated: 1 });
});

test('summary - time zone moves late-night work to the next day/month', () => {
  const utc = computeMonthlySummary(fixture(), '2025-03', 'UTC', { now: NOW });
  const ams = computeMonthlySummary(fixture(), '2025-03', 'Europe/Amsterdam', { now: NOW });
  const amsApril = computeMonthlySummary(fixture(), '2025-04', 'Europe/Amsterdam', { now: NOW });

  // 2025-03-31T23:30Z is 1 April 01:30 in Amsterdam; 2025-02-28T23:00Z is 1 March 00:00
  assert.equal(utc.deepWork.totalMinutes, 190);
  assert.equal(ams.deepWork.totalMinutes, 190 - 25 + 25);
  assert.equal(amsApril.deepWork.totalMinutes, 25);
  assert.equal(ams.accomplishments.tasksCompleted, 2, 'the 23:30Z completion belongs to April locally');
  assert.equal(amsApril.accomplishments.tasksCompleted, 2);
  assert.equal(ams.timeZone, 'Europe/Amsterdam');
});

test('summary - an empty month is all zeros and is not "data"', () => {
  const s = computeMonthlySummary(fixture(), '2024-11', 'UTC', { now: NOW });
  assert.equal(s.deepWork.sessions, 0);
  assert.equal(s.deepWork.bestDay, null);
  assert.equal(s.accomplishments.tasksCompleted, 0);
  assert.equal(s.reflections.avgEnergy, null);
  assert.equal(s.accomplishments.estimationAccuracy.ratio, null);
  assert.equal(monthHasData(s), false);
  assert.equal(s.deepWork.byWeek.length, 5);
  assert.throws(() => computeMonthlySummary(fixture(), '2025-13', 'UTC'));
});

test('summary - the month in progress reports days elapsed', () => {
  const s = computeMonthlySummary(fixture(), '2025-04', 'UTC', { now: NOW });
  assert.equal(s.daysElapsed, 15);
  const future = computeMonthlySummary(fixture(), '2025-06', 'UTC', { now: NOW });
  assert.equal(future.daysElapsed, 0);
});

test('summary - deterministic: identical input gives identical output, including markdown', () => {
  const a = computeMonthlySummary(fixture(), '2025-03', 'UTC', { now: NOW });
  const b = computeMonthlySummary(fixture(), '2025-03', 'UTC', { now: NOW });
  assert.deepEqual(a, b);
  assert.equal(renderMonthlyMarkdown(a), renderMonthlyMarkdown(b));
});

test('summary - months with data are listed newest first', () => {
  assert.deepEqual(monthsWithData(fixture(), 'UTC'), ['2025-04', '2025-03', '2025-02', '2024-12']);
});

test('summary - week buckets are Monday-start and clipped to the month', () => {
  assert.deepEqual(weekBuckets('2025-02').map(b => `${b.weekStart}..${b.weekEnd}`), [
    '2025-02-01..2025-02-02', '2025-02-03..2025-02-09', '2025-02-10..2025-02-16', '2025-02-17..2025-02-23', '2025-02-24..2025-02-28',
  ]);
  assert.equal(weekBuckets('2025-09')[0].weekStart, '2025-09-01'); // a Monday
  assert.equal(weekBuckets('2025-09')[0].weekEnd, '2025-09-07');
});

test('markdown - renders every section with the figures and escapes table cells', () => {
  const d = fixture();
  d.projects[0].name = 'App | Core';
  const s = computeMonthlySummary(d, '2025-03', 'UTC', { now: NOW });
  const md = renderMonthlyMarkdown(s, { frozen: true });
  assert.equal(monthTitle('2025-03'), 'March 2025');
  assert.match(md, /^# Book of Work — March 2025\n/);
  assert.match(md, /frozen 2025-04-15/);
  assert.match(md, /\| \*\*3\.2h\*\* \(190m\) \| 6 \| 5 \/ 31 \| 3d \| 3 \| 2 \| 3 \| 4 \|/);
  assert.match(md, /## Deep work/);
  assert.match(md, /\| App \\\| Core \| 1\.7h \| 3 \| 53% \|/);
  assert.match(md, /## Flow integrity/);
  assert.match(md, /1 of 2 blocks ran with no tab-switching/);
  assert.match(md, /## Accomplishments/);
  assert.match(md, /- \[x\] Ship parser — 2025-03-04, high, 75m \/ 60m/);
  assert.match(md, /## Reflections/);
  assert.match(md, /### 2025-03-03 · ⚡4 🎯5/);
  assert.match(md, /> Good day/);
  assert.match(md, /## Thoughts parked/);
  assert.match(md, /4 captured \(1 during deep focus\) → 1 became tasks · 1 kept · 1 discarded · 1 still waiting/);
  assert.match(md, /- 1 created · 1 updated/);

  const empty = renderMonthlyMarkdown(computeMonthlySummary(d, '2024-11', 'UTC', { now: NOW }));
  assert.match(empty, /_No focus blocks this month._/);
  assert.match(empty, /_No tasks completed this month._/);
  assert.match(empty, /_No journal entries this month._/);
});
