/**
 * Book of Work — archive and freezing.
 *
 *  - The month in progress is always computed live.
 *  - A month that has closed is frozen into `monthlySummaries` automatically:
 *    at 00:00 UTC on the 1st, and at server start-up for any closed month that
 *    has data but no snapshot yet (the app is rarely running at midnight).
 *  - Frozen pages are never silently regenerated; `freezeMonth(..., { force })`
 *    re-freezes on demand when you have back-filled data.
 *
 * The zone used for freezing is the last one a client sent (`settings.timeZone`),
 * falling back to UTC. Each snapshot records the zone it was bucketed in.
 */
import type { Database, MonthlySummaryRecord } from './database.js';
import { computeMonthlySummary, monthHasData, monthsWithData } from './summary.js';
import type { MonthlySummary } from './summary.js';
import { addMonths, monthInZone, resolveTimeZone } from './time.js';

export interface SummaryPage {
  summary: MonthlySummary;
  frozen: boolean;
  frozenAt: string | null;
  current: boolean;
}

export interface ArchiveEntry {
  month: string;
  current: boolean;
  frozen: boolean;
  frozenAt: string | null;
  timeZone: string;
  deepWorkMinutes: number;
  sessions: number;
  tasksCompleted: number;
  journalDays: number;
}

export function currentMonth(tz: string, now = new Date()): string {
  return monthInZone(now, tz);
}

export function isClosedMonth(month: string, tz: string, now = new Date()): boolean {
  return month < currentMonth(tz, now);
}

/** The zone server-side jobs should bucket in. */
export function freezeZone(db: Database): string {
  return resolveTimeZone(db.getSettings().timeZone);
}

export function getSummaryPage(db: Database, month: string, tz: string, now = new Date()): SummaryPage {
  const record = db.getMonthlySummaryRecord(month);
  const current = month === currentMonth(tz, now);
  if (record && !current) {
    return { summary: record.summary as MonthlySummary, frozen: true, frozenAt: record.generatedAt, current: false };
  }
  return { summary: computeMonthlySummary(db.snapshot(), month, tz, { now }), frozen: false, frozenAt: null, current };
}

export function freezeMonth(db: Database, month: string, tz: string, now = new Date(), options: { force?: boolean } = {}): MonthlySummaryRecord | null {
  if (!isClosedMonth(month, tz, now)) return null;
  const existing = db.getMonthlySummaryRecord(month);
  if (existing && !options.force) return existing;
  const summary = computeMonthlySummary(db.snapshot(), month, tz, { now });
  return db.upsertMonthlySummary({ month, timeZone: tz, generatedAt: now.toISOString(), summary });
}

/** Freezes every closed month that has data but no snapshot. Returns what was frozen. */
export function freezeClosedMonths(db: Database, now = new Date()): MonthlySummaryRecord[] {
  const tz = freezeZone(db);
  const frozen: MonthlySummaryRecord[] = [];
  for (const month of monthsWithData(db.snapshot(), tz)) {
    if (!isClosedMonth(month, tz, now)) continue;
    if (db.getMonthlySummaryRecord(month)) continue;
    const summary = computeMonthlySummary(db.snapshot(), month, tz, { now });
    if (!monthHasData(summary)) continue;
    frozen.push(db.upsertMonthlySummary({ month, timeZone: tz, generatedAt: now.toISOString(), summary }));
  }
  return frozen;
}

export function archiveIndex(db: Database, tz: string, now = new Date()): ArchiveEntry[] {
  const cur = currentMonth(tz, now);
  const months = new Set(monthsWithData(db.snapshot(), tz));
  months.add(cur);
  const entries: ArchiveEntry[] = [];
  for (const month of [...months].sort().reverse()) {
    const page = getSummaryPage(db, month, tz, now);
    const current = month === cur;
    if (!current && !page.frozen && !monthHasData(page.summary)) continue;
    entries.push({
      month,
      current,
      frozen: page.frozen,
      frozenAt: page.frozenAt,
      timeZone: page.summary.timeZone,
      deepWorkMinutes: page.summary.deepWork.totalMinutes,
      sessions: page.summary.deepWork.sessions,
      tasksCompleted: page.summary.accomplishments.tasksCompleted,
      journalDays: page.summary.reflections.journalDays,
    });
  }
  return entries;
}

/** Next 00:00 UTC on the 1st of a month, strictly after `now`. */
export function nextUtcMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

/**
 * The first instant after `now` at which the month changes in `tz`. For zones
 * behind UTC the local month closes *after* 00:00 UTC on the 1st, so the job
 * also waits for this moment to freeze correctly.
 */
export function nextLocalMonthStart(now: Date, tz: string): Date {
  const startMonth = monthInZone(now, tz);
  const target = addMonths(startMonth, 1);
  // Walk forward in hours until the zone's month flips, then refine to the minute.
  let t = now.getTime();
  const hour = 60 * 60 * 1000;
  for (let i = 0; i < 24 * 35; i++) {
    t += hour;
    if (monthInZone(new Date(t), tz) >= target) break;
  }
  let lo = t - hour;
  let hi = t;
  while (hi - lo > 60_000) {
    const mid = Math.floor((lo + hi) / 2);
    if (monthInZone(new Date(mid), tz) >= target) hi = mid;
    else lo = mid;
  }
  return new Date(hi);
}

/** When the freeze job should next run. */
export function nextFreezeInstant(now: Date, tz: string): Date {
  const utc = nextUtcMonthStart(now);
  const local = nextLocalMonthStart(now, tz);
  return utc < local ? utc : local;
}
