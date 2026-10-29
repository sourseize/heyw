/**
 * Book of Work — monthly summary.
 *
 * A pure function of the store: same data + same month + same time zone ⇒ the
 * same summary, byte for byte. That is what makes the frozen archive and the
 * regression goldens trustworthy.
 *
 * Instants (session timestamps, task completion, thought capture) are bucketed
 * into days in the user's zone; journal entries already carry a calendar date.
 */
import type { DatabaseSchema, FocusSession, Task, TaskPriority, DailyLog, Thought } from './database.js';
import { addDays, dateInZone, dayOfWeek, daysInMonth, isValidMonthString, todayInZone } from './time.js';

export interface WeekBucket {
  weekStart: string; // first day of the bucket, clipped to the month
  weekEnd: string;   // last day of the bucket, clipped to the month
  minutes: number;
  sessions: number;
}

export interface ProjectMinutes {
  projectId: string | null;
  projectName: string;
  minutes: number;
  sessions: number;
}

export interface CompletedTask {
  id: string;
  title: string;
  priority: TaskPriority;
  completedAt: string;
  completedOn: string; // YYYY-MM-DD in zone
  estimatedMinutes: number | null;
  actualMinutes: number;
  tags: string[];
}

export interface ProjectAccomplishments {
  projectId: string | null;
  projectName: string;
  tasks: CompletedTask[];
}

export interface ReflectionEntry {
  date: string;
  intentions: string[];
  retro: string;
  energyRating: number;
  focusRating: number;
}

export interface MonthlySummary {
  month: string;
  timeZone: string;
  from: string;
  to: string;
  daysInMonth: number;
  /** Days of the month that had already happened when this was generated. */
  daysElapsed: number;
  generatedAt: string;
  deepWork: {
    totalMinutes: number;
    totalHours: number;
    sessions: number;
    completedSessions: number;
    avgSessionMinutes: number;
    activeDays: number;
    longestStreakDays: number;
    bestDay: { date: string; minutes: number } | null;
    byWeek: WeekBucket[];
    byProject: ProjectMinutes[];
    byDay: { date: string; minutes: number }[];
    breakMinutes: number;
  };
  flow: {
    sessionsWithSignals: number;
    uninterruptedSessions: number;
    awayMinutes: number;
    distractions: number;
    appInteractions: number;
    unverifiedMinutes: number;
    endings: Record<'completed' | 'stopped' | 'switched' | 'abandoned' | 'unknown', number>;
  };
  accomplishments: {
    tasksCompleted: number;
    byPriority: Record<TaskPriority, number>;
    byProject: ProjectAccomplishments[];
    estimationAccuracy: { estimated: number; actual: number; ratio: number | null };
    tasksCreated: number;
    tasksStillOpen: number;
  };
  reflections: {
    journalDays: number;
    avgEnergy: number | null;
    avgFocus: number | null;
    ratingsByWeek: { weekStart: string; weekEnd: string; energy: number | null; focus: number | null; days: number }[];
    entries: ReflectionEntry[];
  };
  thoughts: {
    captured: number;
    converted: number;
    kept: number;
    discarded: number;
    pendingInbox: number;
    capturedDuringFocus: number;
  };
  notes: {
    created: number;
    updated: number;
  };
}

export interface SummaryOptions {
  now?: Date;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** Monday-start week buckets clipped to the month. */
export function weekBuckets(month: string): { weekStart: string; weekEnd: string }[] {
  const first = `${month}-01`;
  const last = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
  const buckets: { weekStart: string; weekEnd: string }[] = [];
  let cursor = first;
  while (cursor <= last) {
    // days until Sunday (Mon=1 … Sun=0)
    const dow = dayOfWeek(cursor);
    const toSunday = dow === 0 ? 0 : 7 - dow;
    let end = addDays(cursor, toSunday);
    if (end > last) end = last;
    buckets.push({ weekStart: cursor, weekEnd: end });
    cursor = addDays(end, 1);
  }
  return buckets;
}

function bucketFor(buckets: { weekStart: string; weekEnd: string }[], date: string) {
  return buckets.find(b => date >= b.weekStart && date <= b.weekEnd);
}

export function computeMonthlySummary(
  data: Readonly<DatabaseSchema>,
  month: string,
  tz: string,
  options: SummaryOptions = {},
): MonthlySummary {
  if (!isValidMonthString(month)) throw new Error(`Invalid month: ${month}`);
  const now = options.now || new Date();
  const from = `${month}-01`;
  const dim = daysInMonth(month);
  const to = `${month}-${String(dim).padStart(2, '0')}`;
  const today = todayInZone(tz, now);
  const daysElapsed = today < from ? 0 : today > to ? dim : Number(today.slice(8, 10));
  const inMonth = (date: string) => date >= from && date <= to;
  const projectName = (id?: string) => (id && data.projects.find(p => p.id === id)?.name) || 'No project';

  // ── Deep work ──
  const focusSessions: (FocusSession & { day: string })[] = [];
  let breakMinutes = 0;
  for (const s of data.focusSessions) {
    const day = dateInZone(s.timestamp, tz);
    if (!inMonth(day)) continue;
    if (s.type === 'focus') {
      if (s.durationMinutes > 0) focusSessions.push({ ...s, day });
    } else {
      breakMinutes += s.durationMinutes;
    }
  }
  const totalMinutes = focusSessions.reduce((a, s) => a + s.durationMinutes, 0);
  const minutesByDay = new Map<string, number>();
  for (const s of focusSessions) minutesByDay.set(s.day, (minutesByDay.get(s.day) || 0) + s.durationMinutes);
  const byDay = [...minutesByDay.entries()].map(([date, minutes]) => ({ date, minutes })).sort((a, b) => a.date.localeCompare(b.date));

  let longest = 0;
  let run = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (minutesByDay.has(d)) {
      run++;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }
  const bestDay = byDay.reduce<{ date: string; minutes: number } | null>(
    (best, cur) => (!best || cur.minutes > best.minutes ? cur : best),
    null,
  );

  const buckets = weekBuckets(month);
  const byWeek: WeekBucket[] = buckets.map(b => ({ ...b, minutes: 0, sessions: 0 }));
  for (const s of focusSessions) {
    const b = byWeek.find(w => s.day >= w.weekStart && s.day <= w.weekEnd);
    if (b) {
      b.minutes += s.durationMinutes;
      b.sessions++;
    }
  }

  const projMap = new Map<string | null, ProjectMinutes>();
  for (const s of focusSessions) {
    const task = s.taskId ? data.tasks.find(t => t.id === s.taskId) : undefined;
    const pid = task?.projectId || null;
    const entry = projMap.get(pid) || { projectId: pid, projectName: projectName(pid || undefined), minutes: 0, sessions: 0 };
    entry.minutes += s.durationMinutes;
    entry.sessions++;
    projMap.set(pid, entry);
  }
  const byProject = [...projMap.values()].sort((a, b) => b.minutes - a.minutes || a.projectName.localeCompare(b.projectName));

  // ── Flow integrity ──
  const flow = {
    sessionsWithSignals: 0,
    uninterruptedSessions: 0,
    awayMinutes: 0,
    distractions: 0,
    appInteractions: 0,
    unverifiedMinutes: 0,
    endings: { completed: 0, stopped: 0, switched: 0, abandoned: 0, unknown: 0 } as MonthlySummary['flow']['endings'],
  };
  for (const s of focusSessions) {
    const reason = s.endReason || (s.completed ? 'completed' : 'unknown');
    flow.endings[reason in flow.endings ? (reason as keyof typeof flow.endings) : 'unknown']++;
    if (s.integrity) {
      flow.sessionsWithSignals++;
      flow.awayMinutes += s.integrity.awayMs / 60_000;
      flow.distractions += s.integrity.distractions;
      flow.appInteractions += s.integrity.appInteractions;
      flow.unverifiedMinutes += (s.integrity.unverifiedMs || 0) / 60_000;
      if (s.integrity.distractions === 0 && s.integrity.appInteractions === 0) flow.uninterruptedSessions++;
    }
  }
  flow.awayMinutes = round1(flow.awayMinutes);
  flow.unverifiedMinutes = round1(flow.unverifiedMinutes);

  // ── Accomplishments ──
  const completed: CompletedTask[] = [];
  const byPriority: Record<TaskPriority, number> = { low: 0, medium: 0, high: 0, urgent: 0 };
  const accMap = new Map<string | null, ProjectAccomplishments>();
  let tasksCreated = 0;
  let estimated = 0;
  let actual = 0;
  let estimatedCount = 0;
  for (const t of data.tasks) {
    if (inMonth(dateInZone(t.createdAt, tz))) tasksCreated++;
    if (!t.completedAt) continue;
    const day = dateInZone(t.completedAt, tz);
    if (!inMonth(day)) continue;
    const ct: CompletedTask = {
      id: t.id,
      title: t.title,
      priority: t.priority,
      completedAt: t.completedAt,
      completedOn: day,
      estimatedMinutes: typeof t.estimatedMinutes === 'number' ? t.estimatedMinutes : null,
      actualMinutes: t.actualMinutes || 0,
      tags: [...t.tags],
    };
    completed.push(ct);
    byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
    if (ct.estimatedMinutes !== null) {
      estimated += ct.estimatedMinutes;
      actual += ct.actualMinutes;
      estimatedCount++;
    }
    const pid = t.projectId || null;
    const entry = accMap.get(pid) || { projectId: pid, projectName: projectName(pid || undefined), tasks: [] };
    entry.tasks.push(ct);
    accMap.set(pid, entry);
  }
  for (const entry of accMap.values()) entry.tasks.sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.title.localeCompare(b.title));
  const accByProject = [...accMap.values()].sort((a, b) => b.tasks.length - a.tasks.length || a.projectName.localeCompare(b.projectName));
  const tasksStillOpen = data.tasks.filter(t => t.status !== 'done' && dateInZone(t.createdAt, tz) <= to).length;

  // ── Reflections ──
  const logs = data.dailyLogs.filter(l => inMonth(l.date)).sort((a, b) => a.date.localeCompare(b.date));
  const ratingsByWeek = buckets.map(b => {
    const ls = logs.filter(l => l.date >= b.weekStart && l.date <= b.weekEnd);
    return {
      weekStart: b.weekStart,
      weekEnd: b.weekEnd,
      energy: avg(ls.map(l => l.energyRating)),
      focus: avg(ls.map(l => l.focusRating)),
      days: ls.length,
    };
  });

  // ── Thoughts ──
  const captured = data.thoughts.filter(t => inMonth(dateInZone(t.capturedAt, tz)));
  const thoughtCount = (status: Thought['status']) => captured.filter(t => t.status === status).length;

  // ── Notes ──
  const notesCreated = data.notes.filter(n => inMonth(dateInZone(n.createdAt, tz))).length;
  const notesUpdated = data.notes.filter(n => n.updatedAt !== n.createdAt && inMonth(dateInZone(n.updatedAt, tz))).length;

  return {
    month,
    timeZone: tz,
    from,
    to,
    daysInMonth: dim,
    daysElapsed,
    generatedAt: now.toISOString(),
    deepWork: {
      totalMinutes,
      totalHours: round1(totalMinutes / 60),
      sessions: focusSessions.length,
      completedSessions: focusSessions.filter(s => s.completed).length,
      avgSessionMinutes: focusSessions.length ? Math.round(totalMinutes / focusSessions.length) : 0,
      activeDays: minutesByDay.size,
      longestStreakDays: longest,
      bestDay,
      byWeek,
      byProject,
      byDay,
      breakMinutes,
    },
    flow,
    accomplishments: {
      tasksCompleted: completed.length,
      byPriority,
      byProject: accByProject,
      estimationAccuracy: {
        estimated,
        actual,
        ratio: estimatedCount && estimated > 0 ? round1(actual / estimated) : null,
      },
      tasksCreated,
      tasksStillOpen,
    },
    reflections: {
      journalDays: logs.length,
      avgEnergy: avg(logs.map(l => l.energyRating)),
      avgFocus: avg(logs.map(l => l.focusRating)),
      ratingsByWeek,
      entries: logs.map((l: DailyLog) => ({
        date: l.date,
        intentions: [...l.intentions],
        retro: l.retro,
        energyRating: l.energyRating,
        focusRating: l.focusRating,
      })),
    },
    thoughts: {
      captured: captured.length,
      converted: thoughtCount('converted'),
      kept: thoughtCount('kept'),
      discarded: thoughtCount('discarded'),
      pendingInbox: thoughtCount('inbox'),
      capturedDuringFocus: captured.filter(t => t.context?.timerRunning && t.context.timerType === 'focus').length,
    },
    notes: { created: notesCreated, updated: notesUpdated },
  };
}

/** True when the month has anything worth a page. */
export function monthHasData(s: MonthlySummary): boolean {
  return (
    s.deepWork.sessions > 0 ||
    s.deepWork.breakMinutes > 0 ||
    s.accomplishments.tasksCompleted > 0 ||
    s.accomplishments.tasksCreated > 0 ||
    s.reflections.journalDays > 0 ||
    s.thoughts.captured > 0 ||
    s.notes.created > 0 ||
    s.notes.updated > 0
  );
}

/** Every YYYY-MM that has at least one record, in the given zone. */
export function monthsWithData(data: Readonly<DatabaseSchema>, tz: string): string[] {
  const months = new Set<string>();
  const add = (iso?: string) => {
    if (iso) months.add(dateInZone(iso, tz).slice(0, 7));
  };
  data.focusSessions.forEach(s => add(s.timestamp));
  data.tasks.forEach(t => {
    add(t.createdAt);
    add(t.completedAt);
  });
  data.dailyLogs.forEach(l => months.add(l.date.slice(0, 7)));
  data.thoughts.forEach(t => add(t.capturedAt));
  data.notes.forEach(n => {
    add(n.createdAt);
    add(n.updatedAt);
  });
  data.monthlySummaries.forEach(m => months.add(m.month));
  return [...months].sort().reverse();
}

export function isTaskOpen(t: Task): boolean {
  return t.status !== 'done';
}
