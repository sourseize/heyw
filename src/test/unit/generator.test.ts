import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { generateDataset, DEFAULT_SEED, PROFILE_MONTHS_BACK, resolveAnchor } from '../../tools/testdata/generator.js';
import { todayInZone } from '../../db/time.js';

/** The goldens are pinned to this anchor so they never move with the calendar. */
const ANCHOR = '2025-03-31';
const gen = (extra: Record<string, unknown> = {}) => generateDataset({ anchor: ANCHOR, tz: 'UTC', ...extra });
import { isTestDataId, Prng, testDataId, TESTDATA_NAMESPACE } from '../../tools/testdata/prng.js';
import { buildReport, datasetHash, renderReportMarkdown } from '../../tools/testdata/report.js';
import { computeMonthlySummary } from '../../db/summary.js';
import { renderMonthlyMarkdown } from '../../db/summary-markdown.js';
import { normaliseSchema } from '../../db/database.js';
import { buildMentionIndex } from '../../db/links.js';

const fixtures = path.join(process.cwd(), 'src', 'test', 'fixtures');

test('generator - same inputs give byte-identical output; the hash is pinned by a golden', () => {
  const a = gen();
  const b = gen();
  assert.deepEqual(a.data, b.data);
  assert.deepEqual(a.manifest, b.manifest);
  assert.equal(JSON.stringify(a.data), JSON.stringify(b.data), 'key order is stable too');

  const pinned = fs.readFileSync(path.join(fixtures, 'dataset.sha256'), 'utf-8').trim();
  assert.equal(datasetHash(a.data), pinned, 'dataset changed — if intentional run: npm run test:update-golden');

  const other = gen({ seed: 7 });
  assert.notEqual(datasetHash(other.data), pinned, 'a different seed gives different data');
  const shifted = gen({ anchor: '2025-04-30' });
  assert.notEqual(datasetHash(shifted.data), pinned, 'a different anchor gives different data');
});

test('generator - every record is namespaced, tagged where possible, and loads as a valid store', () => {
  const { data, manifest } = gen();
  for (const key of ['projects', 'tasks', 'focusSessions', 'dailyLogs', 'notes', 'thoughts', 'links'] as const) {
    assert.ok((data[key] as any[]).length > 0, `${key} populated`);
    for (const r of data[key] as { id: string }[]) assert.ok(isTestDataId(r.id), `${key} id ${r.id} is namespaced`);
    assert.equal(manifest.counts[key], (data[key] as any[]).length);
    assert.deepEqual(manifest.ids[key], (data[key] as { id: string }[]).map(r => r.id));
  }
  for (const t of data.tasks) assert.ok(t.tags.includes('testdata'));
  for (const n of data.notes) assert.ok(n.tags.includes('testdata'));
  assert.equal(data.settings.timeZone, 'UTC');
  assert.equal(data.activeTimer, null);
  assert.deepEqual(data.monthlySummaries, []);
  assert.doesNotThrow(() => normaliseSchema(data));
  assert.equal(manifest.namespace, TESTDATA_NAMESPACE);
  assert.equal(manifest.from, '2024-12-01', 'three full months before March');
  assert.equal(manifest.to, ANCHOR);
  assert.equal(manifest.days, 121);
  assert.equal(manifest.monthsBack, 3);
});

test('generator - internal consistency: task time equals the focus blocks logged against it', () => {
  const { data } = gen();
  const byTask = new Map<string, number>();
  for (const s of data.focusSessions) {
    if (s.type !== 'focus' || !s.taskId) continue;
    byTask.set(s.taskId, (byTask.get(s.taskId) || 0) + s.durationMinutes);
  }
  for (const t of data.tasks) assert.equal(t.actualMinutes, byTask.get(t.id) || 0, `actualMinutes of "${t.title}"`);

  for (const s of data.focusSessions) {
    assert.ok(s.timestamp >= '2024-12-01T00:00:00.000Z' && s.timestamp <= '2025-03-31T23:59:59.999Z', 'within range');
    if (s.taskId) assert.ok(data.tasks.some(t => t.id === s.taskId), 'sessions point at real tasks');
    if (s.completed) assert.equal(s.durationMinutes, s.plannedMinutes);
    else assert.ok(s.durationMinutes < (s.plannedMinutes || 0));
  }
  for (const t of data.tasks) {
    if (t.status === 'done') assert.ok(t.completedAt && t.completedAt >= t.createdAt, 'done tasks complete after creation');
    else assert.equal(t.completedAt, undefined);
    if (t.projectId) assert.ok(data.projects.some(p => p.id === t.projectId));
  }
  for (const th of data.thoughts) {
    if (th.status === 'converted') assert.ok(th.taskId && data.tasks.some(t => t.id === th.taskId), 'converted thoughts link to a generated task');
    else assert.equal(th.taskId, undefined);
    if (th.context?.taskId) assert.ok(data.tasks.some(t => t.id === th.context!.taskId));
  }
  const dates = new Set(data.dailyLogs.map(l => l.date));
  assert.equal(dates.size, data.dailyLogs.length, 'one journal entry per day');
});

test('generator - the edge cases are present and found by the spot checks', () => {
  const { data, manifest } = gen();
  const sc = manifest.spotChecks;
  const over = data.tasks.find(t => t.id === sc.overEstimateTaskId)!;
  assert.ok(over && over.actualMinutes > (over.estimatedMinutes || 0), 'a task over its estimate');
  assert.equal(data.tasks.find(t => t.id === sc.noProjectTaskId)!.projectId, undefined);
  assert.ok(data.tasks.find(t => t.id === sc.futureDueTaskId)!.dueDate! > ANCHOR);
  const incomplete = data.focusSessions.find(s => s.id === sc.incompleteSessionId)!;
  assert.equal(incomplete.completed, false);
  assert.ok(incomplete.durationMinutes < incomplete.plannedMinutes!);
  assert.ok(sc.lateNightSessionIds.length > 0);
  for (const id of sc.lateNightSessionIds) assert.match(data.focusSessions.find(s => s.id === id)!.timestamp, /T23:30:00/);
  assert.ok(data.thoughts.find(t => t.id === sc.convertedThoughtId)!.taskId === sc.convertedTaskId);
  assert.ok(data.projects.some(p => p.archived), 'an archived project');
  assert.ok(data.projects.some(p => p.archived && !data.tasks.some(t => t.projectId === p.id)), 'a project without tasks');
  assert.ok(data.focusSessions.some(s => s.type !== 'focus'), 'breaks');
  assert.ok(data.focusSessions.some(s => s.integrity) && data.focusSessions.some(s => s.type === 'focus' && !s.integrity), 'both legacy and signal-bearing blocks');
  assert.ok(data.notes.some(n => n.pinned));
  assert.ok(data.notes.some(n => n.updatedAt !== n.createdAt), 'a note edited after creation');
  assert.ok(data.dailyLogs.some(l => l.retro === ''), 'a journal day with an empty retro');
  for (const status of ['inbox', 'kept', 'converted', 'discarded'] as const) assert.ok(data.thoughts.some(t => t.status === status), `a ${status} thought`);
  assert.equal(sc.emptyMonth, '2024-08');
  assert.equal(computeMonthlySummary(data, sc.emptyMonth, 'UTC').deepWork.sessions, 0);
  assert.equal(monthsWithDataAfter(data, sc.emptyMonth), false);
});

function monthsWithDataAfter(data: any, month: string): boolean {
  const all = [...data.focusSessions.map((s: any) => s.timestamp), ...data.tasks.map((t: any) => t.createdAt), ...data.dailyLogs.map((l: any) => l.date), ...data.thoughts.map((t: any) => t.capturedAt), ...data.notes.map((n: any) => n.createdAt)];
  return all.some((iso: string) => iso.slice(0, 7) === month);
}

test('generator - DATE-CENTRIC: a day\'s records are the same whichever day the dataset is generated on', () => {
  // Generated "as of" 31 March and "as of" 15 April: every record dated in the overlap must match.
  const march = gen({ anchor: '2025-03-31' });
  const april = gen({ anchor: '2025-04-15' });
  assert.equal(april.manifest.from, '2025-01-01', 'the window moved forward one month');

  const overlap = (iso: string) => iso >= '2025-01-01' && iso <= '2025-03-31T23:59:59.999Z';
  const sessionsA = march.data.focusSessions.filter(s => overlap(s.timestamp));
  const sessionsB = april.data.focusSessions.filter(s => overlap(s.timestamp));
  assert.deepEqual(sessionsB, sessionsA, 'focus blocks in January–March are identical');
  assert.deepEqual(april.data.dailyLogs.filter(l => overlap(l.date)), march.data.dailyLogs.filter(l => overlap(l.date)));
  assert.deepEqual(april.data.thoughts.filter(t => overlap(t.capturedAt)), march.data.thoughts.filter(t => overlap(t.capturedAt)));
  assert.deepEqual(april.data.notes.filter(n => overlap(n.createdAt)).map(n => [n.id, n.title, n.createdAt]), march.data.notes.filter(n => overlap(n.createdAt)).map(n => [n.id, n.title, n.createdAt]));

  // Tasks created in the overlap keep their identity; only what the calendar has since revealed
  // (completion after 31 March, blocks logged in April) may differ.
  const fixed = (t: any) => [t.id, t.title, t.projectId, t.createdAt, t.estimatedMinutes, t.priority, t.dueDate, t.description];
  const tasksA = march.data.tasks.filter(t => overlap(t.createdAt)).map(fixed);
  const tasksB = april.data.tasks.filter(t => overlap(t.createdAt)).map(fixed);
  assert.deepEqual(tasksB, tasksA);
  for (const a of march.data.tasks.filter(t => overlap(t.createdAt))) {
    const b = april.data.tasks.find(t => t.id === a.id)!;
    if (a.status === 'done') assert.equal(b.completedAt, a.completedAt, 'a task done by March is done the same way in April');
    assert.ok(b.actualMinutes >= a.actualMinutes, 'April can only add blocks');
  }

  // Even two months later, when January has fallen out of the window, February–March are still identical
  const may = gen({ anchor: '2025-05-20' });
  assert.equal(may.manifest.from, '2025-02-01');
  const febMar = (iso: string) => iso >= '2025-02-01' && iso <= '2025-03-31T23:59:59.999Z';
  assert.deepEqual(may.data.focusSessions.filter(s => febMar(s.timestamp)), march.data.focusSessions.filter(s => febMar(s.timestamp)));
  assert.deepEqual(may.data.dailyLogs.filter(l => febMar(l.date)), march.data.dailyLogs.filter(l => febMar(l.date)));
  assert.deepEqual(may.data.thoughts.filter(t => febMar(t.capturedAt)), march.data.thoughts.filter(t => febMar(t.capturedAt)));

  // Today's data is the same whether generated this morning or tonight: the anchor day is complete either way
  const again = gen({ anchor: '2025-03-31' });
  assert.deepEqual(again.data.focusSessions.filter(s => s.timestamp.startsWith('2025-03-31')), march.data.focusSessions.filter(s => s.timestamp.startsWith('2025-03-31')));
});

test('generator - the month in progress is filled from the 1st to the anchor day only', () => {
  const { data, manifest } = gen({ anchor: '2025-03-10' });
  assert.equal(manifest.from, '2024-12-01');
  assert.equal(manifest.to, '2025-03-10');
  const marchDays = new Set(data.focusSessions.filter(s => s.timestamp.startsWith('2025-03')).map(s => s.timestamp.slice(0, 10)));
  assert.ok([...marchDays].every(d => d <= '2025-03-10'));
  assert.ok(marchDays.has('2025-03-10'), 'the anchor day itself has data');
  assert.ok(!data.tasks.some(t => t.completedAt && t.completedAt > '2025-03-10T23:59:59.999Z'), 'nothing is completed in the future');
  assert.ok(!data.notes.some(n => n.updatedAt > '2025-03-10T23:59:59.999Z'));
});

test('generator - profiles set the months of history; the anchor defaults to today; inputs are validated', () => {
  for (const profile of ['small', 'standard', 'large'] as const) {
    const { manifest, data } = gen({ profile });
    assert.equal(manifest.monthsBack, PROFILE_MONTHS_BACK[profile]);
    assert.equal(manifest.from, `${['2025-03', '2024-12', '2024-03'][['small', 'standard', 'large'].indexOf(profile)]}-01`);
    assert.ok(data.focusSessions.length > 0);
  }
  assert.ok(gen({ profile: 'small' }).data.focusSessions.length < gen({ profile: 'large' }).data.focusSessions.length);
  assert.equal(resolveAnchor(undefined, 'UTC'), todayInZone('UTC'));
  assert.equal(resolveAnchor('today', 'Asia/Tokyo'), todayInZone('Asia/Tokyo'));
  assert.equal(generateDataset({ tz: 'UTC' }).manifest.to, todayInZone('UTC'));
  assert.throws(() => generateDataset({ anchor: 'yesterday' }), /anchor/);
  assert.throws(() => generateDataset({ profile: 'huge' as any }), /profile/);
  assert.equal(gen({ tz: 'Europe/Amsterdam' }).data.settings.timeZone, 'Europe/Amsterdam');
});

test('generator - monthly summaries and markdown match the committed goldens', () => {
  const { data, manifest } = gen();
  const golden = JSON.parse(fs.readFileSync(path.join(fixtures, 'monthly-summary.golden.json'), 'utf-8'));
  assert.equal(golden.seed, DEFAULT_SEED);
  const now = new Date(`${manifest.anchor}T12:00:00.000Z`);
  for (const [month, expected] of Object.entries(golden.months)) {
    const actual = computeMonthlySummary(data, month, 'UTC', { now });
    assert.deepEqual(actual, expected, `summary for ${month} drifted — if intentional run: npm run test:update-golden`);
  }
  // The golden may be checked out with CRLF on some machines; the renderer always emits LF.
  const md = fs.readFileSync(path.join(fixtures, 'monthly-summary.golden.md'), 'utf-8').replace(/\r\n/g, '\n');
  assert.equal(renderMonthlyMarkdown(computeMonthlySummary(data, '2025-03', 'UTC', { now }), { frozen: true }), md);
});

test('generator - connected thinking: every mention and link resolves, ends exist, the report agrees', () => {
  const { data, manifest } = gen();
  const index = buildMentionIndex(data);
  assert.ok(index.edges.length > 0, 'notes and task descriptions mention each other');
  assert.equal(index.unresolved.size, 0, 'a generated [[mention]] never points into the void');
  const noteIds = new Set(data.notes.map(n => n.id));
  const taskIds = new Set(data.tasks.map(t => t.id));
  for (const l of data.links) {
    assert.ok(isTestDataId(l.id));
    assert.equal(l.kind, 'link');
    assert.ok(noteIds.has(l.from.id), 'explicit links start at a kept note');
    assert.ok(l.to.type === 'task' ? taskIds.has(l.to.id) : noteIds.has(l.to.id), 'and end at a kept task or note');
    assert.equal(l.fromLabel, data.notes.find(n => n.id === l.from.id)!.title);
    assert.equal(l.toLabel, (l.to.type === 'task' ? data.tasks.find(t => t.id === l.to.id)! : data.notes.find(n => n.id === l.to.id)!).title);
    assert.ok(l.createdAt >= manifest.from && l.createdAt.slice(0, 10) <= manifest.to, 'links are dated inside the range');
  }
  assert.ok(manifest.spotChecks.mostConnectedNoteId && noteIds.has(manifest.spotChecks.mostConnectedNoteId));
  assert.ok(data.links.some(l => l.to.type === 'note'), 'some links go note → note');
  assert.ok(data.thoughts.some(t => t.status !== 'converted' && t.text.includes('[[note:')), 'some thoughts mention a note');
  assert.ok(data.thoughts.every(t => t.status !== 'converted' || !t.text.includes('[[')), 'converted thoughts keep a clean text (it became the task title)');
  assert.ok(data.notes.length >= 25, `enough notes to make graphs interesting (${data.notes.length})`);
  assert.ok(index.edges.length >= 60, `enough mentions (${index.edges.length})`);
  const r = buildReport(data, manifest, 'UTC');
  assert.equal(r.connections.explicitLinks, data.links.length);
  assert.equal(r.connections.mentionEdges, index.edges.length);
  assert.equal(r.connections.unresolvedMentions, 0);
  assert.ok(r.connections.mostConnected && r.connections.mostConnected.count > 0);
  assert.match(renderReportMarkdown(r), /## Connected thinking/);

  // The small profile has no history and still resolves cleanly; a different month range keeps the same invariant.
  const small = gen({ profile: 'small' });
  assert.equal(buildMentionIndex(small.data).unresolved.size, 0);
});

test('generator - the validation report is consistent with the summaries and is deterministic', () => {
  const { data, manifest } = gen();
  const r1 = buildReport(data, manifest, 'UTC');
  const r2 = buildReport(data, manifest, 'UTC');
  assert.deepEqual(r1, r2);
  assert.deepEqual(r1.months.map(m => m.month), ['2025-03', '2025-02', '2025-01', '2024-12']);
  const now = new Date(`${manifest.anchor}T12:00:00.000Z`);
  for (const m of r1.months) {
    const s = computeMonthlySummary(data, m.month, 'UTC', { now });
    assert.equal(m.deepWorkMinutes, s.deepWork.totalMinutes);
    assert.equal(m.tasksCompleted, s.accomplishments.tasksCompleted);
    assert.equal(m.journalDays, s.reflections.journalDays);
  }
  assert.equal(r1.emptyMonth.deepWorkMinutes, 0);
  assert.equal(r1.dashboard.today, '2025-03-31');
  const anchorDayMinutes = data.focusSessions.filter(s => s.type === 'focus' && s.timestamp.startsWith('2025-03-31')).reduce((a, s) => a + s.durationMinutes, 0);
  assert.equal(r1.dashboard.focusTodayMinutes, anchorDayMinutes, 'anchor day deep work');
  const md = renderReportMarkdown(r1);
  assert.match(md, /dataset-sha256: `[0-9a-f]{64}`/);
  assert.match(md, /\| 2025-03 \(in progress, to day 31\) \| [\d.]+h \(\d+m\) \| \d+ \|/);
  assert.match(md, new RegExp(`Focused today: \\*\\*${anchorDayMinutes}m\\*\\*`));

  // A zone well ahead of UTC buckets late blocks onto the next day, so the anchor-day figure can differ
  const tokyo = buildReport(data, manifest, 'Asia/Tokyo');
  assert.equal(typeof tokyo.dashboard.focusTodayMinutes, 'number');
});

test('prng - reproducible streams and UUID-shaped namespaced ids', () => {
  const a = new Prng(42);
  const b = new Prng(42);
  const seqA = Array.from({ length: 5 }, () => a.int(0, 1000));
  const seqB = Array.from({ length: 5 }, () => b.int(0, 1000));
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, Array.from({ length: 5 }, () => new Prng(43).int(0, 1000)));
  const id = testDataId(1, 'task', 3);
  assert.match(id, /^7e57da7a-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(id, testDataId(1, 'task', 3));
  assert.notEqual(id, testDataId(1, 'task', 4));
  assert.equal(isTestDataId(id), true);
  assert.equal(isTestDataId('3f1c0d4e-1234-4abc-8def-0123456789ab'), false);
  assert.equal(isTestDataId(undefined), false);
});
