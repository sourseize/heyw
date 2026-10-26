// ── HeyWork: Kanban Board View ──
const BoardView = {
  async render(container) {
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
                  <div class="task-card" data-id="${t.id}">
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

    this.bindEvents(container, tasks);
  },

  bindEvents(container, tasks) {
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
        if (confirm('Delete this task?')) {
          await API.deleteTask(id);
          showToast('Task deleted');
          this.render(container);
        }
      });
    });
  }
};
