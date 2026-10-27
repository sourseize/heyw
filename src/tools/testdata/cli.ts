#!/usr/bin/env node
/**
 * Test-data CLI.
 *
 *   npm run testdata -- seed                       # standalone store: data/test-database.json
 *   npm run testdata -- seed --into data/database.json   # merge into an existing store
 *   npm run testdata -- clean [--into <file>]
 *   npm run testdata -- status [--into <file>]
 *   npm run testdata -- report [--json]
 *
 * Options: --seed <int> --anchor <YYYY-MM-DD|today> --profile small|standard|large
 *          --tz <IANA> --file <path> --force --json
 *
 * Fresh mode (default) never opens your real store. Merge mode backs the target
 * up first, refuses to seed twice, skips journal days you already have, and on
 * clean removes exactly the namespaced records, unlinks anything pointing at
 * them, drops Book-of-Work snapshots generated while test data was present, and
 * verifies your own records are byte-identical to before.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseFileError, DEFAULT_DATA_FILE, emptySchema, jsonCodec, normaliseSchema } from '../../db/database.js';
import type { DatabaseSchema } from '../../db/database.js';
import { BackupManager } from '../../db/backup.js';
import { resolveTimeZone } from '../../db/time.js';
import { DEFAULT_SEED, generateDataset, resolveAnchor } from './generator.js';
import type { Manifest, Profile } from './generator.js';
import { isTestDataId } from './prng.js';
import { buildReport, renderReportMarkdown } from './report.js';

interface Args {
  command: string;
  seed: number;
  anchor: string;
  profile: Profile;
  tz: string;
  file: string | null;
  into: string | null;
  force: boolean;
  json: boolean;
}

const ARRAY_COLLECTIONS = ['projects', 'tasks', 'focusSessions', 'dailyLogs', 'notes', 'thoughts'] as const;

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: 'report',
    seed: DEFAULT_SEED,
    anchor: 'today',
    profile: 'standard',
    tz: systemTimeZone(),
    file: null,
    into: null,
    force: false,
    json: false,
  };
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith('--')) args.command = rest.shift()!;
  while (rest.length) {
    const a = rest.shift()!;
    const value = () => {
      const v = rest.shift();
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    switch (a) {
      case '--seed': args.seed = parseInt(value(), 10); break;
      case '--anchor': args.anchor = value(); break;
      case '--profile': args.profile = value() as Profile; break;
      case '--tz': args.tz = value(); break;
      case '--file': args.file = value(); break;
      case '--into': args.into = value(); break;
      case '--force': args.force = true; break;
      case '--json': args.json = true; break;
      case '--help': case '-h': args.command = 'help'; break;
      default: throw new Error(`Unknown option ${a}`);
    }
  }
  if (!Number.isFinite(args.seed)) throw new Error('--seed must be an integer');
  args.tz = resolveTimeZone(args.tz);
  args.anchor = resolveAnchor(args.anchor, args.tz);
  return args;
}

function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export const DEFAULT_FRESH_FILE = () => path.join(path.dirname(DEFAULT_DATA_FILE()), 'test-database.json');

function manifestPath(file: string): string {
  return file.replace(/\.json$/, '') + '.testdata-manifest.json';
}

/**
 * Hash of the user's own records (everything that is not test data). App state
 * such as `settings` and the transient `activeTimer` is deliberately excluded:
 * the server touches those on its own and that is not a user edit.
 */
function userRecordsHash(data: DatabaseSchema): string {
  const user: Record<string, unknown> = {};
  for (const key of ARRAY_COLLECTIONS) user[key] = (data[key] as { id: string }[]).filter(r => !isTestDataId(r.id));
  return crypto.createHash('sha256').update(JSON.stringify(user)).digest('hex');
}

function countTestRecords(data: DatabaseSchema): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of ARRAY_COLLECTIONS) counts[key] = (data[key] as { id: string }[]).filter(r => isTestDataId(r.id)).length;
  return counts;
}

async function readStore(file: string): Promise<DatabaseSchema> {
  const raw = await fs.readFile(file);
  let parsed: unknown;
  try {
    parsed = jsonCodec.decode(raw);
  } catch (err: any) {
    throw new DatabaseFileError(`Store is corrupt or not JSON (${err?.message || err}) — refusing to touch it`, file);
  }
  return normaliseSchema(parsed, file);
}

async function writeStore(file: string, data: DatabaseSchema): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, jsonCodec.encode(data), { mode: 0o600 });
  await fs.rename(tmp, file);
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.stat(file);
    return true;
  } catch {
    return false;
  }
}

interface StoredManifest extends Manifest {
  mode: 'fresh' | 'into';
  target: string;
  skippedJournalDays: string[];
  preSeed: { userRecordsHash: string; monthlySummaryMonths: string[]; backup: string | null } | null;
}

// ── Commands ──

export async function seed(args: Args, log = console.log): Promise<StoredManifest> {
  const { data, manifest } = generateDataset({ seed: args.seed, anchor: args.anchor, profile: args.profile, tz: args.tz });

  if (!args.into) {
    const target = path.resolve(args.file || DEFAULT_FRESH_FILE());
    if ((await exists(target)) && !args.force) {
      throw new Error(`${target} already exists. Run "clean" first, or pass --force to overwrite it.`);
    }
    await writeStore(target, data);
    const stored: StoredManifest = { ...manifest, mode: 'fresh', target, skippedJournalDays: [], preSeed: null };
    await fs.writeFile(manifestPath(target), JSON.stringify(stored, null, 2), { mode: 0o600 });
    log(`✔ Wrote standalone test store: ${target}`);
    log(`  Run the app against it with:  HEYW_DATA_FILE=${path.relative(process.cwd(), target)} npm start   (or: npm run start:test)`);
    return stored;
  }

  const target = path.resolve(args.into);
  if (!(await exists(target))) throw new Error(`${target} does not exist; use fresh mode (no --into) to create a standalone store.`);
  let store = await readStore(target);
  const already = countTestRecords(store);
  if (Object.values(already).some(n => n > 0)) {
    if (!args.force) throw new Error(`${target} already contains test data (${JSON.stringify(already)}). Run "clean --into" first, or pass --force to re-seed.`);
    store = stripTestData(store, await loadManifest(target)).data;
  }

  const backups = new BackupManager(target);
  const backup = await backups.create('pre-seed', { force: true });

  const preSeed = {
    userRecordsHash: userRecordsHash(store),
    monthlySummaryMonths: store.monthlySummaries.map(m => m.month),
    backup: backup?.name || null,
  };

  // Merge. Journal days are keyed by date: never overwrite one the user wrote.
  const userDays = new Set(store.dailyLogs.map(l => l.date));
  const skippedJournalDays: string[] = [];
  const logsToAdd = data.dailyLogs.filter(l => {
    if (userDays.has(l.date)) {
      skippedJournalDays.push(l.date);
      return false;
    }
    return true;
  });
  store.projects.push(...data.projects);
  store.tasks.push(...data.tasks);
  store.focusSessions.push(...data.focusSessions);
  store.dailyLogs.push(...logsToAdd);
  store.notes.push(...data.notes);
  store.thoughts.push(...data.thoughts);
  // settings/activeTimer/monthlySummaries are the user's; leave them alone.

  await writeStore(target, store);
  const stored: StoredManifest = {
    ...manifest,
    counts: { ...manifest.counts, dailyLogs: logsToAdd.length },
    ids: { ...manifest.ids, dailyLogs: logsToAdd.map(l => l.id) },
    mode: 'into',
    target,
    skippedJournalDays,
    preSeed,
  };
  await fs.writeFile(manifestPath(target), JSON.stringify(stored, null, 2), { mode: 0o600 });
  log(`✔ Merged test data into ${target}`);
  if (backup) log(`  Backup taken first: ${backup.name}`);
  if (skippedJournalDays.length) log(`  Skipped ${skippedJournalDays.length} journal day(s) you already have: ${skippedJournalDays.join(', ')}`);
  log('  Remove it again with:  npm run testdata -- clean --into ' + path.relative(process.cwd(), target));
  return stored;
}

async function loadManifest(target: string): Promise<StoredManifest | null> {
  try {
    return JSON.parse(await fs.readFile(manifestPath(target), 'utf-8'));
  } catch {
    return null;
  }
}

/** Removes namespaced records and everything that points at them. */
export function stripTestData(store: DatabaseSchema, manifest: StoredManifest | null): { data: DatabaseSchema; removed: Record<string, number>; unlinked: number; droppedSnapshots: string[] } {
  const removed: Record<string, number> = {};
  const out = { ...store };
  for (const key of ARRAY_COLLECTIONS) {
    const before = (store[key] as { id: string }[]).length;
    (out as any)[key] = (store[key] as { id: string }[]).filter(r => !isTestDataId(r.id));
    removed[key] = before - (out as any)[key].length;
  }
  let unlinked = 0;
  for (const t of out.tasks) {
    if (isTestDataId(t.projectId)) { delete t.projectId; unlinked++; }
  }
  for (const s of out.focusSessions) {
    if (isTestDataId(s.taskId)) { delete s.taskId; unlinked++; }
  }
  for (const th of out.thoughts) {
    if (isTestDataId(th.taskId)) { delete th.taskId; unlinked++; }
    if (th.context && isTestDataId(th.context.taskId)) { delete th.context.taskId; delete th.context.taskTitle; unlinked++; }
  }
  if (out.activeTimer && isTestDataId(out.activeTimer.taskId)) {
    out.activeTimer = { ...out.activeTimer };
    delete out.activeTimer.taskId;
    delete out.activeTimer.taskTitle;
    unlinked++;
  }
  // Book-of-Work pages frozen while test data was present describe test data: drop them.
  const keepMonths = new Set(manifest?.preSeed?.monthlySummaryMonths ?? out.monthlySummaries.map(m => m.month));
  const droppedSnapshots = out.monthlySummaries.filter(m => !keepMonths.has(m.month)).map(m => m.month);
  out.monthlySummaries = out.monthlySummaries.filter(m => keepMonths.has(m.month));
  return { data: out, removed, unlinked, droppedSnapshots };
}

export async function clean(args: Args, log = console.log): Promise<{ verified: boolean }> {
  if (!args.into) {
    const target = path.resolve(args.file || DEFAULT_FRESH_FILE());
    const manifest = await loadManifest(target);
    if (!(await exists(target))) {
      log(`Nothing to clean: ${target} does not exist.`);
      await fs.rm(manifestPath(target), { force: true });
      return { verified: true };
    }
    // Only delete a file we recognise as a generated store.
    const store = await readStore(target);
    const counts = countTestRecords(store);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const userHash = userRecordsHash(store);
    const pristine = userHash === userRecordsHash(emptySchema());
    if (!manifest && (total === 0 || !pristine) && !args.force) {
      throw new Error(`${target} does not look like a generated store (no manifest, ${total} test records, user records present). Pass --force to delete it anyway.`);
    }
    await fs.rm(target, { force: true });
    await fs.rm(manifestPath(target), { force: true });
    // Backups the server took of this store are named after it; they only ever held test data.
    const backups = new BackupManager(target);
    const stale = await backups.list();
    for (const b of stale) await fs.rm(b.file, { force: true });
    log(`✔ Removed ${target}${manifest ? '' : ' (no manifest)'}${stale.length ? ` and ${stale.length} backup(s) of it` : ''}`);
    return { verified: true };
  }

  const target = path.resolve(args.into);
  const manifest = await loadManifest(target);
  const store = await readStore(target);
  const before = countTestRecords(store);
  const { data, removed, unlinked, droppedSnapshots } = stripTestData(store, manifest);
  const after = countTestRecords(data);
  const afterHash = userRecordsHash(data);
  const verified = manifest?.preSeed ? afterHash === manifest.preSeed.userRecordsHash : true;

  await writeStore(target, data);
  await fs.rm(manifestPath(target), { force: true });

  const totalRemoved = Object.values(removed).reduce((a, b) => a + b, 0);
  log(`✔ Removed ${totalRemoved} test record(s) from ${target}: ${JSON.stringify(removed)}`);
  if (unlinked) log(`  Unlinked ${unlinked} reference(s) on your own records that pointed at test data.`);
  if (droppedSnapshots.length) log(`  Dropped Book-of-Work snapshot(s) frozen while test data was present: ${droppedSnapshots.join(', ')} (they will be re-frozen at next start).`);
  if (Object.values(after).some(n => n > 0)) log(`  ⚠ Still present: ${JSON.stringify(after)}`);
  if (manifest?.preSeed) {
    log(verified
      ? '  ✔ Verified: your own records are byte-identical to before seeding.'
      : `  ⚠ Your records differ from the pre-seed snapshot (you edited them while test data was merged — expected if you did). Pre-seed backup: ${manifest.preSeed.backup || 'none'}`);
  } else if (Object.values(before).some(n => n > 0)) {
    log('  (No manifest found; cleaned by id namespace alone.)');
  }
  return { verified };
}

export async function status(args: Args, log = console.log): Promise<void> {
  const target = path.resolve(args.into || args.file || DEFAULT_FRESH_FILE());
  const manifest = await loadManifest(target);
  if (!(await exists(target))) {
    log(`${target}: not present`);
    return;
  }
  const store = await readStore(target);
  const counts = countTestRecords(store);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  log(`Store    : ${target}`);
  log(`Manifest : ${manifest ? `${manifestPath(target)} (seed ${manifest.seed}, anchor ${manifest.anchor}, ${manifest.profile}, ${manifest.mode})` : 'none'}`);
  log(`Test records present: ${total} ${JSON.stringify(counts)}`);
  if (args.into) {
    const userCounts: Record<string, number> = {};
    for (const key of ARRAY_COLLECTIONS) userCounts[key] = (store[key] as { id: string }[]).filter(r => !isTestDataId(r.id)).length;
    log(`Your records        : ${JSON.stringify(userCounts)}`);
  }
}

export function report(args: Args): { markdown: string; json: unknown } {
  const { data, manifest } = generateDataset({ seed: args.seed, anchor: args.anchor, profile: args.profile, tz: args.tz });
  const r = buildReport(data, manifest, args.tz);
  return { markdown: renderReportMarkdown(r), json: r };
}

function help(): string {
  return `HeyWork test data

  seed            write a standalone store (default: data/test-database.json) or --into <file> to merge
  clean           delete the standalone store, or --into <file> to remove merged test data
  status          what test data is present
  report          print the validation report (expected figures) — add --json for machine output

  --seed <int>            default ${DEFAULT_SEED}
  --anchor <date|today>   the "as of" day, default today (data covers the full months before it and its own month to that day)
  --profile small|standard|large   months of full history before the current month: 0 | 3 | 12
  --tz <IANA zone>        default: this machine's zone
  --file <path>           standalone store path
  --into <path>           merge target
  --force                 overwrite / re-seed / delete without the safety checks
  --json                  machine-readable report
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case 'seed': {
      const m = await seed(args);
      if (args.json) console.log(JSON.stringify(m, null, 2));
      else console.log('\n' + report(args).markdown);
      return;
    }
    case 'clean': {
      const { verified } = await clean(args);
      if (!verified) process.exitCode = 3;
      return;
    }
    case 'status':
      await status(args);
      return;
    case 'report': {
      const r = report(args);
      console.log(args.json ? JSON.stringify(r.json, null, 2) : r.markdown);
      return;
    }
    case 'help':
      console.log(help());
      return;
    default:
      console.error(`Unknown command "${args.command}".\n`);
      console.log(help());
      process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1] && /cli\.js$/.test(process.argv[1]);
if (invokedDirectly) {
  main().catch(err => {
    console.error(`✖ ${err?.message || err}`);
    if (err instanceof DatabaseFileError) console.error(`  File: ${err.filePath}`);
    process.exitCode = 1;
  });
}
