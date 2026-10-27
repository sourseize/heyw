#!/usr/bin/env node
/**
 * Runs the whole test pyramid (unit → api → e2e → ui) and enforces the isolation
 * guard (workbook R10): the developer's own data/database.json must be byte-identical
 * before and after the run. Zero dependencies.
 *
 *   node scripts/test-all.mjs            # all groups
 *   node scripts/test-all.mjs unit api   # selected groups
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const GROUPS = ['unit', 'api', 'e2e', 'ui'];
const requested = process.argv.slice(2).filter(a => GROUPS.includes(a));
const groups = requested.length ? requested : GROUPS;

const dataFile = process.env.HEYW_DATA_FILE || path.join(process.cwd(), 'data', 'database.json');
const fingerprint = () => {
  if (!fs.existsSync(dataFile)) return 'absent';
  return createHash('sha256').update(fs.readFileSync(dataFile)).digest('hex');
};

const before = fingerprint();
let failed = false;

for (const group of groups) {
  const dir = path.join('dist', 'test', group);
  if (!fs.existsSync(dir)) {
    console.log(`\n▶ ${group}: no compiled tests in ${dir} (run npm run build)`);
    continue;
  }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).map(f => path.join(dir, f));
  if (files.length === 0) {
    console.log(`\n▶ ${group}: no tests`);
    continue;
  }
  console.log(`\n▶ ${group} (${files.length} file${files.length === 1 ? '' : 's'})`);
  const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    failed = true;
    console.error(`✖ ${group} failed`);
  }
}

const after = fingerprint();
if (before !== after) {
  failed = true;
  console.error(`\n✖ ISOLATION GUARD: ${dataFile} changed during the test run (before ${before.slice(0, 12)}…, after ${after.slice(0, 12)}…).`);
  console.error('  Tests must only ever touch temp stores. Investigate before trusting this run.');
} else {
  console.log(`\n✔ Isolation guard: ${path.relative(process.cwd(), dataFile)} untouched (${before === 'absent' ? 'absent' : before.slice(0, 12) + '…'})`);
}

process.exit(failed ? 1 : 0);
