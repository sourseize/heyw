/**
 * Renders a MonthlySummary as the Markdown page of the Book of Work.
 * Deterministic: no locale-dependent formatting, no wall-clock reads.
 */
import type { MonthlySummary } from './summary.js';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthTitle(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function hours(minutes: number): string {
  return `${Math.round((minutes / 60) * 10) / 10}h`;
}

function mins(minutes: number): string {
  return `${Math.round(minutes)}m`;
}

function pct(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : '–';
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function blockquote(text: string): string {
  return text
    .split(/\r?\n/)
    .map(line => `> ${line}`)
    .join('\n');
}

export function renderMonthlyMarkdown(s: MonthlySummary, options: { frozen?: boolean } = {}): string {
  const lines: string[] = [];
  const dw = s.deepWork;
  const acc = s.accomplishments;
  const refl = s.reflections;

  lines.push(`# Book of Work — ${monthTitle(s.month)}`);
  lines.push('');
  lines.push(`_${s.from} to ${s.to} · time zone ${s.timeZone} · ${options.frozen ? 'frozen' : 'generated'} ${s.generatedAt.slice(0, 10)}_`);
  lines.push('');

  // ── At a glance ──
  lines.push('## At a glance');
  lines.push('');
  lines.push('| Deep work | Sessions | Active days | Longest streak | Tasks done | Journal days | Avg energy | Avg focus |');
  lines.push('|---|---|---|---|---|---|---|---|');
  lines.push(
    `| **${hours(dw.totalMinutes)}** (${dw.totalMinutes}m) | ${dw.sessions} | ${dw.activeDays} / ${s.daysInMonth} | ${dw.longestStreakDays}d | ${acc.tasksCompleted} | ${refl.journalDays} | ${refl.avgEnergy ?? '–'} | ${refl.avgFocus ?? '–'} |`,
  );
  lines.push('');

  // ── Deep work ──
  lines.push('## Deep work');
  lines.push('');
  if (dw.sessions === 0) {
    lines.push('_No focus blocks this month._');
  } else {
    lines.push(`- Total: **${hours(dw.totalMinutes)}** across ${dw.sessions} blocks (avg ${dw.avgSessionMinutes}m, ${dw.completedSessions} ran to their planned end)`);
    if (dw.bestDay) lines.push(`- Best day: ${dw.bestDay.date} with ${mins(dw.bestDay.minutes)}`);
    lines.push(`- Breaks taken: ${mins(dw.breakMinutes)}`);
    lines.push('');
    lines.push('| Week | Deep work | Blocks |');
    lines.push('|---|---|---|');
    for (const w of dw.byWeek) lines.push(`| ${w.weekStart} → ${w.weekEnd} | ${hours(w.minutes)} | ${w.sessions} |`);
    lines.push('');
    lines.push('| Project | Deep work | Blocks | Share |');
    lines.push('|---|---|---|---|');
    for (const p of dw.byProject) lines.push(`| ${escapeCell(p.projectName)} | ${hours(p.minutes)} | ${p.sessions} | ${pct(p.minutes, dw.totalMinutes)} |`);
  }
  lines.push('');

  // ── Flow integrity ──
  lines.push('## Flow integrity');
  lines.push('');
  if (s.flow.sessionsWithSignals === 0) {
    lines.push('_No attention signals recorded._');
  } else {
    const f = s.flow;
    lines.push(`- ${f.uninterruptedSessions} of ${f.sessionsWithSignals} blocks ran with no tab-switching and no clicks inside HeyWork`);
    lines.push(`- Away from the window: ${mins(f.awayMinutes)} over ${f.distractions} departures · ${f.appInteractions} interactions with the app`);
    if (f.unverifiedMinutes > 0) lines.push(`- Unverified time (no window open): ${mins(f.unverifiedMinutes)}`);
    const e = f.endings;
    lines.push(`- Endings: ${e.completed} completed · ${e.stopped} stopped · ${e.switched} switched · ${e.abandoned} abandoned${e.unknown ? ` · ${e.unknown} legacy` : ''}`);
  }
  lines.push('');

  // ── Accomplishments ──
  lines.push('## Accomplishments');
  lines.push('');
  if (acc.tasksCompleted === 0) {
    lines.push('_No tasks completed this month._');
  } else {
    const bp = acc.byPriority;
    lines.push(`- **${acc.tasksCompleted} tasks completed** (${bp.urgent} urgent · ${bp.high} high · ${bp.medium} medium · ${bp.low} low); ${acc.tasksCreated} created, ${acc.tasksStillOpen} still open`);
    if (acc.estimationAccuracy.ratio !== null) {
      lines.push(`- Estimation: ${acc.estimationAccuracy.actual}m spent against ${acc.estimationAccuracy.estimated}m estimated (×${acc.estimationAccuracy.ratio})`);
    }
    lines.push('');
    for (const p of acc.byProject) {
      lines.push(`### ${p.projectName}`);
      lines.push('');
      for (const t of p.tasks) {
        const est = t.estimatedMinutes !== null ? `${t.actualMinutes}m / ${t.estimatedMinutes}m` : `${t.actualMinutes}m`;
        lines.push(`- [x] ${t.title} — ${t.completedOn}, ${t.priority}, ${est}`);
      }
      lines.push('');
    }
  }
  if (acc.tasksCompleted === 0) lines.push('');

  // ── Reflections ──
  lines.push('## Reflections');
  lines.push('');
  if (refl.journalDays === 0) {
    lines.push('_No journal entries this month._');
    lines.push('');
  } else {
    lines.push(`${refl.journalDays} journal days · average energy ${refl.avgEnergy} · average focus ${refl.avgFocus}`);
    lines.push('');
    lines.push('| Week | Days | Energy | Focus |');
    lines.push('|---|---|---|---|');
    for (const w of refl.ratingsByWeek) lines.push(`| ${w.weekStart} → ${w.weekEnd} | ${w.days} | ${w.energy ?? '–'} | ${w.focus ?? '–'} |`);
    lines.push('');
    for (const e of refl.entries) {
      lines.push(`### ${e.date} · ⚡${e.energyRating} 🎯${e.focusRating}`);
      lines.push('');
      if (e.intentions.length) {
        lines.push(`Intentions: ${e.intentions.map(i => `_${i}_`).join(' · ')}`);
        lines.push('');
      }
      if (e.retro.trim()) {
        lines.push(blockquote(e.retro.trim()));
        lines.push('');
      }
    }
  }

  // ── Thoughts ──
  lines.push('## Thoughts parked');
  lines.push('');
  const th = s.thoughts;
  if (th.captured === 0) {
    lines.push('_Nothing captured this month._');
  } else {
    lines.push(`- ${th.captured} captured (${th.capturedDuringFocus} during deep focus) → ${th.converted} became tasks · ${th.kept} kept · ${th.discarded} discarded · ${th.pendingInbox} still waiting`);
  }
  lines.push('');

  // ── Notes ──
  lines.push('## Notes');
  lines.push('');
  lines.push(`- ${s.notes.created} created · ${s.notes.updated} updated`);
  lines.push('');

  return lines.join('\n');
}
