import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT_TZ, DAY_NAMES, addDays, dayOfWeek, dateInZone, todayInZone } from './time.js';

export interface Project {
  id: string;
  name: string;
  color: string;
  description: string;
  archived: boolean;
  createdAt: string;
}

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Task {
  id: string;
  projectId?: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string;
  estimatedMinutes?: number;
  actualMinutes: number;
  tags: string[];
  completedAt?: string;
  order: number;
  createdAt: string;
}

export type TimerType = 'focus' | 'short_break' | 'long_break';

/** Why a timer stopped. `completed` = ran to the planned end. */
export type SessionEndReason = 'completed' | 'stopped' | 'switched' | 'abandoned';

/** Attention signals collected while a focus block ran (advisory, client-reported). */
export interface SessionIntegrity {
  /** Milliseconds the HeyWork tab was hidden or the window unfocused. */
  awayMs: number;
  /** Times the user left the tab/window. */
  distractions: number;
  /** Clicks/keystrokes inside HeyWork itself — i.e. tinkering with the app. */
  appInteractions: number;
  /** Time at the end of the block with no sign of life from any client. */
  unverifiedMs?: number;
}

export interface FocusSession {
  id: string;
  taskId?: string;
  taskTitle?: string;
  /** Minutes actually spent (paused time excluded). */
  durationMinutes: number;
  /** Minutes the block was planned for (absent on legacy records). */
  plannedMinutes?: number;
  type: TimerType;
  notes?: string;
  /** True when the planned duration was reached. */
  completed: boolean;
  endReason?: SessionEndReason;
  /** Start of the block (legacy records used the time the session was logged). */
  timestamp: string;
  endedAt?: string;
  integrity?: SessionIntegrity;
}

/**
 * The one timer the app can have running. Lives in the store (not in the browser)
 * so it survives reloads, navigation and crashes, and so the server can finalise
 * it even when no page is open.
 */
export interface ActiveTimer {
  id: string;
  type: TimerType;
  taskId?: string;
  taskTitle?: string;
  plannedMinutes: number;
  startedAt: string;
  /** Accumulated running time from previous run segments. */
  accumulatedMs: number;
  /** ISO time the current run segment began; absent while paused. */
  runningSince?: string;
  /** Last sign of life from a client. */
  lastHeartbeatAt: string;
  integrity: SessionIntegrity;
  notes?: string;
}

export interface DailyLog {
  id: string;
  date: string; // YYYY-MM-DD
  intentions: string[];
  retro: string;
  energyRating: number; // 1-5
  focusRating: number;  // 1-5
  notes: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ThoughtStatus = 'inbox' | 'kept' | 'converted' | 'discarded';

export interface ThoughtContext {
  view: string;
  timerRunning: boolean;
  timerType?: 'focus' | 'short_break' | 'long_break';
  taskId?: string;
  taskTitle?: string;
}

/** A stray thought parked during focus; triaged later (Phase 1). */
export interface Thought {
  id: string;
  text: string;
  status: ThoughtStatus;
  capturedAt: string;
  reviewedAt?: string;
  context?: ThoughtContext;
  taskId?: string;
}

/** Frozen, auto-generated month page of the Book of Work (Phase 2). */
export interface MonthlySummaryRecord {
  id: string;
  month: string;        // YYYY-MM
  timeZone: string;     // zone the month was bucketed in
  generatedAt: string;  // ISO UTC
  summary: unknown;     // MonthlySummary payload (typed in summary.ts)
}

export interface Settings {
  /** Last IANA zone seen from a client; used by server-side jobs that have no client. */
  timeZone?: string;
}

export interface DatabaseSchema {
  projects: Project[];
  tasks: Task[];
  focusSessions: FocusSession[];
  dailyLogs: DailyLog[];
  notes: Note[];
  thoughts: Thought[];
  monthlySummaries: MonthlySummaryRecord[];
  settings: Settings;
  /** The timer currently running or paused, if any. */
  activeTimer: ActiveTimer | null;
}

export function emptySchema(): DatabaseSchema {
  return {
    projects: [],
    tasks: [],
    focusSessions: [],
    dailyLogs: [],
    notes: [],
    thoughts: [],
    monthlySummaries: [],
    settings: {},
    activeTimer: null,
  };
}

/**
 * Storage codec seam. The data file is plain JSON today; an encrypting codec
 * (e.g. AES-256-GCM with a passphrase-derived key) can be plugged in here
 * later without touching the rest of the database.
 */
export interface StorageCodec {
  encode(data: DatabaseSchema): string | Buffer;
  decode(raw: Buffer): unknown;
}

export const jsonCodec: StorageCodec = {
  encode: (data) => JSON.stringify(data, null, 2),
  decode: (raw) => JSON.parse(raw.toString('utf-8')),
};

export class DatabaseFileError extends Error {
  constructor(message: string, public readonly filePath: string) {
    super(message);
    this.name = 'DatabaseFileError';
  }
}

export interface DatabaseOptions {
  codec?: StorageCodec;
}

export const DEFAULT_DATA_FILE = () => path.join(process.cwd(), 'data', 'database.json');

const ARRAY_COLLECTIONS = ['projects', 'tasks', 'focusSessions', 'dailyLogs', 'notes', 'thoughts', 'monthlySummaries'] as const;

/** Normalises a parsed file into a full schema; throws on shapes that are not a HeyWork store. */
export function normaliseSchema(parsed: unknown, filePath = '<memory>'): DatabaseSchema {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DatabaseFileError('Data file is not a JSON object', filePath);
  }
  const src = parsed as Record<string, unknown>;
  const out = emptySchema();
  for (const key of ARRAY_COLLECTIONS) {
    const v = src[key];
    if (v === undefined || v === null) continue; // older file without this collection
    if (!Array.isArray(v)) throw new DatabaseFileError(`Collection "${key}" is not an array`, filePath);
    (out as any)[key] = v;
  }
  if (src.settings !== undefined && src.settings !== null) {
    if (typeof src.settings !== 'object' || Array.isArray(src.settings)) {
      throw new DatabaseFileError('"settings" is not an object', filePath);
    }
    out.settings = src.settings as Settings;
  }
  if (src.activeTimer !== undefined && src.activeTimer !== null) {
    if (typeof src.activeTimer !== 'object' || Array.isArray(src.activeTimer)) {
      throw new DatabaseFileError('"activeTimer" is not an object', filePath);
    }
    out.activeTimer = src.activeTimer as ActiveTimer;
  }
  return out;
}

export class Database {
  private data: DatabaseSchema = emptySchema();
  private filePath: string;
  private codec: StorageCodec;
  private initialized = false;

  constructor(filePath?: string, options: DatabaseOptions = {}) {
    this.filePath = filePath || process.env.HEYW_DATA_FILE || DEFAULT_DATA_FILE();
    this.codec = options.codec || jsonCodec;
  }

  /** Absolute path of the backing file. */
  get file(): string {
    return this.filePath;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Points the instance at a different file and drops in-memory state.
   * Used by `createServer({ dataFile })` and by tests; must be followed by `init()`.
   */
  useFile(filePath: string, options: DatabaseOptions = {}): void {
    this.filePath = filePath;
    if (options.codec) this.codec = options.codec;
    this.data = emptySchema();
    this.initialized = false;
  }

  /**
   * Loads the data file. A *missing* file is a fresh install and gets the welcome
   * seed; an *unreadable or malformed* file is never overwritten — we refuse to
   * start instead so that no data is lost (see workbook finding F4).
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });

    let raw: Buffer | null = null;
    try {
      raw = await fs.readFile(this.filePath);
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        throw new DatabaseFileError(`Cannot read data file: ${err?.message || err}`, this.filePath);
      }
    }

    if (raw === null) {
      // Initialize with seed data for a warm, ready-to-use first experience
      this.seedInitialData();
      await this.persist();
    } else {
      let parsed: unknown;
      try {
        parsed = this.codec.decode(raw);
      } catch (err: any) {
        throw new DatabaseFileError(
          `Data file is corrupt or not in the expected format (${err?.message || err}). ` +
          'The file was left untouched; fix or move it and start again.',
          this.filePath,
        );
      }
      this.data = normaliseSchema(parsed, this.filePath);
    }
    this.initialized = true;
  }

  /**
   * Atomic write: temp file + rename. Files are created owner-only (0600) so that
   * other accounts on a shared machine cannot read the store (no-op on Windows).
   */
  async persist(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const tempFile = `${this.filePath}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(tempFile, this.codec.encode(this.data), { mode: 0o600 });
      await fs.rename(tempFile, this.filePath);
    } catch (err) {
      await fs.rm(tempFile, { force: true }).catch(() => {});
      throw err;
    }
  }

  /** Read-only snapshot of the whole store (used by summaries and tooling). */
  snapshot(): Readonly<DatabaseSchema> {
    return this.data;
  }

  /**
   * In-memory instance over an existing schema object (tooling, reports, tests).
   * Not backed by a file: `persist()` would write to the default path, so callers
   * should treat it as read-only.
   */
  static fromSnapshot(data: DatabaseSchema): Database {
    const db = new Database(path.join('/dev/null', 'in-memory.json'));
    db.data = normaliseSchema(data);
    db.initialized = true;
    return db;
  }

  // ── Settings ──
  getSettings(): Settings {
    return { ...this.data.settings };
  }

  /** Remembers the client's zone so server-side jobs can bucket months the same way. Returns true when changed. */
  rememberTimeZone(tz: string): boolean {
    if (this.data.settings.timeZone === tz) return false;
    this.data.settings.timeZone = tz;
    return true;
  }

  private seedInitialData() {
    const now = new Date().toISOString();
    const today = now.slice(0, 10);

    const defaultProject: Project = {
      id: crypto.randomUUID(),
      name: 'General',
      color: '#4f46e5',
      description: 'Default project for everyday tasks and focus',
      archived: false,
      createdAt: now,
    };

    const initialTasks: Task[] = [
      {
        id: crypto.randomUUID(),
        projectId: defaultProject.id,
        title: 'Welcome to HeyWork! Plan your day ☕',
        description: 'Set your morning intention, pick your top 3 tasks, and start a focus session.',
        status: 'todo',
        priority: 'high',
        dueDate: today,
        estimatedMinutes: 25,
        actualMinutes: 0,
        tags: ['starter', 'planning'],
        order: 0,
        createdAt: now,
      },
      {
        id: crypto.randomUUID(),
        projectId: defaultProject.id,
        title: 'Try the 25-minute Pomodoro focus timer',
        description: 'Click on the Focus tab, turn on gentle rain or brown noise, and enter flow state.',
        status: 'todo',
        priority: 'medium',
        dueDate: today,
        estimatedMinutes: 25,
        actualMinutes: 0,
        tags: ['focus'],
        order: 1,
        createdAt: now,
      },
      {
        id: crypto.randomUUID(),
        projectId: defaultProject.id,
        title: 'Review today in the Evening Retrospective',
        description: 'Log your 3 wins, reflections, and rate your focus & energy.',
        status: 'backlog',
        priority: 'low',
        dueDate: today,
        estimatedMinutes: 10,
        actualMinutes: 0,
        tags: ['retro'],
        order: 2,
        createdAt: now,
      },
    ];

    const initialNote: Note = {
      id: crypto.randomUUID(),
      title: 'Quick Scratchpad & Guidelines',
      content: `# Welcome to HeyWork\n\n*A calm, distraction-free companion for deep work.*\n\n### Core Workflows\n- **Today**: Time-block and execute your high-priority items.\n- **Focus**: Native flow timer with ambient sounds (synthesized live via Web Audio, zero external assets).\n- **Board**: Kanban view to organize work into Backlog, Todo, In Progress, and Done.\n- **Journal**: Intentional morning planning and mindful evening reflections.\n- **Insights**: Canvas-based visual heatmaps and streaks to track consistency over time.`,
      tags: ['guide', 'readme'],
      pinned: true,
      createdAt: now,
      updatedAt: now,
    };

    const initialLog: DailyLog = {
      id: crypto.randomUUID(),
      date: today,
      intentions: [
        'Complete today’s top deep work session',
        'Review priorities without distractions',
        'Reflect on progress in the evening',
      ],
      retro: 'Excited to start fresh with a calm, focused workspace.',
      energyRating: 4,
      focusRating: 4,
      notes: 'Initial day setup in HeyWork.',
      updatedAt: now,
    };

    this.data.projects.push(defaultProject);
    this.data.tasks.push(...initialTasks);
    this.data.notes.push(initialNote);
    this.data.dailyLogs.push(initialLog);
  }

  // ── Projects CRUD ──
  getProjects(includeArchived = false): Project[] {
    if (includeArchived) return [...this.data.projects];
    return this.data.projects.filter(p => !p.archived);
  }

  getProject(id: string): Project | undefined {
    return this.data.projects.find(p => p.id === id);
  }

  createProject(item: Omit<Project, 'id' | 'createdAt'>): Project {
    const project: Project = {
      ...item,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.data.projects.push(project);
    return project;
  }

  updateProject(id: string, updates: Partial<Project>): Project | null {
    const idx = this.data.projects.findIndex(p => p.id === id);
    if (idx === -1) return null;
    this.data.projects[idx] = { ...this.data.projects[idx], ...updates };
    return this.data.projects[idx];
  }

  deleteProject(id: string): boolean {
    const idx = this.data.projects.findIndex(p => p.id === id);
    if (idx === -1) return false;
    this.data.projects.splice(idx, 1);
    // Unlink tasks from deleted project
    for (const task of this.data.tasks) {
      if (task.projectId === id) {
        delete task.projectId;
      }
    }
    return true;
  }

  // ── Tasks CRUD ──
  getTasks(filters?: { status?: TaskStatus; projectId?: string; tag?: string }): Task[] {
    let result = [...this.data.tasks];
    if (filters?.status) result = result.filter(t => t.status === filters.status);
    if (filters?.projectId) result = result.filter(t => t.projectId === filters.projectId);
    if (filters?.tag) result = result.filter(t => t.tags.includes(filters.tag!));
    return result.sort((a, b) => a.order - b.order);
  }

  getTask(id: string): Task | undefined {
    return this.data.tasks.find(t => t.id === id);
  }

  createTask(item: Omit<Task, 'id' | 'actualMinutes' | 'order' | 'createdAt'>): Task {
    const now = new Date().toISOString();
    const currentMaxOrder = this.data.tasks.reduce((max, t) => Math.max(max, t.order), -1);
    const task: Task = {
      ...item,
      id: crypto.randomUUID(),
      actualMinutes: 0,
      order: currentMaxOrder + 1,
      createdAt: now,
      completedAt: item.status === 'done' ? now : undefined,
    };
    this.data.tasks.push(task);
    return task;
  }

  updateTask(id: string, updates: Partial<Task>): Task | null {
    const idx = this.data.tasks.findIndex(t => t.id === id);
    if (idx === -1) return null;
    const prevStatus = this.data.tasks[idx].status;
    const task = { ...this.data.tasks[idx], ...updates };
    if (updates.status === 'done' && prevStatus !== 'done') {
      task.completedAt = new Date().toISOString();
    } else if (updates.status && updates.status !== 'done') {
      delete task.completedAt;
    }
    this.data.tasks[idx] = task;
    return task;
  }

  deleteTask(id: string): boolean {
    const idx = this.data.tasks.findIndex(t => t.id === id);
    if (idx === -1) return false;
    this.data.tasks.splice(idx, 1);
    return true;
  }

  reorderTasks(taskIds: string[]): boolean {
    taskIds.forEach((id, index) => {
      const t = this.data.tasks.find(task => task.id === id);
      if (t) t.order = index;
    });
    return true;
  }

  // ── Focus Sessions ──
  getFocusSessions(limit = 100): FocusSession[] {
    return [...this.data.focusSessions]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  /**
   * Records a focus/break block. `timestamp` (block start) may be supplied by the
   * timer engine; otherwise "now" is used. Task time is credited with the minutes
   * actually spent, whether or not the planned duration was reached — a 20-minute
   * block that was cut short is still 20 minutes of real work.
   */
  logFocusSession(session: Omit<FocusSession, 'id' | 'timestamp'> & { timestamp?: string }): FocusSession {
    const newSession: FocusSession = {
      ...session,
      id: crypto.randomUUID(),
      timestamp: session.timestamp || new Date().toISOString(),
    };
    this.data.focusSessions.push(newSession);

    // If attached to a task, credit the minutes actually spent
    if (session.taskId && session.type === 'focus' && session.durationMinutes > 0) {
      const task = this.data.tasks.find(t => t.id === session.taskId);
      if (task) {
        task.actualMinutes = (task.actualMinutes || 0) + session.durationMinutes;
      }
    }
    return newSession;
  }

  // ── Active timer ──
  getActiveTimer(): ActiveTimer | null {
    return this.data.activeTimer;
  }

  setActiveTimer(timer: ActiveTimer | null): void {
    this.data.activeTimer = timer;
  }

  // ── Daily Logs ──
  getDailyLog(date: string): DailyLog | undefined {
    return this.data.dailyLogs.find(l => l.date === date);
  }

  getDailyLogs(limit = 30): DailyLog[] {
    return [...this.data.dailyLogs]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, limit);
  }

  upsertDailyLog(log: Omit<DailyLog, 'id' | 'updatedAt'>): DailyLog {
    const now = new Date().toISOString();
    const existing = this.data.dailyLogs.find(l => l.date === log.date);
    if (existing) {
      Object.assign(existing, {
        intentions: log.intentions,
        retro: log.retro,
        energyRating: log.energyRating,
        focusRating: log.focusRating,
        notes: log.notes,
        updatedAt: now,
      });
      return existing;
    }
    const newLog: DailyLog = {
      ...log,
      id: crypto.randomUUID(),
      updatedAt: now,
    };
    this.data.dailyLogs.push(newLog);
    return newLog;
  }

  // ── Notes ──
  getNotes(tag?: string, query?: string): Note[] {
    let result = [...this.data.notes];
    if (tag) result = result.filter(n => n.tags.includes(tag));
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(n => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
    }
    return result.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }

  getNote(id: string): Note | undefined {
    return this.data.notes.find(n => n.id === id);
  }

  createNote(item: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>): Note {
    const now = new Date().toISOString();
    const note: Note = {
      ...item,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.data.notes.push(note);
    return note;
  }

  updateNote(id: string, updates: Partial<Note>): Note | null {
    const idx = this.data.notes.findIndex(n => n.id === id);
    if (idx === -1) return null;
    this.data.notes[idx] = {
      ...this.data.notes[idx],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    return this.data.notes[idx];
  }

  deleteNote(id: string): boolean {
    const idx = this.data.notes.findIndex(n => n.id === id);
    if (idx === -1) return false;
    this.data.notes.splice(idx, 1);
    return true;
  }

  // ── Thoughts (capture & triage) ──
  //
  // A thought is parked in one keystroke during a focus block and triaged later:
  // turned into a task, kept for later, or discarded. Discarding only hides it —
  // nothing is ever deleted, so a thought can always be brought back.

  getThoughts(filters?: { status?: ThoughtStatus }): Thought[] {
    let result = [...this.data.thoughts];
    if (filters?.status) result = result.filter(t => t.status === filters.status);
    return result.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  }

  getThought(id: string): Thought | undefined {
    return this.data.thoughts.find(t => t.id === id);
  }

  countThoughts(status: ThoughtStatus): number {
    return this.data.thoughts.filter(t => t.status === status).length;
  }

  createThought(input: { text: string; context?: ThoughtContext }): Thought {
    const thought: Thought = {
      id: crypto.randomUUID(),
      text: input.text,
      status: 'inbox',
      capturedAt: new Date().toISOString(),
      context: input.context,
    };
    this.data.thoughts.push(thought);
    return thought;
  }

  updateThought(id: string, updates: { text?: string; status?: ThoughtStatus }): Thought | null {
    const thought = this.getThought(id);
    if (!thought) return null;
    if (typeof updates.text === 'string') thought.text = updates.text;
    if (updates.status && updates.status !== thought.status) {
      thought.status = updates.status;
      // Coming back to the inbox means it is untriaged again.
      if (updates.status === 'inbox') {
        delete thought.reviewedAt;
      } else {
        thought.reviewedAt = new Date().toISOString();
      }
    }
    return thought;
  }

  /** Turns a thought into a task and links the two. */
  convertThoughtToTask(
    id: string,
    taskInput: Partial<Omit<Task, 'id' | 'actualMinutes' | 'order' | 'createdAt'>> = {},
  ): { thought: Thought; task: Task } | null {
    const thought = this.getThought(id);
    if (!thought) return null;
    const task = this.createTask({
      projectId: taskInput.projectId,
      title: (taskInput.title || thought.text).trim(),
      description: taskInput.description || '',
      status: taskInput.status || 'todo',
      priority: taskInput.priority || 'medium',
      dueDate: taskInput.dueDate,
      estimatedMinutes: taskInput.estimatedMinutes ?? 25,
      tags: taskInput.tags || [],
    });
    thought.status = 'converted';
    thought.taskId = task.id;
    thought.reviewedAt = new Date().toISOString();
    return { thought, task };
  }

  /** Tooling/test only: thoughts are never deleted through the UI. */
  deleteThought(id: string): boolean {
    const idx = this.data.thoughts.findIndex(t => t.id === id);
    if (idx === -1) return false;
    this.data.thoughts.splice(idx, 1);
    return true;
  }

  // ── Monthly summaries (Book of Work archive) ──
  getMonthlySummaryRecord(month: string): MonthlySummaryRecord | undefined {
    return this.data.monthlySummaries.find(m => m.month === month);
  }

  getMonthlySummaryRecords(): MonthlySummaryRecord[] {
    return [...this.data.monthlySummaries].sort((a, b) => b.month.localeCompare(a.month));
  }

  upsertMonthlySummary(record: Omit<MonthlySummaryRecord, 'id'>): MonthlySummaryRecord {
    const existing = this.getMonthlySummaryRecord(record.month);
    if (existing) {
      Object.assign(existing, record);
      return existing;
    }
    const created: MonthlySummaryRecord = { id: crypto.randomUUID(), ...record };
    this.data.monthlySummaries.push(created);
    return created;
  }

  // ── Dashboard / Insights Summary ──
  /**
   * Day buckets are computed in the caller's IANA zone (`tz`); instants stay UTC on disk.
   * `now` is injectable for deterministic tests.
   */
  getDashboardSummary(tz: string = DEFAULT_TZ, now: Date = new Date()) {
    const today = todayInZone(tz, now);
    const sessionDay = (s: FocusSession) => dateInZone(s.timestamp, tz);
    const completedDay = (t: Task) => (t.completedAt ? dateInZone(t.completedAt, tz) : undefined);

    // Deep work = minutes actually spent in focus blocks (partial blocks included:
    // `durationMinutes` is real elapsed time, `completed` only says whether the
    // planned length was reached).
    const deepWork = this.data.focusSessions.filter(s => s.type === 'focus' && s.durationMinutes > 0);

    const todayTasks = this.data.tasks.filter(t => t.dueDate === today || t.status === 'in_progress');
    const completedToday = this.data.tasks.filter(t => completedDay(t) === today).length;

    // Focus minutes today
    const focusTodayMinutes = deepWork
      .filter(s => sessionDay(s) === today)
      .reduce((sum, s) => sum + s.durationMinutes, 0);

    // Daily streak: days with at least one completed focus session or one completed task
    const activeDates = new Set<string>();
    deepWork.forEach(s => activeDates.add(sessionDay(s)));
    this.data.tasks.forEach(t => {
      const d = completedDay(t);
      if (d) activeDates.add(d);
    });

    // Start from today, or yesterday if nothing has been done yet today
    let cursor = activeDates.has(today) ? today : addDays(today, -1);
    let streak = 0;
    while (activeDates.has(cursor)) {
      streak++;
      cursor = addDays(cursor, -1);
    }

    // Focus time over the last 7 days (today inclusive)
    const last7Days: { date: string; day: string; focusMinutes: number; completedTasks: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const dStr = addDays(today, -i);
      const mins = deepWork
        .filter(s => sessionDay(s) === dStr)
        .reduce((sum, s) => sum + s.durationMinutes, 0);
      const tasksCount = this.data.tasks.filter(t => completedDay(t) === dStr).length;
      last7Days.push({ date: dStr, day: DAY_NAMES[dayOfWeek(dStr)], focusMinutes: mins, completedTasks: tasksCount });
    }

    // Task counts by status
    const statusCounts = {
      backlog: this.data.tasks.filter(t => t.status === 'backlog').length,
      todo: this.data.tasks.filter(t => t.status === 'todo').length,
      in_progress: this.data.tasks.filter(t => t.status === 'in_progress').length,
      done: this.data.tasks.filter(t => t.status === 'done').length,
    };

    return {
      today,
      timeZone: tz,
      todayTasks,
      completedToday,
      focusTodayMinutes,
      streak,
      last7Days,
      statusCounts,
      totalProjects: this.data.projects.filter(p => !p.archived).length,
      totalNotes: this.data.notes.length,
      inboxCount: this.data.thoughts.filter(t => t.status === 'inbox').length,
      todayLog: this.getDailyLog(today) || null,
    };
  }
}

export const db = new Database();
