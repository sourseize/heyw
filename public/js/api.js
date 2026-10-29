// ── HeyWork: Client API ──
const API = {
  /**
   * The browser's IANA time zone. Instants are stored in UTC on the server; any
   * endpoint that buckets by day/month receives this so "today" means *your* today.
   */
  get timeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  },

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
    return this.request('GET', `/api/dashboard?tz=${encodeURIComponent(this.timeZone)}`);
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

  // Thoughts (capture & triage)
  getThoughts(status) {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    return this.request('GET', `/api/thoughts?${params.toString()}`);
  },
  captureThought(text, context) {
    return this.request('POST', '/api/thoughts', { text, context });
  },
  updateThought(id, data) {
    return this.request('PUT', `/api/thoughts/${id}`, data);
  },
  convertThought(id, taskData = {}) {
    return this.request('POST', `/api/thoughts/${id}/convert`, taskData);
  },

  // Book of Work
  getSummaryMonths() {
    return this.request('GET', `/api/summary/months?tz=${encodeURIComponent(this.timeZone)}`);
  },
  getMonthlySummary(month) {
    const params = new URLSearchParams({ tz: this.timeZone });
    if (month) params.set('month', month);
    return this.request('GET', `/api/summary/monthly?${params.toString()}`);
  },
  freezeMonth(month) {
    return this.request('POST', `/api/summary/monthly/${month}/freeze?tz=${encodeURIComponent(this.timeZone)}`);
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

  // Links (connected thinking)
  /** Everything touching one item: mentions, explicit links, became / captured-during. */
  getConnections(ref) {
    return this.request('GET', `/api/links?type=${encodeURIComponent(ref.type)}&id=${encodeURIComponent(ref.id)}`);
  },
  createLink(from, to) {
    return this.request('POST', '/api/links', { from, to });
  },
  deleteLink(id) {
    return this.request('DELETE', `/api/links/${id}`);
  },
  /** Resolves the `[[mentions]]` in unsaved text. */
  previewLinks(text) {
    return this.request('POST', '/api/links/preview', { text });
  },
  searchLinkables(q, types, limit = 8) {
    const params = new URLSearchParams({ q: q || '', limit: String(limit) });
    if (types && types.length) params.set('types', types.join(','));
    return this.request('GET', `/api/search?${params.toString()}`);
  },
  /** `ref` may be null: the server then picks the most connected item active in the month. */
  getGraph(ref, month, options = {}) {
    const params = new URLSearchParams({ tz: this.timeZone });
    if (ref) params.set('focus', `${ref.type}:${ref.id}`);
    if (month) params.set('month', month);
    if (options.quiet) params.set('quiet', '1');
    return this.request('GET', `/api/graph?${params.toString()}`);
  },
};
