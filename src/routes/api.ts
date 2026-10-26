import { router } from '../server/router.js';
import { db } from '../db/database.js';
import type { ServerResponse } from 'node:http';

function json(res: ServerResponse, data: any, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ── Dashboard / Overview ──
router.get('/api/dashboard', async (_req, res) => {
  json(res, db.getDashboardSummary());
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
  const updated = db.updateProject(match[1], body);
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
  const updated = db.updateTask(match[1], body);
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
  const updated = db.updateNote(match[1], body);
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
