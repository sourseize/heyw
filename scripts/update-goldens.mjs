#!/usr/bin/env node
/**
 * Regenerates the golden fixtures the regression suite pins:
 *   - src/test/fixtures/dataset.sha256           hash of the standard generated dataset
 *   - src/test/fixtures/monthly-summary.golden.json  summaries of every month in it (UTC)
 *   - src/test/fixtures/monthly-summary.golden.md    the Markdown page of the anchor month
 * Run deliberately after an intentional change:  npm run test:update-golden
 */
import fs from 'node:fs';
import path from 'node:path';
import { generateDataset } from '../dist/tools/testdata/generator.js';
import { datasetHash } from '../dist/tools/testdata/report.js';
import { computeMonthlySummary } from '../dist/db/summary.js';
import { renderMonthlyMarkdown } from '../dist/db/summary-markdown.js';
import { addMonths } from '../dist/db/time.js';

const dir = path.join(process.cwd(), 'src', 'test', 'fixtures');
fs.mkdirSync(dir, { recursive: true });

// Fixed anchor so the goldens never move with the calendar.
const { data, manifest } = generateDataset({ anchor: '2025-03-31', tz: 'UTC' });
const now = new Date(`${manifest.anchor}T12:00:00.000Z`);
const months = {};
for (let m = manifest.from.slice(0, 7); m <= manifest.to.slice(0, 7); m = addMonths(m, 1)) {
  months[m] = computeMonthlySummary(data, m, 'UTC', { now });
}
months[manifest.spotChecks.emptyMonth] = computeMonthlySummary(data, manifest.spotChecks.emptyMonth, 'UTC', { now });

fs.writeFileSync(path.join(dir, 'dataset.sha256'), datasetHash(data) + '\n');
fs.writeFileSync(path.join(dir, 'monthly-summary.golden.json'), JSON.stringify({ seed: manifest.seed, anchor: manifest.anchor, profile: manifest.profile, tz: 'UTC', months }, null, 2) + '\n');
fs.writeFileSync(path.join(dir, 'monthly-summary.golden.md'), renderMonthlyMarkdown(months[manifest.to.slice(0, 7)], { frozen: true }));
console.log(`✔ Goldens written to ${path.relative(process.cwd(), dir)} (dataset ${datasetHash(data).slice(0, 12)}…)`);
