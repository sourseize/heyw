import { router } from '../server/router.js';
import { db } from '../db/database.js';
import type { TaskPriority, TaskStatus, ThoughtStatus, ThoughtContext } from '../db/database.js';
import { isValidTimeZone, DEFAULT_TZ } from '../db/time.js';
import { timerEngine, getBackupManager } from '../server/context.js';
import { TIMER_TYPES, normalisePlanned } from '../db/timer.js';
import { isValidMonthString } from '../db/time.js';
import { archiveIndex, currentMonth, freezeMonth, getSummaryPage, isClosedMonth } from '../db/bookofwork.js';
import { renderMonthlyMarkdown } from '../db/summary-markdown.js';
import type { ServerResponse } from 'node:http';

function json(res: ServerResponse, data: any, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ── Helpers ──

const TASK_STATUSES: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'done'];
const TASK_PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

/** Copies only the allow-listed keys that are present in `body` (PUT hardening, workbook F3). */
function pick<T extends Record<string, any>>(body: any, keys: readonly string[]): Partial<T> {
  const out: Record<string, any> = {};
  if (!body || typeof body !== 'object') return out as Partial<T>;
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
  }
  return out as Partial<T>;
}

/** Returns an error string when a task patch carries invalid values, else null. */
function validateTaskFields(u: Record<string, any>): string | null {
  if ('title' in u && (typeof u.title !== 'string' || !u.title.trim())) return 'title must be a non-empty string';
  if ('status' in u && !TASK_STATUSES.includes(u.status)) return `status must be one of ${TASK_STATUSES.join(', ')}`;
  if ('priority' in u && !TASK_PRIORITIES.includes(u.priority)) return `priority must be one of ${TASK_PRIORITIES.join(', ')}`;
  if ('tags' in u && (!Array.isArray(u.tags) || !u.tags.every((t: unknown) => typeof t === 'string'))) return 'tags must be an array of strings';
  if ('estimatedMinutes' in u && u.estimatedMinutes !== undefined && (typeof u.estimatedMinutes !== 'number' || u.estimatedMinutes < 0)) return 'estimatedMinutes must be a non-negative number';
  if ('actualMinutes' in u && (typeof u.actualMinutes !== 'number' || u.actualMinutes < 0)) return 'actualMinutes must be a non-negative number';
  if ('order' in u && typeof u.order !== 'number') return 'order must be a number';
  if ('dueDate' in u && u.dueDate !== undefined && u.dueDate !== null && typeof u.dueDate !== 'string') return 'dueDate must be a string';
  if ('projectId' in u && u.projectId !== undefined && u.projectId !== null && typeof u.projectId !== 'string') return 'projectId must be a string';
  return null;
}

/**
 * Resolves the caller's IANA zone from `?tz=`. Falls back to UTC (with a warning
 * header) so the API stays usable from curl. A valid zone is remembered in settings
 * so server-side jobs (monthly summaries) can bucket the same way.
 */
async function resolveTz(res: ServerResponse, query?: URLSearchParams): Promise<string> {
  const tz = query?.get('tz');
  if (tz && isValidTimeZone(tz)) {
    if (db.rememberTimeZone(tz)) await db.persist();
    return tz;
  }
  if (tz) res.setHeader('X-HeyWork-Warning', `Unknown time zone "${tz}"; using ${DEFAULT_TZ}`);
  return DEFAULT_TZ;
}

// ── Dashboard / Overview ──
router.get('/api/dashboard', async (_req, res, _match, _body, query) => {
  const tz = await resolveTz(res, query);
  json(res, db.getDashboardSummary(tz));
});

// ── Projects ──
router.get('/api/projects', async (_req, res, _match, _body, query) => {
  const includeArchived = query?.get('archived') === 'true';
  json(res, db.getProjects(includeArchived));
});

router.post('/api/projects', async (_req, res, _match, body) => {
  if (!body?.name?.trim()) {
    return json(res, { error: 'Project name is required' }, 400);
  }
  const project = db.createProject({
    name: body.name.trim(),
    color: body.color || '#4f46e5',
    description: body.description?.trim() || '',
    archived: false,
  });
  await db.persist();
  json(res, project, 201);
});

router.put('/api/projects/:id', async (_req, res, match, body) => {
  const updates = pick(body, ['name', 'color', 'description', 'archived']);
  if ('name' in updates && (typeof updates.name !== 'string' || !updates.name.trim())) {
    return json(res, { error: 'Project name must be a non-empty string' }, 400);
  }
  if (typeof updates.name === 'string') updates.name = updates.name.trim();
  if ('archived' in updates) updates.archived = Boolean(updates.archived);
  const updated = db.updateProject(match[1], updates);
  if (!updated) return json(res, { error: 'Project not found' }, 404);
  await db.persist();
  json(res, updated);
});

router.delete('/api/projects/:id', async (_req, res, match) => {
  const ok = db.deleteProject(match[1]);
  if (!ok) return json(res, { error: 'Project not found' }, 404);
  await db.persist();
  json(res, { success: true });
});

// ── Tasks ──
router.get('/api/tasks', async (_req, res, _match, _body, query) => {
  const filters: any = {};
  if (query?.has('status')) filters.status = query.get('status');
  if (query?.has('projectId')) filters.projectId = query.get('projectId');
  if (query?.has('tag')) filters.tag = query.get('tag');
  json(res, db.getTasks(filters));
});

router.post('/api/tasks', async (_req, res, _match, body) => {
  if (!body?.title?.trim()) {
    return json(res, { error: 'Task title is required' }, 400);
  }
  const invalid = validateTaskFields(pick(body, ['status', 'priority', 'tags', 'estimatedMinutes', 'dueDate', 'projectId']));
  if (invalid) return json(res, { error: invalid }, 400);
  const task = db.createTask({
    projectId: body.projectId || undefined,
    title: body.title.trim(),
    description: body.description?.trim() || '',
    status: body.status || 'todo',
    priority: body.priority || 'medium',
    dueDate: body.dueDate || undefined,
    estimatedMinutes: typeof body.estimatedMinutes === 'number' ? body.estimatedMinutes : 25,
    tags: Array.isArray(body.tags) ? body.tags : [],
  });
  await db.persist();
  json(res, task, 201);
});

router.put('/api/tasks/:id', async (_req, res, match, body) => {
  const updates = pick(body, ['projectId', 'title', 'description', 'status', 'priority', 'dueDate', 'estimatedMinutes', 'actualMinutes', 'tags', 'order']);
  const invalid = validateTaskFields(updates);
  if (invalid) return json(res, { error: invalid }, 400);
  if (typeof updates.title === 'string') updates.title = updates.title.trim();
  const updated = db.updateTask(match[1], updates);
  if (!updated) return json(res, { error: 'Task not found' }, 404);
  await db.persist();
  json(res, updated);
});

router.delete('/api/tasks/:id', async (_req, res, match) => {
  const ok = db.deleteTask(match[1]);
  if (!ok) return json(res, { error: 'Task not found' }, 404);
  await db.persist();
  json(res, { success: true });
});

router.post('/api/tasks/reorder', async (_req, res, _match, body) => {
  if (!Array.isArray(body?.taskIds)) {
    return json(res, { error: 'taskIds array is required' }, 400);
  }
  db.reorderTasks(body.taskIds);
  await db.persist();
  json(res, { success: true });
});

// ── Focus Sessions ──
router.get('/api/focus', async (_req, res, _match, _body, query) => {
  const limit = query?.has('limit') ? parseInt(query.get('limit')!, 10) : 50;
  json(res, db.getFocusSessions(limit));
});

router.post('/api/focus', async (_req, res, _match, body) => {
  if (!body?.durationMinutes || typeof body.durationMinutes !== 'number') {
    return json(res, { error: 'durationMinutes number is required' }, 400);
  }
  const session = db.logFocusSession({
    taskId: body.taskId || undefined,
    taskTitle: body.taskTitle || undefined,
    durationMinutes: body.durationMinutes,
    type: body.type || 'focus',
    notes: body.notes || '',
    completed: body.completed ?? true,
  });
  await db.persist();
  json(res, session, 201);
});

// ── Daily Logs ──
router.get('/api/logs', async (_req, res, _match, _body, query) => {
  const limit = query?.has('limit') ? parseInt(query.get('limit')!, 10) : 30;
  json(res, db.getDailyLogs(limit));
});

router.get('/api/logs/:date', async (_req, res, match) => {
  const log = db.getDailyLog(match[1]);
  if (!log) return json(res, { error: 'Daily log not found' }, 404);
  json(res, log);
});

router.post('/api/logs', async (_req, res, _match, body) => {
  if (!body?.date) {
    return json(res, { error: 'date string (YYYY-MM-DD) is required' }, 400);
  }
  const log = db.upsertDailyLog({
    date: body.date,
    intentions: Array.isArray(body.intentions) ? body.intentions : [],
    retro: body.retro || '',
    energyRating: typeof body.energyRating === 'number' ? body.energyRating : 3,
    focusRating: typeof body.focusRating === 'number' ? body.focusRating : 3,
    notes: body.notes || '',
  });
  await db.persist();
  json(res, log, 200);
});

// ── Notes / Scratchpad ──
router.get('/api/notes', async (_req, res, _match, _body, query) => {
  const tag = query?.get('tag') || undefined;
  const q = query?.get('q') || undefined;
  json(res, db.getNotes(tag, q));
});

router.get('/api/notes/:id', async (_req, res, match) => {
  const note = db.getNote(match[1]);
  if (!note) return json(res, { error: 'Note not found' }, 404);
  json(res, note);
});

router.post('/api/notes', async (_req, res, _match, body) => {
  if (!body?.title?.trim()) {
    return json(res, { error: 'Note title is required' }, 400);
  }
  const note = db.createNote({
    title: body.title.trim(),
    content: body.content || '',
    tags: Array.isArray(body.tags) ? body.tags : [],
    pinned: Boolean(body.pinned),
  });
  await db.persist();
  json(res, note, 201);
});

router.put('/api/notes/:id', async (_req, res, match, body) => {
  const updates = pick(body, ['title', 'content', 'tags', 'pinned']);
  if ('title' in updates && (typeof updates.title !== 'string' || !updates.title.trim())) {
    return json(res, { error: 'Note title must be a non-empty string' }, 400);
  }
  if (typeof updates.title === 'string') updates.title = updates.title.trim();
  if ('content' in updates && typeof updates.content !== 'string') return json(res, { error: 'content must be a string' }, 400);
  if ('tags' in updates && !Array.isArray(updates.tags)) return json(res, { error: 'tags must be an array' }, 400);
  if ('pinned' in updates) updates.pinned = Boolean(updates.pinned);
  const updated = db.updateNote(match[1], updates);
  if (!updated) return json(res, { error: 'Note not found' }, 404);
  await db.persist();
  json(res, updated);
});

router.delete('/api/notes/:id', async (_req, res, match) => {
  const ok = db.deleteNote(match[1]);
  if (!ok) return json(res, { error: 'Note not found' }, 404);
  await db.persist();
  json(res, { success: true });
});

// ── Thoughts: capture during focus, triage later ──

const THOUGHT_STATUSES: ThoughtStatus[] = ['inbox', 'kept', 'converted', 'discarded'];
const MAX_THOUGHT_LENGTH = 500;

/** Keeps only the fields we understand, and only when they look sane. */
function sanitiseContext(raw: any): ThoughtContext | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const context: ThoughtContext = {
    view: typeof raw.view === 'string' ? raw.view.slice(0, 40) : 'unknown',
    timerRunning: Boolean(raw.timerRunning),
  };
  if (raw.timerType === 'focus' || raw.timerType === 'short_break' || raw.timerType === 'long_break') {
    context.timerType = raw.timerType;
  }
  if (typeof raw.taskId === 'string') {
    const task = db.getTask(raw.taskId);
    if (task) {
      context.taskId = task.id;
      context.taskTitle = task.title;
    }
  }
  return context;
}

router.get('/api/thoughts', async (_req, res, _match, _body, query) => {
  const status = query?.get('status') || undefined;
  if (status && !THOUGHT_STATUSES.includes(status as ThoughtStatus)) {
    return json(res, { error: `status must be one of ${THOUGHT_STATUSES.join(', ')}` }, 400);
  }
  json(res, db.getThoughts({ status: status as ThoughtStatus | undefined }));
});

router.post('/api/thoughts', async (_req, res, _match, body) => {
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return json(res, { error: 'Thought text is required' }, 400);
  if (text.length > MAX_THOUGHT_LENGTH) {
    return json(res, { error: `Keep it under ${MAX_THOUGHT_LENGTH} characters — it is a parking lot, not a note` }, 400);
  }
  const thought = db.createThought({ text, context: sanitiseContext(body?.context) });
  await db.persist();
  json(res, thought, 201);
});

router.put('/api/thoughts/:id', async (_req, res, match, body) => {
  const updates = pick(body, ['text', 'status']);
  if ('text' in updates) {
    if (typeof updates.text !== 'string' || !updates.text.trim()) {
      return json(res, { error: 'text must be a non-empty string' }, 400);
    }
    if (updates.text.trim().length > MAX_THOUGHT_LENGTH) {
      return json(res, { error: `Keep it under ${MAX_THOUGHT_LENGTH} characters` }, 400);
    }
    updates.text = updates.text.trim();
  }
  if ('status' in updates && !THOUGHT_STATUSES.includes(updates.status as ThoughtStatus)) {
    return json(res, { error: `status must be one of ${THOUGHT_STATUSES.join(', ')}` }, 400);
  }
  const updated = db.updateThought(match[1], updates as { text?: string; status?: ThoughtStatus });
  if (!updated) return json(res, { error: 'Thought not found' }, 404);
  await db.persist();
  json(res, updated);
});

router.post('/api/thoughts/:id/convert', async (_req, res, match, body) => {
  const existing = db.getThought(match[1]);
  if (!existing) return json(res, { error: 'Thought not found' }, 404);
  if (existing.status === 'converted') {
    return json(res, { error: 'This thought is already a task', taskId: existing.taskId }, 409);
  }
  const taskFields = pick(body, ['projectId', 'title', 'description', 'status', 'priority', 'dueDate', 'estimatedMinutes', 'tags']);
  const invalid = validateTaskFields(taskFields);
  if (invalid) return json(res, { error: invalid }, 400);

  const result = db.convertThoughtToTask(match[1], taskFields as any);
  if (!result) return json(res, { error: 'Thought not found' }, 404);
  await db.persist();
  json(res, result, 201);
});

// Tooling/tests only — the UI never deletes a thought, it hides it.
router.delete('/api/thoughts/:id', async (_req, res, match) => {
  const ok = db.deleteThought(match[1]);
  if (!ok) return json(res, { error: 'Thought not found' }, 404);
  await db.persist();
  json(res, { success: true });
});


// ── Focus Timer (server-authoritative) ──
// The timer lives in the store, so it survives reloads, navigation and crashes,
// and every ending (completed / stopped / switched / abandoned) is recorded.

router.get('/api/timer', async (_req, res) => {
  json(res, { timer: timerEngine.view() });
});

router.post('/api/timer/start', async (_req, res, _match, body) => {
  const type = body?.type || 'focus';
  if (!TIMER_TYPES.includes(type)) {
    return json(res, { error: `type must be one of ${TIMER_TYPES.join(', ')}` }, 400);
  }
  let taskTitle = body?.taskTitle;
  if (body?.taskId) {
    const task = db.getTask(body.taskId);
    if (!task) return json(res, { error: 'Task not found' }, 404);
    taskTitle = task.title;
  }
  // A "reset" restarts the same block: the elapsed part is recorded as stopped, not switched.
  const replaceReason = body?.replaceReason === 'stopped' ? 'stopped' : 'switched';
  const { timer, replaced } = timerEngine.start({
    type,
    plannedMinutes: normalisePlanned(body?.plannedMinutes, type),
    taskId: body?.taskId || undefined,
    taskTitle,
    notes: typeof body?.notes === 'string' ? body.notes : undefined,
  }, replaceReason);
  await db.persist();
  json(res, { timer: timerEngine.view(timer), replaced: summariseFinalize(replaced) }, 201);
});

router.post('/api/timer/pause', async (_req, res) => {
  const timer = timerEngine.pause();
  if (!timer) return json(res, { error: 'No active timer' }, 404);
  await db.persist();
  json(res, { timer: timerEngine.view(timer) });
});

router.post('/api/timer/resume', async (_req, res) => {
  const timer = timerEngine.resume();
  if (!timer) return json(res, { error: 'No active timer' }, 404);
  await db.persist();
  json(res, { timer: timerEngine.view(timer) });
});

router.post('/api/timer/heartbeat', async (_req, res, _match, body) => {
  const timer = timerEngine.heartbeat({
    visible: body?.visible,
    hiddenMs: body?.hiddenMs,
    hiddenEvents: body?.hiddenEvents,
    interactions: body?.interactions,
  });
  if (!timer) return json(res, { timer: null });
  // A heartbeat may be the moment we notice the block is due to end.
  const finalized = timerEngine.tick();
  await db.persist();
  json(res, { timer: timerEngine.view(), finalized: summariseFinalize(finalized) });
});

router.post('/api/timer/stop', async (_req, res) => {
  const result = timerEngine.stop();
  if (!result) return json(res, { error: 'No active timer' }, 404);
  await db.persist();
  json(res, { timer: null, finalized: summariseFinalize(result) });
});

function summariseFinalize(result: ReturnType<typeof timerEngine.stop>) {
  if (!result) return null;
  return {
    reason: result.reason,
    elapsedMinutes: Math.round(result.elapsedMs / 60000),
    discarded: result.discarded,
    session: result.session,
    type: result.timer.type,
    taskTitle: result.timer.taskTitle || null,
  };
}

// ── Backups ──

router.get('/api/backups', async (_req, res) => {
  const manager = getBackupManager();
  const entries = await manager.list();
  json(res, { directory: manager.dir, backups: entries.map(({ file, ...rest }) => rest) });
});

router.post('/api/backups', async (_req, res, _match, body) => {
  const entry = await getBackupManager().create('manual', { force: Boolean(body?.force) });
  if (!entry) return json(res, { created: null, reason: 'Store unchanged since the last backup' });
  const { file, ...rest } = entry;
  json(res, { created: rest }, 201);
});

router.post('/api/backups/:name/restore', async (_req, res, match) => {
  const name = decodeURIComponent(match[1]);
  try {
    const { restored, safetyCopy } = await getBackupManager().restore(name);
    db.useFile(db.file);
    await db.init();
    json(res, { restored: restored.name, safetyCopy: safetyCopy?.name || null });
  } catch (err: any) {
    json(res, { error: err?.message || 'Restore failed' }, err?.name === 'DatabaseFileError' ? 404 : 500);
  }
});

// ── Book of Work: monthly summaries & archive ──

router.get('/api/summary/months', async (_req, res, _match, _body, query) => {
  const tz = await resolveTz(res, query);
  json(res, archiveIndex(db, tz));
});

router.get('/api/summary/monthly', async (_req, res, _match, _body, query) => {
  const tz = await resolveTz(res, query);
  const month = query?.get('month') || currentMonth(tz);
  if (!isValidMonthString(month)) return json(res, { error: 'month must be YYYY-MM' }, 400);
  const page = getSummaryPage(db, month, tz);
  json(res, page);
});

// Note: registered before the `/:month/freeze` route; `.md` is part of the path.
router.get('/api/summary/monthly/:file', async (_req, res, match, _body, query) => {
  const file = decodeURIComponent(match[1]);
  if (!file.endsWith('.md')) return json(res, { error: 'Endpoint not found' }, 404);
  const month = file.slice(0, -3);
  if (!isValidMonthString(month)) return json(res, { error: 'month must be YYYY-MM' }, 400);
  const tz = await resolveTz(res, query);
  const page = getSummaryPage(db, month, tz);
  const markdown = renderMonthlyMarkdown(page.summary, { frozen: page.frozen });
  res.writeHead(200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': `attachment; filename="heywork-book-of-work-${month}.md"`,
    'Cache-Control': 'no-store',
  });
  res.end(markdown);
});

router.post('/api/summary/monthly/:month/freeze', async (_req, res, match, _body, query) => {
  const month = match[1];
  if (!isValidMonthString(month)) return json(res, { error: 'month must be YYYY-MM' }, 400);
  const tz = await resolveTz(res, query);
  if (!isClosedMonth(month, tz)) {
    return json(res, { error: 'Only a month that has ended can be frozen' }, 409);
  }
  const record = freezeMonth(db, month, tz, new Date(), { force: true }); // POST = (re)generate on demand
  await db.persist();
  json(res, { month, frozen: true, frozenAt: record!.generatedAt, timeZone: record!.timeZone });
});
