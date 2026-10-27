/**
 * R08/R09 — the test-data CLI as a user runs it (child process), against temp stores:
 * deterministic output, fresh and merge round-trips, and the safety refusals.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startTestServer } from '../helpers/testServer.js';

const CLI = path.join(process.cwd(), 'dist', 'tools', 'testdata', 'cli.js');
/** The goldens are pinned to a fixed anchor; the CLI itself defaults to today. */
const ANCHOR = ['--anchor', '2025-03-31'];

function run(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args, ...(args[0] === 'status' || args[0] === 'clean' ? [] : ANCHOR)], { encoding: 'utf-8', env: { ...process.env, ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

async function tmp() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'heyw-testdata-'));
  return { dir, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

const sha = async (file: string) => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');

test('R08 - two fresh seeds are byte-identical, and the report matches the committed hash', async () => {
  const t = await tmp();
  try {
    const a = path.join(t.dir, 'a.json');
    const b = path.join(t.dir, 'b.json');
    assert.equal(run(['seed', '--file', a, '--tz', 'UTC']).code, 0);
    assert.equal(run(['seed', '--file', b, '--tz', 'UTC']).code, 0);
    assert.equal(await sha(a), await sha(b));

    const report = run(['report', '--tz', 'UTC', '--json']);
    assert.equal(report.code, 0);
    const json = JSON.parse(report.out);
    const pinned = (await fs.readFile(path.join(process.cwd(), 'src', 'test', 'fixtures', 'dataset.sha256'), 'utf-8')).trim();
    assert.equal(json.datasetSha256, pinned);
    assert.equal(json.months[0].month, '2025-03');

    const md = run(['report', '--tz', 'UTC']);
    assert.match(md.out, /^# HeyWork test data — seed 20240101 · as of 2025-03-31 · profile standard · tz UTC/);
    assert.match(md.out, /\| 2025-03 \(in progress, to day 31\) \| [\d.]+h \(\d+m\) \|/);
    assert.match(md.out, /\| 2024-12 \| [\d.]+h/);

    // The seeded store really is what the report describes (manifest + counts)
    const manifest = JSON.parse(await fs.readFile(path.join(t.dir, 'a.testdata-manifest.json'), 'utf-8'));
    assert.equal(manifest.mode, 'fresh');
    assert.deepEqual(manifest.counts, json.counts);
    assert.equal((await fs.stat(a)).mode & 0o777, process.platform === 'win32' ? (await fs.stat(a)).mode & 0o777 : 0o600);
  } finally {
    await t.cleanup();
  }
});

test('R09 - fresh mode: the server serves the dataset, the archive agrees with the report, clean removes everything it made', async () => {
  const t = await tmp();
  try {
    const file = path.join(t.dir, 'test-database.json');
    assert.equal(run(['seed', '--file', file, '--tz', 'UTC']).code, 0);
    assert.equal(run(['seed', '--file', file, '--tz', 'UTC']).code, 1, 'refuses to overwrite without --force');
    assert.equal(run(['seed', '--file', file, '--tz', 'UTC', '--force']).code, 0);

    const expected = JSON.parse(run(['report', '--tz', 'UTC', '--json']).out);
    const srv = await startTestServer({ tmpDir: t.dir, dataFile: file });
    try {
      const dash = (await srv.api('GET', '/api/dashboard?tz=UTC')).data;
      assert.equal(dash.inboxCount, expected.dashboard.inboxCount);
      assert.deepEqual(dash.statusCounts, expected.dashboard.statusCounts);
      assert.equal(dash.totalProjects, expected.dashboard.totalProjects);

      const months = (await srv.api('GET', '/api/summary/months?tz=UTC')).data;
      for (const m of expected.months) {
        const entry = months.find((x: any) => x.month === m.month);
        assert.ok(entry, `${m.month} in the archive`);
        assert.equal(entry.frozen, true, 'closed months were frozen at start-up');
        assert.equal(entry.deepWorkMinutes, m.deepWorkMinutes);
        assert.equal(entry.tasksCompleted, m.tasksCompleted);
      }
      const march = (await srv.api('GET', '/api/summary/monthly?month=2025-03&tz=UTC')).data.summary;
      assert.equal(march.deepWork.totalMinutes, expected.months[0].deepWorkMinutes);
      assert.equal(march.reflections.journalDays, expected.months[0].journalDays);
      assert.equal((await srv.api('GET', '/api/tasks')).data.length, expected.counts.tasks);
      assert.equal((await srv.api('GET', '/api/thoughts?status=inbox')).data.length, expected.dashboard.inboxCount);
    } finally {
      await srv.stop();
    }

    const status = run(['status', '--file', file]);
    assert.match(status.out, /Test records present: \d+/);
    assert.match(status.out, /seed 20240101, anchor 2025-03-31, standard, fresh/);

    // The server took a start-up backup named after the test store; clean removes it too
    const backups = await fs.readdir(path.join(t.dir, 'backups'));
    assert.ok(backups.some(n => n.startsWith('test-database-')), `backup of the test store exists: ${backups}`);

    const clean = run(['clean', '--file', file]);
    assert.equal(clean.code, 0, clean.err);
    assert.match(clean.out, /Removed .*test-database\.json and \d+ backup\(s\)/);
    const left = await fs.readdir(t.dir);
    assert.ok(!left.includes('test-database.json'));
    assert.ok(!left.includes('test-database.testdata-manifest.json'));
    assert.deepEqual((await fs.readdir(path.join(t.dir, 'backups'))).filter(n => n.startsWith('test-database-')), []);
    assert.equal(run(['clean', '--file', file]).code, 0, 'second clean is a no-op');
  } finally {
    await t.cleanup();
  }
});

test('R09 - merge mode: round-trip leaves the user store byte-identical, protects journal days, drops polluted snapshots', async () => {
  const t = await tmp();
  try {
    // A "real" store with the user's own records, one of them on a day the generator also writes
    const file = path.join(t.dir, 'database.json');
    const first = await startTestServer({ tmpDir: t.dir, dataFile: file });
    await first.api('POST', '/api/logs', { date: '2025-03-05', intentions: ['mine'], retro: 'my own entry', energyRating: 3, focusRating: 3 });
    const { data: myTask } = await first.api('POST', '/api/tasks', { title: 'My real task' });
    await first.api('POST', '/api/thoughts', { text: 'my own thought' });
    await first.stop();
    const before = JSON.parse(await fs.readFile(file, 'utf-8'));

    const seeded = run(['seed', '--into', file, '--tz', 'UTC']);
    assert.equal(seeded.code, 0, seeded.err);
    assert.match(seeded.out, /Backup taken first: database-.*-pre-seed\.json/);
    assert.match(seeded.out, /Skipped 1 journal day\(s\) you already have: 2025-03-05/);
    assert.equal(run(['seed', '--into', file, '--tz', 'UTC']).code, 1, 'refuses to seed twice');

    const merged = JSON.parse(await fs.readFile(file, 'utf-8'));
    assert.equal(merged.dailyLogs.find((l: any) => l.date === '2025-03-05').retro, 'my own entry', 'user journal day untouched');
    assert.ok(merged.tasks.some((x: any) => x.id === myTask.id));
    assert.ok(merged.tasks.length > before.tasks.length + 40);

    // Run the server: it freezes months that now contain test data, and the user edits nothing
    const second = await startTestServer({ tmpDir: t.dir, dataFile: file });
    const months = (await second.api('GET', '/api/summary/months?tz=UTC')).data.filter((m: any) => m.frozen).map((m: any) => m.month);
    assert.ok(months.includes('2025-03'));
    await second.stop();

    const status = run(['status', '--into', file]);
    assert.match(status.out, /Your records/);

    const clean = run(['clean', '--into', file]);
    assert.equal(clean.code, 0, clean.out + clean.err);
    assert.match(clean.out, /Dropped Book-of-Work snapshot\(s\) frozen while test data was present/);
    assert.match(clean.out, /Verified: your own records are byte-identical to before seeding/);

    const after = JSON.parse(await fs.readFile(file, 'utf-8'));
    for (const key of ['projects', 'tasks', 'focusSessions', 'dailyLogs', 'notes', 'thoughts']) {
      assert.deepEqual(after[key], before[key], `${key} restored exactly`);
    }
    assert.deepEqual(after.monthlySummaries, [], 'polluted snapshots are gone (re-frozen cleanly at next start)');
    assert.equal(run(['clean', '--into', file]).code, 0, 'second clean is a no-op');

    // Refuses a corrupt store rather than guessing
    await fs.writeFile(file, '{"tasks": [ broken', 'utf-8');
    const corrupt = run(['seed', '--into', file, '--tz', 'UTC']);
    assert.equal(corrupt.code, 1);
    assert.match(corrupt.err, /corrupt|refusing/i);
    assert.equal(await fs.readFile(file, 'utf-8'), '{"tasks": [ broken', 'left untouched');
  } finally {
    await t.cleanup();
  }
});

test('R09 - merge mode unlinks user records that pointed at test data', async () => {
  const t = await tmp();
  try {
    const file = path.join(t.dir, 'database.json');
    const srv = await startTestServer({ tmpDir: t.dir, dataFile: file });
    await srv.stop();
    assert.equal(run(['seed', '--into', file, '--tz', 'UTC']).code, 0);

    // While test data is merged, the user attaches a real task to a generated project and logs a block on a generated task
    const again = await startTestServer({ tmpDir: t.dir, dataFile: file });
    const projects = (await again.api('GET', '/api/projects')).data;
    const testProject = projects.find((p: any) => p.id.startsWith('7e57da7a-'));
    const { data: mine } = await again.api('POST', '/api/tasks', { title: 'Mine, in a test project', projectId: testProject.id });
    const testTask = (await again.api('GET', '/api/tasks')).data.find((x: any) => x.id.startsWith('7e57da7a-'));
    await again.api('POST', '/api/focus', { durationMinutes: 25, taskId: testTask.id, taskTitle: testTask.title });
    await again.stop();

    const clean = run(['clean', '--into', file]);
    assert.equal(clean.code, 3, 'exit 3 signals the user changed records while seeded (expected here)');
    assert.match(clean.out, /Unlinked 2 reference\(s\)/);
    const after = JSON.parse(await fs.readFile(file, 'utf-8'));
    const mineAfter = after.tasks.find((x: any) => x.id === mine.id);
    assert.ok(mineAfter, 'the user task survives');
    assert.equal(mineAfter.projectId, undefined, 'its link to the removed project is cleared');
    const block = after.focusSessions.find((s: any) => s.durationMinutes === 25 && !s.id.startsWith('7e57da7a-'));
    assert.ok(block);
    assert.equal(block.taskId, undefined);
    assert.ok(after.tasks.every((x: any) => !x.id.startsWith('7e57da7a-')));
  } finally {
    await t.cleanup();
  }
});
