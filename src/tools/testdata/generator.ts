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
  DailyLog, DatabaseSchema, FocusSession, Note, Project, SessionEndReason, Task, TaskPriority, TaskStatus, Thought,
} from '../../db/database.js';
import { emptySchema } from '../../db/database.js';
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
  };
}

export const DEFAULT_SEED = 20240101;
/** Months of full history before the current month, per profile. */
export const PROFILE_MONTHS_BACK: Record<Profile, number> = { small: 0, standard: 3, large: 12 };
const WARMUP_DAYS = 45;
const ATTACH_WINDOW_DAYS = 30;

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

    // Tasks created today: 0–2 on weekdays, rarely at weekends
    const newTasks = weekend ? (rng.chance(0.15) ? 1 : 0) : rng.weighted([[0, 5], [1, 4], [2, 1]]);
    for (let i = 0; i < newTasks; i++) {
      const unassigned = rng.chance(0.08);
      const project = unassigned ? undefined : rng.pick(activeProjects);
      const pool = project ? projectSpec(project.id).tasks : UNASSIGNED_TASKS;
      const slot = (ord * 3 + i) % pool.length;
      const round = Math.floor((ord * 3 + i) / pool.length) % 7;
      const title = round === 0 ? pool[slot] : `${pool[slot]} (${round + 1})`;
      plans.push(makeTask(rng, `${d}:${i}`, title, project?.id, d, rng.int(7, 11), i));
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

    // Notes: a new one now and then; one in twelve gets edited 25 days later
    if (rng.chance(0.1)) {
      const spec = NOTES[ord % NOTES.length];
      const createdAt = iso(d, rng.int(9, 17), rng.int(0, 59));
      const editedOn = addDays(d, 25);
      const updatedAt = ord % 12 === 1 && editedOn <= to ? iso(editedOn, 10, 15) : createdAt;
      notes.push({ id: id('note', d), title: spec.title, content: spec.content, tags: ['testdata', ...spec.tags], pinned: Boolean(spec.pinned), createdAt, updatedAt });
    }

    // Thoughts: 0–2 a day, mostly parked during a block
    const todaysBlocks = sessions.filter(s => s.type === 'focus' && s.timestamp.startsWith(d));
    const thoughtCount = rng.weighted([[0, 6], [1, 3], [2, 1]]);
    for (let i = 0; i < thoughtCount; i++) {
      const text = THOUGHTS[(ord * 2 + i) % THOUGHTS.length];
      const block = todaysBlocks.length && rng.chance(0.75) ? rng.pick(todaysBlocks) : undefined;
      const capturedAt = block
        ? new Date(Date.parse(block.timestamp) + rng.int(2, 20) * 60_000).toISOString()
        : iso(d, rng.int(8, 20), rng.int(0, 59));
      const status = rng.weighted<Thought['status']>([['inbox', 3], ['kept', 2], ['converted', 2], ['discarded', 2]]);
      const thought: Thought = {
        id: id('thought', `${d}:${i}`),
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
  const referenced = new Set<string>();
  for (const s of rangeSessions) if (s.taskId) referenced.add(s.taskId);
  for (const t of rangeThoughts) {
    if (t.taskId) referenced.add(t.taskId);
    if (t.context?.taskId) referenced.add(t.context.taskId);
  }
  const tasks = plans
    .filter(p => inRange(p.createdOn) || referenced.has(p.task.id) || (p.doneOn !== undefined && inRange(p.doneOn)))
    .map(p => p.task);
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
  data.notes.push(...notes.filter(n => inRange(n.createdAt.slice(0, 10))));
  data.thoughts.push(...rangeThoughts.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)));
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

  const ids: Record<string, string[]> = {
    projects: data.projects.map(p => p.id),
    tasks: data.tasks.map(t => t.id),
    focusSessions: data.focusSessions.map(s => s.id),
    dailyLogs: data.dailyLogs.map(l => l.id),
    notes: data.notes.map(n => n.id),
    thoughts: data.thoughts.map(t => t.id),
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
    },
  };
  return { data, manifest };
}
