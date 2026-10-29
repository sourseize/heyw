// ── HeyWork: Kanban Board View ──
const BoardView = {
  autocomplete: null,
  strip: null,
  /** The task detail modal, if open — it lives on <body>, so the view must close it itself. */
  overlay: null,

  async render(container, params = {}) {
    this.destroy();
    const tasks = await API.getTasks();
    const projects = await API.getProjects();

    const columns = [
      { id: 'backlog', title: 'Backlog', icon: '📥' },
      { id: 'todo', title: 'To Do', icon: '📝' },
      { id: 'in_progress', title: 'In Progress', icon: '⚡' },
      { id: 'done', title: 'Completed', icon: '✓' },
    ];

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
        <div>
          <h2 style="font-size:1.25rem;font-weight:700">Task Board</h2>
          <p style="font-size:0.85rem;color:var(--text-muted)">Manage tasks with ease</p>
        </div>
        <button class="btn btn-primary" id="board-add-task-btn">+ New Task</button>
      </div>

      <div class="board-grid">
        ${columns.map(col => {
          const colTasks = tasks.filter(t => t.status === col.id);
          return `
            <div class="board-col" data-col="${col.id}">
              <div class="col-header">
                <div class="col-title"><span>${col.icon}</span> <span>${col.title}</span></div>
                <div class="col-count">${colTasks.length}</div>
              </div>

              <div class="col-task-list" style="display:flex;flex-direction:column;gap:0.75rem;min-height:200px">
                ${colTasks.map(t => `
                  <div class="task-card" data-id="${t.id}" data-testid="task-card" title="Open task">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start">
                      <div class="task-title">${escapeHtml(t.title)}</div>
                      <span class="badge badge-${t.priority}">${t.priority}</span>
                    </div>
                    ${t.description ? `<div style="font-size:0.8rem;color:var(--text-secondary);margin:0.35rem 0;line-height:1.3">${escapeHtml(t.description)}</div>` : ''}
                    <div class="task-meta">
                      <span>⏱ ${t.actualMinutes || 0}m / ${t.estimatedMinutes || 25}m</span>
                      <div style="display:flex;gap:0.35rem">
                        <button class="btn btn-secondary btn-sm task-move-btn" data-id="${t.id}" title="Move status">⇄</button>
                        <button class="btn btn-secondary btn-sm task-del-btn" data-id="${t.id}" title="Delete">✕</button>
                      </div>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    this.bindEvents(container, tasks, projects);

    // Deep link `#board/<taskId>` opens the task straight away.
    const requested = params.path && params.path[0];
    if (requested) {
      const task = tasks.find(t => t.id === requested);
      if (task) this.openTask(container, task, projects);
      else showToast('That task no longer exists', 'error');
    }
  },

  destroy() {
    this.autocomplete?.detach();
    this.autocomplete = null;
    this.strip?.detach();
    this.strip = null;
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  },

  /**
   * Task detail: edit everything, mention with `[[`, see what is connected.
   * Saving closes the modal; the board re-renders behind it.
   */
  openTask(container, task, projects) {
    this.destroy();
    const select = (id, options) => `<select id="${id}" style="width:100%;padding:0.5rem;border:1px solid var(--border-light);border-radius:var(--radius-sm);background:var(--bg-surface);color:var(--text-primary)">${options}</select>`;
    const opt = (value, label, current) => `<option value="${escapeHtml(value)}" ${value === current ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    const overlay = showModal('Task', `
      <div style="display:flex;flex-direction:column;gap:0.85rem" data-testid="task-detail">
        <div>
          <label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:0.25rem">Title</label>
          <input type="text" id="detail-task-title" data-testid="task-detail-title" value="${escapeHtml(task.title)}" style="width:100%;padding:0.6rem;border:1px solid var(--border-light);border-radius:var(--radius-sm)">
        </div>
        <div>
          <label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:0.25rem">Description <span style="font-weight:400;color:var(--text-muted)">· type [[ to link</span></label>
          <textarea id="detail-task-desc" data-testid="task-detail-desc" style="width:100%;padding:0.6rem;border:1px solid var(--border-light);border-radius:var(--radius-sm);min-height:90px;font-family:inherit">${escapeHtml(task.description || '')}</textarea>
          <div id="detail-task-strip" class="link-strip" data-testid="task-link-strip"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.75rem">
          <div>
            <label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:0.25rem">Status</label>
            ${select('detail-task-status', [['backlog', 'Backlog'], ['todo', 'To Do'], ['in_progress', 'In Progress'], ['done', 'Completed']].map(([v, l]) => opt(v, l, task.status)).join(''))}
          </div>
          <div>
            <label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:0.25rem">Priority</label>
            ${select('detail-task-priority', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['urgent', 'Urgent']].map(([v, l]) => opt(v, l, task.priority)).join(''))}
          </div>
          <div>
            <label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:0.25rem">Project</label>
            ${select('detail-task-project', opt('', '— none —', task.projectId || '') + projects.map(p => opt(p.id, p.name, task.projectId || '')).join(''))}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
          <div>
            <label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:0.25rem">Estimate (min)</label>
            <input type="number" id="detail-task-estimate" min="0" step="5" value="${task.estimatedMinutes ?? 25}" style="width:100%;padding:0.5rem;border:1px solid var(--border-light);border-radius:var(--radius-sm)">
          </div>
          <div>
            <label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:0.25rem">Logged</label>
            <div style="padding:0.5rem 0;font-size:0.9rem;color:var(--text-secondary)">⏱ ${task.actualMinutes || 0} min</div>
          </div>
        </div>
        <div id="detail-task-connections"></div>
      </div>
    `, async () => {
      const title = overlay.querySelector('#detail-task-title').value.trim();
      if (!title) {
        showToast('A task needs a title', 'error');
        return false;
      }
      const estimate = parseInt(overlay.querySelector('#detail-task-estimate').value, 10);
      try {
        const updated = await API.updateTask(task.id, {
          title,
          description: overlay.querySelector('#detail-task-desc').value.trim(),
          status: overlay.querySelector('#detail-task-status').value,
          priority: overlay.querySelector('#detail-task-priority').value,
          projectId: overlay.querySelector('#detail-task-project').value || null,
          estimatedMinutes: Number.isFinite(estimate) ? estimate : undefined,
        });
        const rewritten = updated.rewrittenMentions || 0;
        showToast(rewritten ? `Task saved · ${rewritten} mention${rewritten === 1 ? '' : 's'} of the old title updated` : 'Task saved', 'success');
        this.overlay = null;
        this.destroy();
        if (window.location.hash.startsWith('#board/')) window.location.hash = 'board';
        else this.render(container);
        return true;
      } catch (err) {
        showToast(err.message || 'Could not save the task', 'error');
        return false;
      }
    }, { confirmLabel: 'Save', cancelLabel: 'Close', onCancel: () => { this.overlay = null; this.destroy(); if (window.location.hash.startsWith('#board/')) window.location.hash = 'board'; } });
    overlay.querySelector('.modal-content').classList.add('modal-wide');
    this.overlay = overlay;

    const desc = overlay.querySelector('#detail-task-desc');
    this.autocomplete = WikiAutocomplete.attach(desc);
    this.strip = LinkStrip.attach(desc, overlay.querySelector('#detail-task-strip'));
    ConnectionsPanel.render(overlay.querySelector('#detail-task-connections'), { type: 'task', id: task.id });
  },

  bindEvents(container, tasks, projects) {
    container.querySelectorAll('.task-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const task = tasks.find(t => t.id === card.dataset.id);
        if (task) this.openTask(container, task, projects);
      });
    });

    container.querySelector('#board-add-task-btn')?.addEventListener('click', () => {
      showModal('Create Task', `
        <div style="display:flex;flex-direction:column;gap:0.85rem">
          <div>
            <label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:0.25rem">Title</label>
            <input type="text" id="modal-task-title" placeholder="Task title..." style="width:100%;padding:0.6rem;border:1px solid var(--border-light);border-radius:var(--radius-sm)" required>
          </div>
          <div>
            <label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:0.25rem">Description</label>
            <textarea id="modal-task-desc" placeholder="Details or context..." style="width:100%;padding:0.6rem;border:1px solid var(--border-light);border-radius:var(--radius-sm);min-height:70px"></textarea>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
            <div>
              <label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:0.25rem">Status</label>
              <select id="modal-task-status" style="width:100%;padding:0.5rem;border:1px solid var(--border-light);border-radius:var(--radius-sm)">
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="backlog">Backlog</option>
                <option value="done">Completed</option>
              </select>
            </div>
            <div>
              <label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:0.25rem">Priority</label>
              <select id="modal-task-priority" style="width:100%;padding:0.5rem;border:1px solid var(--border-light);border-radius:var(--radius-sm)">
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>
        </div>
      `, async () => {
        const title = $('#modal-task-title').value.trim();
        if (!title) return false;
        const description = $('#modal-task-desc').value.trim();
        const status = $('#modal-task-status').value;
        const priority = $('#modal-task-priority').value;
        await API.createTask({ title, description, status, priority });
        showToast('Task added');
        this.render(container);
        return true;
      });
    });

    // Move task to next column
    const nextStatus = {
      backlog: 'todo',
      todo: 'in_progress',
      in_progress: 'done',
      done: 'todo',
    };

    container.querySelectorAll('.task-move-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const task = tasks.find(t => t.id === id);
        if (task) {
          const newStatus = nextStatus[task.status] || 'todo';
          await API.updateTask(id, { status: newStatus });
          showToast(`Task moved to ${newStatus.replace('_', ' ')}`);
          this.render(container);
        }
      });
    });

    container.querySelectorAll('.task-del-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const task = tasks.find(t => t.id === id);
        const ok = await showConfirm('Delete this task?', `“${task ? task.title : 'This task'}” will be removed from the board. Focus time already logged against it stays in your history.`, { confirmLabel: 'Delete', danger: true });
        if (ok) {
          await API.deleteTask(id);
          showToast('Task deleted');
          this.render(container);
        }
      });
    });
  }
};
