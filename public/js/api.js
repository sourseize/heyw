// ── HeyWork: Client API ──
const API = {
  async request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) {
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  // Dashboard
  getDashboard() {
    return this.request('GET', '/api/dashboard');
  },

  // Projects
  getProjects(includeArchived = false) {
    return this.request('GET', `/api/projects?archived=${includeArchived}`);
  },
  createProject(data) {
    return this.request('POST', '/api/projects', data);
  },
  updateProject(id, data) {
    return this.request('PUT', `/api/projects/${id}`, data);
  },
  deleteProject(id) {
    return this.request('DELETE', `/api/projects/${id}`);
  },

  // Tasks
  getTasks(filters = {}) {
    const params = new URLSearchParams(filters);
    return this.request('GET', `/api/tasks?${params.toString()}`);
  },
  createTask(data) {
    return this.request('POST', '/api/tasks', data);
  },
  updateTask(id, data) {
    return this.request('PUT', `/api/tasks/${id}`, data);
  },
  deleteTask(id) {
    return this.request('DELETE', `/api/tasks/${id}`);
  },
  reorderTasks(taskIds) {
    return this.request('POST', '/api/tasks/reorder', { taskIds });
  },

  // Focus Sessions
  getFocusSessions(limit = 50) {
    return this.request('GET', `/api/focus?limit=${limit}`);
  },
  logFocusSession(data) {
    return this.request('POST', '/api/focus', data);
  },

  // Daily Logs
  getDailyLogs(limit = 30) {
    return this.request('GET', `/api/logs?limit=${limit}`);
  },
  getDailyLog(date) {
    return this.request('GET', `/api/logs/${date}`);
  },
  saveDailyLog(data) {
    return this.request('POST', '/api/logs', data);
  },

  // Notes
  getNotes(tag, q) {
    const params = new URLSearchParams();
    if (tag) params.set('tag', tag);
    if (q) params.set('q', q);
    return this.request('GET', `/api/notes?${params.toString()}`);
  },
  getNote(id) {
    return this.request('GET', `/api/notes/${id}`);
  },
  createNote(data) {
    return this.request('POST', '/api/notes', data);
  },
  updateNote(id, data) {
    return this.request('PUT', `/api/notes/${id}`, data);
  },
  deleteNote(id) {
    return this.request('DELETE', `/api/notes/${id}`);
  },
};
