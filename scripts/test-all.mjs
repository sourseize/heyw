#!/usr/bin/env node
/**
 * Runs the whole test pyramid (unit → api → e2e → ui) and enforces the isolation
 * guard (workbook R10): the developer's own data/database.json must be byte-identical
 * before and after the run. Zero dependencies.
 *
 *   node scripts/test-all.mjs                 # all groups, full test-runner output
 *   node scripts/test-all.mjs unit api        # selected groups
 *   node scripts/test-all.mjs --quiet         # one line per module:
 *                                             #   <module>  Tests Passed X, Failed Y, Skipped Z
 *                                             # (the runner output of a failing module is shown under its line)
 *   node scripts/test-all.mjs --quiet --json  # the same figures as JSON (for CI)
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const GROUPS = ['unit', 'api', 'e2e', 'ui'];
const argv = process.argv.slice(2);
const quiet = argv.includes('--quiet') || argv.includes('-q');
const asJson = argv.includes('--json');
const requested = argv.filter(a => GROUPS.includes(a));
const groups = requested.length ? requested : GROUPS;

const dataFile = process.env.HEYW_DATA_FILE || path.join(process.cwd(), 'data', 'database.json');
const fingerprint = () => {
  if (!fs.existsSync(dataFile)) return 'absent';
  return createHash('sha256').update(fs.readFileSync(dataFile)).digest('hex');
};

const before = fingerprint();
let failed = false;

/** Module name as shown in the summary: `unit/links`, `ui/thoughts.ui`, … */
const moduleName = (group, file) => `${group}/${path.basename(file).replace(/\.test\.js$/, '')}`;

/** Pulls the figures out of the TAP summary Node prints at the end of a run. */
function parseSummary(output) {
  const num = (key) => {
    const m = output.match(new RegExp(`^# ${key} (\\d+)`, 'm'));
    return m ? Number(m[1]) : 0;
  };
  return { passed: num('pass'), failed: num('fail'), skipped: num('skipped') + num('todo') };
}

/** The `not ok … ...` YAML blocks of a TAP stream, i.e. just the failures. */
function failingBlocks(tap) {
  const out = [];
  let inBlock = false;
  for (const line of tap.split('\n')) {
    if (/^\s*not ok /.test(line)) inBlock = true;
    if (inBlock) out.push(line);
    if (inBlock && /^\s*\.\.\.\s*$/.test(line)) {
      inBlock = false;
      out.push('');
    }
  }
  return out.join('\n').trimEnd();
}

const results = [];

for (const group of groups) {
  const dir = path.join('dist', 'test', group);
  if (!fs.existsSync(dir)) {
    if (!asJson) console.log(`\n▶ ${group}: no compiled tests in ${dir} (run npm run build)`);
    continue;
  }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort().map(f => path.join(dir, f));
  if (files.length === 0) {
    if (!asJson) console.log(`\n▶ ${group}: no tests`);
    continue;
  }

  if (!quiet) {
    console.log(`\n▶ ${group} (${files.length} file${files.length === 1 ? '' : 's'})`);
    const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', env: process.env });
    if (result.status !== 0) {
      failed = true;
      console.error(`✖ ${group} failed`);
    }
    continue;
  }

  // Quiet: one process per module so the figures can be attributed to it.
  for (const file of files) {
    const name = moduleName(group, file);
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], { encoding: 'utf-8', env: process.env });
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    const summary = parseSummary(output);
    const ok = result.status === 0 && summary.failed === 0;
    if (!ok) failed = true;
    results.push({ module: name, ...summary, ok });
    if (!asJson) {
      console.log(`${name.padEnd(28)} Tests Passed ${summary.passed}, Failed ${summary.failed}, Skipped ${summary.skipped}`);
      if (!ok) {
        // Show only what is needed to act on: the failing subtests (and stderr), indented.
        const detail = summary.failed ? failingBlocks(result.stdout || '') : (result.stdout || '').trimEnd();
        const extra = (result.stderr || '').trimEnd();
        for (const text of [detail, extra]) if (text) console.log(text.split('\n').map(l => `    ${l}`).join('\n'));
        if (result.status !== 0 && summary.failed === 0) console.log(`    (exit code ${result.status} without a failing test: the module crashed before reporting)`);
      }
    }
  }
}

const after = fingerprint();
const isolated = before === after;
if (!isolated) failed = true;

if (quiet) {
  const total = results.reduce((acc, r) => ({ passed: acc.passed + r.passed, failed: acc.failed + r.failed, skipped: acc.skipped + r.skipped }), { passed: 0, failed: 0, skipped: 0 });
  if (asJson) {
    console.log(JSON.stringify({ modules: results, total, isolationGuard: isolated ? 'untouched' : 'CHANGED', dataFile, ok: !failed }, null, 2));
  } else {
    console.log(''.padEnd(28 + 40, '─'));
    console.log(`${'total'.padEnd(28)} Tests Passed ${total.passed}, Failed ${total.failed}, Skipped ${total.skipped}`);
    console.log(`${'isolation guard'.padEnd(28)} ${isolated ? `untouched (${path.relative(process.cwd(), dataFile)})` : `✖ ${dataFile} CHANGED during the run`}`);
  }
} else if (!isolated) {
  console.error(`\n✖ ISOLATION GUARD: ${dataFile} changed during the test run (before ${before.slice(0, 12)}…, after ${after.slice(0, 12)}…).`);
  console.error('  Tests must only ever touch temp stores. Investigate before trusting this run.');
} else {
  console.log(`\n✔ Isolation guard: ${path.relative(process.cwd(), dataFile)} untouched (${before === 'absent' ? 'absent' : before.slice(0, 12) + '…'})`);
}

process.exit(failed ? 1 : 0);
