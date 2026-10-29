/**
 * Deterministic, date-centric test-data generator.
 *
 * The dataset is "the world as of a date" (the anchor, default: today):
 *   - the three full months before the anchor's month, and
 *   - the anchor's month from the 1st up to and including the anchor day.
 *
 * Everything that happens on a date is derived from `hash(seed, date)`, so the
 * records for any given day are identical whichever day you run the generator;
 * running it again tomorrow simply adds tomorrow. State that spans days (which
 * task a block is logged against, when a task gets done) is fixed at the moment
 * the task is created, and a 45-day warm-up before the range makes the task
 * pool at the start of the range independent of where the range starts.
 *
 * Every record id lives in the `7e57da7a-…` namespace and is itself derived from
 * the date, so ids are stable too. Nothing here touches the file system.
 */
import type {
  DailyLog, DatabaseSchema, FocusSession, Link, Note, Project, SessionEndReason, Task, TaskPriority, TaskStatus, Thought,
} from '../../db/database.js';
import { emptySchema } from '../../db/database.js';
import { buildMentionIndex } from '../../db/links.js';
import { getBacklinks } from '../../db/graph.js';
import { addDays, addMonths, dayOfWeek, isValidDateString, todayInZone } from '../../db/time.js';
import { Prng, seedFor, testDataId, TESTDATA_NAMESPACE } from './prng.js';
import { INTENTIONS, NOTES, PROJECTS, RETROS, SESSION_NOTES, TAGS, THOUGHTS, UNASSIGNED_TASKS } from './content.js';

export type Profile = 'small' | 'standard' | 'large';

export interface GeneratorOptions {
  seed?: number;
  /** The "as of" day (YYYY-MM-DD). Default: today in `tz`. */
  anchor?: string;
  profile?: Profile;
  /** Zone for "today" and written into settings so server-side freezing buckets the same way. */
  tz?: string;
}

export interface Manifest {
  namespace: string;
  seed: number;
  anchor: string;
  profile: Profile;
  tz: string;
  /** Full months of history before the anchor's month. */
  monthsBack: number;
  from: string;
  to: string;
  warmupFrom: string;
  days: number;
  counts: Record<string, number>;
  ids: Record<string, string[]>;
  spotChecks: {
    overEstimateTaskId: string | null;
    noProjectTaskId: string | null;
    futureDueTaskId: string | null;
    convertedThoughtId: string | null;
    convertedTaskId: string | null;
    incompleteSessionId: string | null;
    lateNightSessionIds: string[];
    emptyMonth: string;
    /** Note with the most connections (mentions in either direction + explicit links). */
    mostConnectedNoteId: string | null;
  };
}

export const DEFAULT_SEED = 20240101;
/** Months of full history before the current month, per profile. */
export const PROFILE_MONTHS_BACK: Record<Profile, number> = { small: 0, standard: 3, large: 12 };
const WARMUP_DAYS = 45;
const ATTACH_WINDOW_DAYS = 30;
/** Mentions and links only reach back this far, so the choice never depends on where generation started. */
const MENTION_WINDOW_DAYS = 30;

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

function iso(date: string, hour: number, minute: number, second = 0): string {
  return `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.000Z`;
}

function dayOrdinal(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Internal task record with the dates that drive cross-day behaviour. */
interface TaskPlan {
  task: Task;
  createdOn: string;
  /** Day the task gets done (fixed at creation); undefined = stays open. */
  doneOn?: string;
  openStatus: TaskStatus;
}

export function resolveAnchor(anchor: string | undefined, tz: string): string {
  if (!anchor || anchor === 'today') return todayInZone(tz);
  if (!isValidDateString(anchor)) throw new Error(`anchor must be YYYY-MM-DD or "today", got ${anchor}`);
  return anchor;
}

export function generateDataset(options: GeneratorOptions = {}): { data: DatabaseSchema; manifest: Manifest } {
  const seed = options.seed ?? DEFAULT_SEED;
  const tz = options.tz ?? 'UTC';
  const anchor = resolveAnchor(options.anchor, tz);
  const profile = options.profile ?? 'standard';
  if (!(profile in PROFILE_MONTHS_BACK)) throw new Error(`profile must be one of ${Object.keys(PROFILE_MONTHS_BACK).join(', ')}`);

  const monthsBack = PROFILE_MONTHS_BACK[profile];
  const from = `${addMonths(anchor.slice(0, 7), -monthsBack)}-01`;
  const to = anchor;
  const warmupFrom = addDays(from, -WARMUP_DAYS);
  const id = (kind: string, key: string) => testDataId(seed, kind, key);
  const data = emptySchema();

  // ── Projects (fixed) ──
  const projects: Project[] = PROJECTS.map((p, i) => ({
    id: id('project', String(i)),
    name: p.name,
    color: p.color,
    description: p.description,
    archived: Boolean(p.archived),
    createdAt: iso(addDays(warmupFrom, -10), 9, 0),
  }));
  const activeProjects = projects.filter(p => !p.archived);
  const projectSpec = (projectId: string) => PROJECTS[projects.findIndex(p => p.id === projectId)];

  // ── Day by day ──
  const plans: TaskPlan[] = [];
  const sessions: FocusSession[] = [];
  const logs: DailyLog[] = [];
  const notes: Note[] = [];
  const thoughts: Thought[] = [];
  const links: Link[] = [];
  /** `doc` (note or task id) points at `target` (note or task id) through a mention or a link. */
  const references: { doc: string; target: string }[] = [];
  const inRange = (date: string) => date >= from && date <= to;

  const makeTask = (rng: Prng, key: string, title: string, projectId: string | undefined, createdOn: string, hour: number, slot: number): TaskPlan => {
    const willFinish = rng.chance(0.65);
    const span = rng.int(1, 20);
    const openStatus = rng.weighted<TaskStatus>([['todo', 3], ['in_progress', 1], ['backlog', 2]]);
    const task: Task = {
      id: id('task', key),
      projectId,
      title,
      description: rng.chance(0.5) ? `Context for “${title}”. Generated test data.` : '',
      status: openStatus,
      priority: rng.pick(PRIORITIES),
      estimatedMinutes: rng.pick([15, 25, 25, 50, 50, 90, 120]),
      actualMinutes: 0, // reconciled from the blocks logged against it
      tags: ['testdata', ...rng.sample(TAGS, rng.int(0, 2))],
      order: dayOrdinal(createdOn) * 10 + slot,
      createdAt: iso(createdOn, hour, rng.int(0, 59)),
    };
    const dueOffset = rng.int(3, 20);
    if (rng.chance(0.4)) task.dueDate = addDays(createdOn, dueOffset);
    // Every draw happens regardless of the anchor, otherwise the day's RNG stream
    // would depend on *when* the dataset is generated and break date-centricity.
    const doneHour = rng.int(13, 18);
    const doneMinute = rng.int(0, 59);
    const plan: TaskPlan = { task, createdOn, openStatus, doneOn: willFinish ? addDays(createdOn, span) : undefined };
    if (plan.doneOn && plan.doneOn <= to) {
      task.status = 'done';
      task.completedAt = iso(plan.doneOn, doneHour, doneMinute);
    }
    return plan;
  };

  for (let d = warmupFrom; d <= to; d = addDays(d, 1)) {
    const rng = new Prng(seedFor(seed, d));
    const ord = dayOrdinal(d);
    const dow = dayOfWeek(d);
    const weekend = dow === 0 || dow === 6;

    // Notes written in the last 30 days (always inside the warm-up, whatever the anchor)
    const recentNotes = notes.filter(n => n.createdAt.slice(0, 10) >= addDays(d, -MENTION_WINDOW_DAYS));

    // Tasks created today: 0–2 on weekdays, rarely at weekends
    const newTasks = weekend ? (rng.chance(0.15) ? 1 : 0) : rng.weighted([[0, 5], [1, 4], [2, 1]]);
    for (let i = 0; i < newTasks; i++) {
      const unassigned = rng.chance(0.08);
      const project = unassigned ? undefined : rng.pick(activeProjects);
      const pool = project ? projectSpec(project.id).tasks : UNASSIGNED_TASKS;
      const slot = (ord * 3 + i) % pool.length;
      const round = Math.floor((ord * 3 + i) / pool.length) % 7;
      const title = round === 0 ? pool[slot] : `${pool[slot]} (${round + 1})`;
      const plan = makeTask(rng, `${d}:${i}`, title, project?.id, d, rng.int(7, 11), i);
      // Connected thinking: one task in five points at a recent note. Both draws always
      // happen (even with nothing to pick) so the day's RNG stream never depends on history.
      const wantsNote = rng.chance(0.35);
      const note = rng.pick(recentNotes);
      if (wantsNote && note) {
        plan.task.description = `${plan.task.description ? plan.task.description + ' ' : ''}See [[note:${note.title}]].`;
        references.push({ doc: plan.task.id, target: note.id });
      }
      plans.push(plan);
    }

    // Focus blocks, attached to tasks open today and created within the last 30 days
    const candidates = plans
      .filter(p => p.task.projectId && p.createdOn <= d && p.createdOn >= addDays(d, -ATTACH_WINDOW_DAYS) && (!p.doneOn || p.doneOn >= d))
      .map(p => p.task);
    const blocks = weekend ? (rng.chance(0.3) ? 1 : 0) : rng.weighted([[0, 2], [1, 2], [2, 4], [3, 3], [4, 1]]);
    // Attention signals exist on blocks recorded by the server-owned timer; most days
    // have them, some (older imports, manual logs) do not. Decided per day, never by anchor.
    const signals = rng.chance(0.75);
    let hour = rng.int(8, 10);
    for (let b = 0; b < blocks; b++) {
      const task = candidates.length && rng.chance(0.85) ? rng.pick(candidates) : undefined;
      const planned = rng.pick([25, 25, 25, 50, 50, 90]);
      const endReason = rng.weighted<SessionEndReason>([['completed', 8], ['stopped', 1], ['switched', 1]]);
      const duration = endReason === 'completed' ? planned : Math.max(1, Math.round((planned * rng.int(30, 85)) / 100));
      const session: FocusSession = {
        id: id('session', `${d}:${b}`),
        taskId: task?.id,
        taskTitle: task?.title,
        durationMinutes: duration,
        plannedMinutes: planned,
        type: 'focus',
        notes: rng.pick(SESSION_NOTES),
        completed: endReason === 'completed',
        endReason,
        timestamp: iso(d, Math.min(hour, 21), rng.int(0, 30)),
      };
      session.endedAt = new Date(Date.parse(session.timestamp) + duration * 60_000).toISOString();
      if (signals) {
        const distractions = rng.weighted([[0, 5], [1, 3], [2, 2], [4, 1]]);
        session.integrity = {
          awayMs: distractions === 0 ? 0 : distractions * rng.int(20, 90) * 1000,
          distractions,
          appInteractions: rng.weighted([[0, 4], [1, 3], [3, 2], [8, 1]]),
          unverifiedMs: rng.chance(0.1) ? rng.int(1, 4) * 60_000 : 0,
        };
      }
      sessions.push(session);
      hour += Math.ceil(planned / 60) + 1;
      if (rng.chance(0.7)) {
        const breakMinutes = rng.pick([5, 5, 15]);
        sessions.push({
          id: id('session', `${d}:${b}:break`),
          durationMinutes: breakMinutes,
          plannedMinutes: breakMinutes,
          type: breakMinutes === 5 ? 'short_break' : 'long_break',
          notes: '',
          completed: true,
          endReason: 'completed',
          timestamp: iso(d, Math.min(hour, 22), 0),
        });
      }
    }
    // Occasionally a late-night block at 23:30 UTC — it lands on the next day in zones ahead of UTC
    if (rng.chance(0.05)) {
      const task = candidates.length ? rng.pick(candidates) : undefined;
      const late: FocusSession = {
        id: id('session', `${d}:late`),
        taskId: task?.id,
        taskTitle: task?.title,
        durationMinutes: 25,
        plannedMinutes: 25,
        type: 'focus',
        notes: 'Late night block (23:30 UTC)',
        completed: true,
        endReason: 'completed',
        timestamp: iso(d, 23, 30),
      };
      late.endedAt = new Date(Date.parse(late.timestamp) + 25 * 60_000).toISOString();
      sessions.push(late);
    }

    // Journal on ~70% of days
    if (rng.chance(0.7)) {
      logs.push({
        id: id('log', d),
        date: d,
        intentions: rng.sample(INTENTIONS, rng.int(1, 3)),
        retro: rng.pick(RETROS),
        energyRating: rng.weighted([[1, 1], [2, 2], [3, 4], [4, 4], [5, 2]]),
        focusRating: rng.weighted([[1, 1], [2, 2], [3, 3], [4, 4], [5, 3]]),
        notes: '',
        updatedAt: iso(d, 21, rng.int(0, 59)),
      });
    }

    // Notes: roughly one weekday in four; one in three gets edited some weeks later
    if (rng.chance(weekend ? 0.08 : 0.25)) {
      const spec = NOTES[ord % NOTES.length];
      // Titles cycle like task titles do, so most mentions resolve unambiguously.
      const noteRound = Math.floor(ord / NOTES.length) % 26;
      const title = noteRound === 0 ? spec.title : `${spec.title} (${noteRound + 1})`;
      const createdAt = iso(d, rng.int(9, 17), rng.int(0, 59));
      const editedOn = addDays(d, rng.int(5, 40));
      const edited = rng.chance(0.34);
      const updatedAt = edited && editedOn <= to ? iso(editedOn, 10, 15) : createdAt;
      // Connected thinking: most notes mention a task open today, some an earlier note.
      const noteId = id('note', d);
      let content = spec.content;
      const related: string[] = [];
      // One to three distinct tasks (draws are fixed in number, whatever is available).
      const taskMentions = rng.weighted([[0, 1], [1, 4], [2, 3], [3, 2]]);
      const picked = new Set<string>();
      for (let k = 0; k < 3; k++) {
        const task = rng.pick(candidates);
        if (k < taskMentions && task && !picked.has(task.id)) {
          picked.add(task.id);
          related.push(`[[task:${task.title}]]`);
          references.push({ doc: noteId, target: task.id });
        }
      }
      const wantsNote = rng.chance(0.5);
      const earlier = rng.pick(recentNotes);
      if (wantsNote && earlier && earlier.title !== title) {
        related.push(`[[${earlier.title}]]`);
        references.push({ doc: noteId, target: earlier.id });
      }
      if (related.length) content += `\n\nRelated: ${related.join(', ')}`;
      notes.push({ id: noteId, title, content, tags: ['testdata', ...spec.tags], pinned: Boolean(spec.pinned), createdAt, updatedAt });
    }

    // Explicit "Link to…" links: now and then a note is linked to a task by hand
    // Explicit "Link to…" links: a note linked to a task (or to another note) by hand on one weekday in five
    const wantsLink = rng.chance(weekend ? 0.05 : 0.2);
    const linkNote = rng.pick(recentNotes);
    const linkTask = rng.pick(candidates);
    const linkOther = rng.pick(recentNotes);
    const toNote = rng.chance(0.3);
    const linkHour = rng.int(9, 18);
    const linkMinute = rng.int(0, 59);
    if (wantsLink && linkNote) {
      const target = toNote
        ? (linkOther && linkOther.id !== linkNote.id ? { type: 'note' as const, id: linkOther.id, label: linkOther.title } : null)
        : (linkTask ? { type: 'task' as const, id: linkTask.id, label: linkTask.title } : null);
      if (target) {
        links.push({
          id: id('link', d),
          from: { type: 'note', id: linkNote.id },
          to: { type: target.type, id: target.id },
          kind: 'link',
          fromLabel: linkNote.title,
          toLabel: target.label,
          createdAt: iso(d, linkHour, linkMinute),
        });
        references.push({ doc: linkNote.id, target: target.id });
      }
    }

    // Thoughts: 0–2 a day, mostly parked during a block
    const todaysBlocks = sessions.filter(s => s.type === 'focus' && s.timestamp.startsWith(d));
    const thoughtCount = rng.weighted([[0, 6], [1, 3], [2, 1]]);
    for (let i = 0; i < thoughtCount; i++) {
      let text = THOUGHTS[(ord * 2 + i) % THOUGHTS.length];
      const block = todaysBlocks.length && rng.chance(0.75) ? rng.pick(todaysBlocks) : undefined;
      const capturedAt = block
        ? new Date(Date.parse(block.timestamp) + rng.int(2, 20) * 60_000).toISOString()
        : iso(d, rng.int(8, 20), rng.int(0, 59));
      const status = rng.weighted<Thought['status']>([['inbox', 3], ['kept', 2], ['converted', 2], ['discarded', 2]]);
      // One thought in four points at a recent note (never a converted one: its text becomes the task title).
      const wantsMention = rng.chance(0.25);
      const mentioned = rng.pick(recentNotes);
      const thoughtId = id('thought', `${d}:${i}`);
      if (wantsMention && mentioned && status !== 'converted') {
        text = `${text} — see [[note:${mentioned.title}]]`;
        references.push({ doc: thoughtId, target: mentioned.id });
      }
      const thought: Thought = {
        id: thoughtId,
        text,
        status,
        capturedAt,
        context: block
          ? { view: 'today', timerRunning: true, timerType: 'focus', taskId: block.taskId, taskTitle: block.taskTitle }
          : { view: rng.pick(['board', 'journal', 'notes']), timerRunning: false },
      };
      if (status !== 'inbox') thought.reviewedAt = new Date(Date.parse(capturedAt) + rng.int(5, 180) * 60_000).toISOString();
      if (status === 'converted') {
        const plan = makeTask(rng, `${d}:thought:${i}`, text, projects[0].id, d, 12, 5 + i);
        plan.task.createdAt = thought.reviewedAt!;
        plan.task.tags = ['testdata', 'from-thought'];
        plans.push(plan);
        thought.taskId = plan.task.id;
      }
      thoughts.push(thought);
    }
  }

  // ── Keep the range; keep warm-up tasks only when the range refers to them or they got done in it ──
  const rangeSessions = sessions.filter(s => inRange(s.timestamp.slice(0, 10)));
  const rangeThoughts = thoughts.filter(t => inRange(t.capturedAt.slice(0, 10)));
  const rangeLinks = links.filter(l => inRange(l.createdAt.slice(0, 10)));
  const referenced = new Set<string>();
  for (const s of rangeSessions) if (s.taskId) referenced.add(s.taskId);
  for (const t of rangeThoughts) {
    if (t.taskId) referenced.add(t.taskId);
    if (t.context?.taskId) referenced.add(t.context.taskId);
  }
  // Whatever is kept may mention (or be linked to) a warm-up note or task; keep those
  // too, to a fixed point, so every generated mention and link resolves.
  const kept = new Set<string>(referenced);
  for (const p of plans) if (inRange(p.createdOn) || (p.doneOn !== undefined && inRange(p.doneOn))) kept.add(p.task.id);
  for (const n of notes) if (inRange(n.createdAt.slice(0, 10))) kept.add(n.id);
  for (const t of rangeThoughts) kept.add(t.id); // thoughts can mention notes too
  for (const l of rangeLinks) { kept.add(l.from.id); kept.add(l.to.id); }
  for (let changed = true; changed;) {
    changed = false;
    for (const r of references) {
      if (kept.has(r.doc) && !kept.has(r.target)) { kept.add(r.target); changed = true; }
    }
  }
  const tasks = plans.filter(p => kept.has(p.task.id)).map(p => p.task);
  const byId = new Map(tasks.map(t => [t.id, t]));
  for (const s of rangeSessions) {
    if (s.type === 'focus' && s.taskId) byId.get(s.taskId)!.actualMinutes += s.durationMinutes;
  }
  for (const t of rangeThoughts) {
    if (t.context?.taskId && !byId.has(t.context.taskId)) {
      delete t.context.taskId;
      delete t.context.taskTitle;
    }
  }

  rangeSessions.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
  tasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  data.projects.push(...projects);
  data.tasks.push(...tasks);
  data.focusSessions.push(...rangeSessions);
  data.dailyLogs.push(...logs.filter(l => inRange(l.date)));
  data.notes.push(...notes.filter(n => kept.has(n.id)));
  data.thoughts.push(...rangeThoughts.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)));
  data.links.push(...rangeLinks);
  data.settings = { timeZone: tz };

  // ── Spot checks (found, not forced, so they stay date-centric) ──
  const over = tasks
    .filter(t => typeof t.estimatedMinutes === 'number' && t.actualMinutes > t.estimatedMinutes)
    .sort((a, b) => (b.actualMinutes - (b.estimatedMinutes || 0)) - (a.actualMinutes - (a.estimatedMinutes || 0)) || a.id.localeCompare(b.id))[0];
  const noProject = tasks.find(t => !t.projectId);
  const futureDue = tasks.filter(t => t.status !== 'done' && t.dueDate && t.dueDate > to).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))[0];
  const converted = data.thoughts.find(t => t.status === 'converted' && t.taskId);
  const incomplete = [...rangeSessions].reverse().find(s => s.type === 'focus' && !s.completed);
  const lateNight = rangeSessions.filter(s => s.type === 'focus' && s.timestamp.includes('T23:30:00'));
  const mentionIndex = buildMentionIndex(data);
  const mostConnected = data.notes
    .map(n => ({ id: n.id, count: getBacklinks(data, { type: 'note', id: n.id }, mentionIndex).connections.length }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))[0];

  const ids: Record<string, string[]> = {
    projects: data.projects.map(p => p.id),
    tasks: data.tasks.map(t => t.id),
    focusSessions: data.focusSessions.map(s => s.id),
    dailyLogs: data.dailyLogs.map(l => l.id),
    notes: data.notes.map(n => n.id),
    thoughts: data.thoughts.map(t => t.id),
    links: data.links.map(l => l.id),
  };
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(ids)) counts[k] = v.length;

  const manifest: Manifest = {
    namespace: TESTDATA_NAMESPACE,
    seed,
    anchor,
    profile,
    tz,
    monthsBack,
    from,
    to,
    warmupFrom,
    days: dayOrdinal(to) - dayOrdinal(from) + 1,
    counts,
    ids,
    spotChecks: {
      overEstimateTaskId: over?.id ?? null,
      noProjectTaskId: noProject?.id ?? null,
      futureDueTaskId: futureDue?.id ?? null,
      convertedThoughtId: converted?.id ?? null,
      convertedTaskId: converted?.taskId ?? null,
      incompleteSessionId: incomplete?.id ?? null,
      lateNightSessionIds: lateNight.map(s => s.id),
      // Before the warm-up: nothing at all exists there.
      emptyMonth: addMonths(warmupFrom.slice(0, 7), -2),
      mostConnectedNoteId: mostConnected && mostConnected.count > 0 ? mostConnected.id : null,
    },
  };
  return { data, manifest };
}
