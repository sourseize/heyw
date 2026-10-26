// ── HeyWork: Today & Focus View ──
const TodayView = {
  timer: null,
  timeLeft: 25 * 60,
  durationMinutes: 25,
  timerType: 'focus', // focus | short_break | long_break
  isRunning: false,
  selectedTaskId: null,

  async render(container) {
    const summary = await API.getDashboard();
    const tasks = await API.getTasks();
    const activeTasks = tasks.filter(t => t.status !== 'done');

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:2rem;max-width:1100px;margin:0 auto">
        <!-- Left: Focus Engine -->
        <div>
          <div class="focus-card">
            <div class="timer-tabs">
              <div class="timer-tab ${this.timerType === 'focus' ? 'active' : ''}" data-type="focus" data-mins="25">Deep Focus (25m)</div>
              <div class="timer-tab ${this.timerType === 'short_break' ? 'active' : ''}" data-type="short_break" data-mins="5">Short Break (5m)</div>
              <div class="timer-tab ${this.timerType === 'long_break' ? 'active' : ''}" data-type="long_break" data-mins="15">Rest (15m)</div>
            </div>

            <div style="margin-bottom:0.75rem">
              <select id="focus-task-select" style="padding:0.4rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border-light);background:var(--bg-surface);color:var(--text-primary);font-size:0.88rem;max-width:280px">
                <option value="">-- No specific task attached --</option>
                ${activeTasks.map(t => `<option value="${t.id}" ${t.id === this.selectedTaskId ? 'selected' : ''}>${escapeHtml(t.title)}</option>`).join('')}
              </select>
            </div>

            <div class="timer-display" id="timer-display">${this.formatTime(this.timeLeft)}</div>

            <div class="timer-controls">
              <button class="btn btn-primary" id="timer-toggle-btn" style="min-width:120px;font-size:1rem;padding:0.65rem 1.25rem">
                ${this.isRunning ? '⏸ Pause' : '▶ Start Flow'}
              </button>
              <button class="btn btn-secondary" id="timer-reset-btn">↺ Reset</button>
            </div>

            <div class="ambient-sound-bar">
              <span style="font-size:0.8rem;font-weight:600">Soundscape:</span>
              <button class="sound-btn ${AmbientAudio.activeType === null ? 'active' : ''}" data-sound="none">Off</button>
              <button class="sound-btn ${AmbientAudio.activeType === 'rain' ? 'active' : ''}" data-sound="rain">🌧 Rain</button>
              <button class="sound-btn ${AmbientAudio.activeType === 'brown' ? 'active' : ''}" data-sound="brown">🌊 Brown Noise</button>
              <button class="sound-btn ${AmbientAudio.activeType === 'white' ? 'active' : ''}" data-sound="white">📻 White Noise</button>
            </div>
          </div>
        </div>

        <!-- Right: Today's Agenda -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
            <h2 style="font-size:1.15rem;font-weight:700">Today's Focus List</h2>
            <button class="btn btn-secondary btn-sm" id="quick-add-task-btn">+ Add Task</button>
          </div>

          <div id="today-tasks-list" style="display:flex;flex-direction:column;gap:0.6rem">
            ${activeTasks.length === 0 ? '<div style="color:var(--text-muted);font-size:0.9rem;padding:1rem;background:var(--bg-surface);border-radius:var(--radius-md);border:1px solid var(--border-light)">No active tasks. You are all caught up!</div>' : ''}
            ${activeTasks.slice(0, 6).map(t => `
              <div class="task-card" style="display:flex;align-items:center;justify-content:space-between;padding:0.75rem 1rem">
                <div style="display:flex;align-items:center;gap:0.75rem">
                  <input type="checkbox" class="task-complete-cb" data-id="${t.id}" style="cursor:pointer;width:18px;height:18px">
                  <div>
                    <div style="font-weight:600;font-size:0.92rem">${escapeHtml(t.title)}</div>
                    <div style="font-size:0.75rem;color:var(--text-muted)">Est: ${t.estimatedMinutes || 25}m • Actual: ${t.actualMinutes || 0}m</div>
                  </div>
                </div>
                <span class="badge badge-${t.priority}">${t.priority}</span>
              </div>
            `).join('')}
          </div>

          <div style="margin-top:1.5rem;padding:1.25rem;background:var(--bg-surface);border:1px solid var(--border-light);border-radius:var(--radius-md)">
            <h3 style="font-size:0.95rem;font-weight:600;margin-bottom:0.5rem">Today's Metrics</h3>
            <div style="display:flex;justify-content:space-between;font-size:0.85rem;color:var(--text-secondary)">
              <span>Focused Today: <strong style="color:var(--text-primary)">${summary.focusTodayMinutes}m</strong></span>
              <span>Completed Tasks: <strong style="color:var(--text-primary)">${summary.completedToday}</strong></span>
              <span>Current Streak: <strong style="color:var(--accent)">${summary.streak} days</strong></span>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents(container);
  },

  formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  },

  bindEvents(container) {
    const toggleBtn = container.querySelector('#timer-toggle-btn');
    const resetBtn = container.querySelector('#timer-reset-btn');
    const display = container.querySelector('#timer-display');
    const taskSelect = container.querySelector('#focus-task-select');

    taskSelect?.addEventListener('change', (e) => {
      this.selectedTaskId = e.target.value || null;
    });

    toggleBtn?.addEventListener('click', () => {
      if (this.isRunning) {
        this.pause();
        toggleBtn.textContent = '▶ Resume Flow';
      } else {
        this.start();
        toggleBtn.textContent = '⏸ Pause';
      }
    });

    resetBtn?.addEventListener('click', () => {
      this.reset();
      toggleBtn.textContent = '▶ Start Flow';
    });

    container.querySelectorAll('.timer-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        container.querySelectorAll('.timer-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.timerType = tab.dataset.type;
        this.durationMinutes = parseInt(tab.dataset.mins, 10);
        this.reset();
        toggleBtn.textContent = '▶ Start Flow';
      });
    });

    container.querySelectorAll('.sound-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.sound-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const sound = btn.dataset.sound;
        if (sound === 'none') {
          AmbientAudio.stop();
        } else {
          AmbientAudio.play(sound);
        }
      });
    });

    container.querySelectorAll('.task-complete-cb').forEach(cb => {
      cb.addEventListener('change', async (e) => {
        const id = e.target.dataset.id;
        await API.updateTask(id, { status: 'done' });
        showToast('Task completed! Keep the momentum going.', 'success');
        this.render(container);
      });
    });

    container.querySelector('#quick-add-task-btn')?.addEventListener('click', () => {
      showModal('Add New Task', `
        <div style="display:flex;flex-direction:column;gap:0.75rem">
          <input type="text" id="modal-task-title" placeholder="What needs to be done?" style="padding:0.6rem;border:1px solid var(--border-light);border-radius:var(--radius-sm);font-size:0.9rem" required>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
            <select id="modal-task-priority" style="padding:0.5rem;border:1px solid var(--border-light);border-radius:var(--radius-sm)">
              <option value="medium">Medium Priority</option>
              <option value="high">High Priority</option>
              <option value="urgent">Urgent</option>
              <option value="low">Low Priority</option>
            </select>
            <input type="number" id="modal-task-estimate" value="25" min="5" step="5" style="padding:0.5rem;border:1px solid var(--border-light);border-radius:var(--radius-sm)" placeholder="Est mins">
          </div>
        </div>
      `, async () => {
        const title = $('#modal-task-title').value.trim();
        if (!title) return false;
        const priority = $('#modal-task-priority').value;
        const estimatedMinutes = parseInt($('#modal-task-estimate').value, 10) || 25;
        await API.createTask({ title, priority, estimatedMinutes });
        showToast('Task created');
        this.render(container);
        return true;
      });
    });
  },

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(() => {
      if (this.timeLeft > 0) {
        this.timeLeft--;
        const display = document.getElementById('timer-display');
        if (display) display.textContent = this.formatTime(this.timeLeft);
      } else {
        this.completeSession();
      }
    }, 1000);
  },

  pause() {
    this.isRunning = false;
    if (this.timer) clearInterval(this.timer);
  },

  reset() {
    this.pause();
    this.timeLeft = this.durationMinutes * 60;
    const display = document.getElementById('timer-display');
    if (display) display.textContent = this.formatTime(this.timeLeft);
  },

  async completeSession() {
    this.reset();
    AmbientAudio.playChime();
    try {
      await API.logFocusSession({
        durationMinutes: this.durationMinutes,
        type: this.timerType,
        taskId: this.selectedTaskId || undefined,
        completed: true,
      });
      showToast('Focus session complete! Take a mindful breath.', 'success');
      const container = document.getElementById('page-content');
      if (container) this.render(container);
    } catch (err) {
      console.error(err);
    }
  }
};
