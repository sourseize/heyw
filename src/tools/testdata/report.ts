/**
 * Validation report: the figures the generated dataset implies, computed with the
 * same code the app uses (summary + dashboard) so report, UI and tests agree.
 */
import crypto from 'node:crypto';
import { Database } from '../../db/database.js';
import type { DatabaseSchema } from '../../db/database.js';
import { computeMonthlySummary, monthsWithData } from '../../db/summary.js';
import type { MonthlySummary } from '../../db/summary.js';
import { addMonths } from '../../db/time.js';
import type { Manifest } from './generator.js';

export interface MonthFigures {
  month: string;
  deepWorkMinutes: number;
  deepWorkHours: number;
  sessions: number;
  activeDays: number;
  longestStreak: number;
  tasksCompleted: number;
  journalDays: number;
  avgEnergy: number | null;
  avgFocus: number | null;
  thoughts: { captured: number; converted: number; kept: number; discarded: number; pendingInbox: number };
}

export interface ValidationReport {
  seed: number;
  anchor: string;
  profile: string;
  tz: string;
  from: string;
  to: string;
  datasetSha256: string;
  counts: Record<string, number>;
  months: MonthFigures[];
  emptyMonth: { month: string; deepWorkMinutes: number; tasksCompleted: number; journalDays: number };
  dashboard: {
    today: string;
    focusTodayMinutes: number;
    completedToday: number;
    streak: number;
    inboxCount: number;
    statusCounts: Record<string, number>;
    totalProjects: number;
  };
  spotChecks: { label: string; value: string | number }[];
  archiveMonths: string[];
}

/** Stable hash of the dataset (ids, timestamps and text all included). */
export function datasetHash(data: DatabaseSchema): string {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

function figures(s: MonthlySummary): MonthFigures {
  return {
    month: s.month,
    deepWorkMinutes: s.deepWork.totalMinutes,
    deepWorkHours: s.deepWork.totalHours,
    sessions: s.deepWork.sessions,
    activeDays: s.deepWork.activeDays,
    longestStreak: s.deepWork.longestStreakDays,
    tasksCompleted: s.accomplishments.tasksCompleted,
    journalDays: s.reflections.journalDays,
    avgEnergy: s.reflections.avgEnergy,
    avgFocus: s.reflections.avgFocus,
    thoughts: {
      captured: s.thoughts.captured,
      converted: s.thoughts.converted,
      kept: s.thoughts.kept,
      discarded: s.thoughts.discarded,
      pendingInbox: s.thoughts.pendingInbox,
    },
  };
}

export function buildReport(data: DatabaseSchema, manifest: Manifest, tz: string = manifest.tz): ValidationReport {
  const db = Database.fromSnapshot(data);
  // "Now" is midday UTC on the anchor day: the same calendar day in every zone from UTC-11 to UTC+11.
  const now = new Date(`${manifest.anchor}T12:00:00.000Z`);

  const months: MonthFigures[] = [];
  for (let m = manifest.from.slice(0, 7); m <= manifest.to.slice(0, 7); m = addMonths(m, 1)) {
    months.push(figures(computeMonthlySummary(data, m, tz, { now })));
  }
  months.reverse(); // newest first; the first entry is the month in progress

  const empty = computeMonthlySummary(data, manifest.spotChecks.emptyMonth, tz, { now });
  const dash = db.getDashboardSummary(tz, now);

  const task = (id: string | null) => (id ? data.tasks.find(t => t.id === id) : undefined);
  const project = (id?: string) => data.projects.find(p => p.id === id)?.name || 'No project';
  const over = task(manifest.spotChecks.overEstimateTaskId);
  const noProject = task(manifest.spotChecks.noProjectTaskId);
  const future = task(manifest.spotChecks.futureDueTaskId);
  const converted = task(manifest.spotChecks.convertedTaskId);
  const openByProject = data.projects
    .filter(p => !p.archived)
    .map(p => `${p.name}: ${data.tasks.filter(t => t.projectId === p.id && t.status !== 'done').length}`)
    .join(' · ');
  const spotChecks: { label: string; value: string | number }[] = [];
  if (over) spotChecks.push({ label: `Task over estimate — “${over.title}” (${project(over.projectId)})`, value: `${over.actualMinutes}m actual vs ${over.estimatedMinutes}m estimated` });
  if (noProject) spotChecks.push({ label: `Task without a project — “${noProject.title}”`, value: `status ${noProject.status}` });
  if (future) spotChecks.push({ label: `Task due in the future — “${future.title}”`, value: `due ${future.dueDate}` });
  if (converted) spotChecks.push({ label: `Thought converted into a task — “${converted.title}”`, value: `task id ${converted.id}` });
  if (manifest.spotChecks.incompleteSessionId) {
    const inc = data.focusSessions.find(s => s.id === manifest.spotChecks.incompleteSessionId)!;
    spotChecks.push({ label: `Most recent block stopped early (${inc.timestamp.slice(0, 10)}, counts as deep work)`, value: `${inc.durationMinutes}m of ${inc.plannedMinutes}m` });
  }
  spotChecks.push({ label: 'Late-night blocks at 23:30 UTC (land on the next day in zones ahead of UTC)', value: manifest.spotChecks.lateNightSessionIds.length });
  spotChecks.push({ label: 'Open tasks per project', value: openByProject });
  spotChecks.push({ label: 'Archive months with data', value: monthsWithData(data, tz).join(', ') });

  return {
    seed: manifest.seed,
    anchor: manifest.anchor,
    profile: manifest.profile,
    tz,
    from: manifest.from,
    to: manifest.to,
    datasetSha256: datasetHash(data),
    counts: manifest.counts,
    months,
    emptyMonth: {
      month: empty.month,
      deepWorkMinutes: empty.deepWork.totalMinutes,
      tasksCompleted: empty.accomplishments.tasksCompleted,
      journalDays: empty.reflections.journalDays,
    },
    dashboard: {
      today: dash.today,
      focusTodayMinutes: dash.focusTodayMinutes,
      completedToday: dash.completedToday,
      streak: dash.streak,
      inboxCount: dash.inboxCount,
      statusCounts: dash.statusCounts,
      totalProjects: dash.totalProjects,
    },
    spotChecks,
    archiveMonths: monthsWithData(data, tz),
  };
}

export function renderReportMarkdown(r: ValidationReport): string {
  const lines: string[] = [];
  lines.push(`# HeyWork test data — seed ${r.seed} · as of ${r.anchor} · profile ${r.profile} · tz ${r.tz}`);
  lines.push('');
  lines.push(`Covers ${r.from} → ${r.to}: the full months before, and the current month up to and including the anchor day.`);
  lines.push(`Every day's records are derived from the date itself, so the figures for a past day never change; running again tomorrow only adds tomorrow.`);
  lines.push('');
  lines.push(`dataset-sha256: \`${r.datasetSha256}\` (identical on every run with these parameters)`);
  lines.push('');
  lines.push('| Collection | Count |');
  lines.push('|---|---|');
  for (const [k, v] of Object.entries(r.counts)) lines.push(`| ${k} | ${v} |`);
  lines.push('');
  lines.push('## Expected figures — Book of Work');
  lines.push('');
  lines.push('| Month | Deep work | Blocks | Active days | Longest streak | Tasks done | Journal days | Avg energy | Avg focus | Thoughts captured / task / kept / discarded / inbox |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const m of r.months) {
    const t = m.thoughts;
    const label = m.month === r.to.slice(0, 7) ? `${m.month} (in progress, to day ${Number(r.to.slice(8, 10))})` : m.month;
    lines.push(`| ${label} | ${m.deepWorkHours}h (${m.deepWorkMinutes}m) | ${m.sessions} | ${m.activeDays} | ${m.longestStreak}d | ${m.tasksCompleted} | ${m.journalDays} | ${m.avgEnergy ?? '–'} | ${m.avgFocus ?? '–'} | ${t.captured} / ${t.converted} / ${t.kept} / ${t.discarded} / ${t.pendingInbox} |`);
  }
  lines.push(`| ${r.emptyMonth.month} (empty) | 0h (0m) | 0 | 0 | 0d | 0 | 0 | – | – | 0 / 0 / 0 / 0 / 0 |`);
  lines.push('');
  lines.push(`## Dashboard on the anchor day (${r.dashboard.today})`);
  lines.push('');
  lines.push(`- Focused today: **${r.dashboard.focusTodayMinutes}m** · completed today: **${r.dashboard.completedToday}** · streak: **${r.dashboard.streak} days** · thought inbox: **${r.dashboard.inboxCount}**`);
  const sc = r.dashboard.statusCounts;
  lines.push(`- Board: backlog ${sc.backlog} · to do ${sc.todo} · in progress ${sc.in_progress} · done ${sc.done} · active projects ${r.dashboard.totalProjects}`);
  lines.push('');
  lines.push('## Spot checks');
  lines.push('');
  for (const s of r.spotChecks) lines.push(`- ${s.label}: **${s.value}**`);
  lines.push('');
  lines.push('_Figures are produced by the same summary and dashboard code the app runs. The dashboard line describes the anchor day (today by default)._');
  lines.push('');
  return lines.join('\n');
}
