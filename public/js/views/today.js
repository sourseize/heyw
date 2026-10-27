// ── HeyWork: Today & Focus View ──
//
// The timer is owned by the server (js/timer.js); this card is its main control
// surface. The tabs are the three block types:
//   - the tab of the *running* block ticks and offers Pause / Resume, Stop, Reset;
//   - any other tab shows its static length and a "Start ‹block›" button — the
//     only action that ends the running block (recorded, never discarded) and
//     starts a new one.
// The same block also shows in the corner countdown on every view.
const TodayView = {
  // Tab picked by the user; null means "follow the running block".
  selectedType: null,
  selectedTaskId: null,
  unsubscribe: null,

  DURATIONS: { focus: 25, short_break: 5, long_break: 15 },

  async render(container) {
    const summary = await API.getDashboard();
    const tasks = await API.getTasks();
    const activeTasks = tasks.filter(t => t.status !== 'done');

    const active = FocusTimer.state;
    const displayType = this.displayType(active);
    const onRunningTab = this.onRunningTab(active);
    const timeText = onRunningTab ? FocusTimer.formatRemaining() : this.formatTime(this.DURATIONS[displayType] * 60);
    const taskForSelect = onRunningTab ? (active.taskId || '') : (this.selectedTaskId || '');

    // A re-render must never swallow a thought being typed: keep the draft (and
    // the caret) across repaints triggered by the timer.
    const draftInput = container.querySelector('#focus-capture-input');
    const draft = draftInput ? draftInput.value : '';
    const draftFocused = Boolean(draftInput && document.activeElement === draftInput);
    const draftCaret = draftInput ? draftInput.selectionStart : 0;

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:2rem;max-width:1100px;margin:0 auto">
        <!-- Left: Focus Engine -->
        <div>
          <div class="focus-card">
            <div class="timer-tabs">
              ${[['focus', 'Deep Focus'], ['short_break', 'Short Break'], ['long_break', 'Rest']].map(([type, label]) => `
                <div class="timer-tab ${displayType === type ? 'active' : ''}" data-type="${type}" data-mins="${this.DURATIONS[type]}" data-testid="tab-${type}">${label} (${this.DURATIONS[type]}m)</div>`).join('')}
            </div>

            <div style="margin-bottom:0.75rem">
              <select id="focus-task-select" data-testid="focus-task-select" ${onRunningTab ? 'disabled title="Attached to the running block"' : ''} style="padding:0.4rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border-light);background:var(--bg-surface);color:var(--text-primary);font-size:0.88rem;max-width:280px">
                <option value="">-- No specific task attached --</option>
                ${activeTasks.map(t => `<option value="${t.id}" ${t.id === taskForSelect ? 'selected' : ''}>${escapeHtml(t.title)}</option>`).join('')}
                ${onRunningTab && active.taskId && !activeTasks.some(t => t.id === active.taskId) ? `<option value="${active.taskId}" selected>${escapeHtml(active.taskTitle || 'Attached task')}</option>` : ''}
              </select>
            </div>

            <div class="timer-display" id="timer-display" data-testid="timer-display">${timeText}</div>

            <div class="timer-status" id="timer-status" data-testid="timer-status" style="font-size:0.78rem;color:var(--text-muted);margin-bottom:0.75rem;min-height:1.1em">
              ${this.statusText(active)}
            </div>

            <div class="timer-controls" id="timer-controls">
              ${this.controlsHtml(active)}
            </div>

            <div class="focus-capture" data-testid="focus-capture">
              <input type="text" id="focus-capture-input" data-testid="focus-capture-input" maxlength="500"
                     placeholder="Park a thought… (Enter) — the timer keeps running" autocomplete="off">
            </div>

            <div class="ambient-sound-bar">
              <span style="font-size:0.8rem;font-weight:600">Soundscape:</span>
              <button class="sound-btn ${AmbientAudio.activeType === null ? 'active' : ''}" data-sound="none">Off</button>
              <button class="sound-btn ${AmbientAudio.activeType === 'rain' ? 'active' : ''}" data-sound="rain">🌧 Rain</button>
              <button class="sound-btn ${AmbientAudio.activeType === 'brown' ? 'active' : ''}" data-sound="brown">🌊 Brown Noise</button>
              <button class="sound-btn ${AmbientAudio.activeType === 'white' ? 'active' : ''}" data-sound="white">📻 White Noise</button>
              <span style="font-size:0.72rem;color:var(--text-muted);margin-left:auto">Press S</span>
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
              <span>Focused Today: <strong style="color:var(--text-primary)" data-testid="metric-focus-today">${summary.focusTodayMinutes}m</strong></span>
              <span>Completed Tasks: <strong style="color:var(--text-primary)">${summary.completedToday}</strong></span>
              <span>Current Streak: <strong style="color:var(--accent)">${summary.streak} days</strong></span>
            </div>
          </div>
        </div>
      </div>
    `;

    const restored = container.querySelector('#focus-capture-input');
    if (restored && draft) {
      restored.value = draft;
      if (draftFocused) {
        restored.focus();
        restored.setSelectionRange(draftCaret, draftCaret);
      }
    }

    this.bindEvents(container);
    this.subscribe(container);
  },

  /** Keeps the big countdown in step with the server-owned timer. */
  subscribe(container) {
    this.container = container;
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = FocusTimer.onChange((state, previous) => {
      // The shell reuses one #page-content element, so "still in the DOM" is not
      // enough: stop as soon as another view owns the page.
      const stillMine = document.body.contains(container)
        && (typeof App === 'undefined' || App.currentView === 'today')
        && container.querySelector('#timer-display');
      if (!stillMine) {
        this.unsubscribe?.();
        this.unsubscribe = null;
        return;
      }
      const changedBlock = Boolean(previous) !== Boolean(state) || (state && previous && state.id !== previous.id);
      const changedRunning = state && previous && state.running !== previous.running;
      if (changedBlock) {
        // A block started or ended: controls and today's metrics change.
        if (!state) this.selectedType = null;
        this.render(container);
        return;
      }
      if (changedRunning) {
        const controls = container.querySelector('#timer-controls');
        if (controls) {
          controls.innerHTML = this.controlsHtml(state);
          this.bindControls(container);
        }
      }
      this.paint(container, state);
    });
  },

  displayType(state) {
    return this.selectedType || (state ? state.type : 'focus');
  },

  /** True when the card is showing the block that is actually running/paused. */
  onRunningTab(state) {
    return Boolean(state) && this.displayType(state) === state.type;
  },

  controlsHtml(state) {
    const popout = '<button class="btn btn-secondary" id="timer-popout-btn" data-testid="timer-popout" title="Pop out the countdown into a small window">⧉ Pop out</button>';
    if (!state) {
      return `<button class="btn btn-primary" id="timer-toggle-btn" data-testid="timer-toggle" style="min-width:120px;font-size:1rem;padding:0.65rem 1.25rem">▶ Start Flow</button>${popout}`;
    }
    if (this.onRunningTab(state)) {
      return `
        <button class="btn btn-primary" id="timer-toggle-btn" data-testid="timer-toggle" style="min-width:120px;font-size:1rem;padding:0.65rem 1.25rem">${state.running ? '⏸ Pause' : '▶ Resume'}</button>
        <button class="btn btn-secondary" id="timer-stop-btn" data-testid="timer-stop" title="End this block and record the time spent">■ Stop</button>
        <button class="btn btn-secondary" id="timer-reset-btn" data-testid="timer-reset" title="Restart this block from the top (what was done so far is recorded)">↺ Reset</button>
        ${popout}`;
    }
    const label = FocusTimer.typeLabel(this.displayType(state));
    return `
      <button class="btn btn-primary" id="timer-switch-btn" data-testid="timer-switch" style="min-width:120px;font-size:1rem;padding:0.65rem 1.25rem" title="Records the running ${FocusTimer.typeLabel(state.type)} block, then starts ${label}">▶ Start ${label}</button>
      ${popout}`;
  },

  /** Per-tick update for the running tab: digits, status line and the pause label. */
  paint(container, state) {
    const status = container.querySelector('#timer-status');
    if (status) status.textContent = this.statusText(state);
    if (!this.onRunningTab(state)) return;
    const display = container.querySelector('#timer-display');
    if (display) display.textContent = FocusTimer.formatRemaining();
    const toggle = container.querySelector('#timer-toggle-btn');
    if (toggle) toggle.textContent = state.running ? '⏸ Pause' : '▶ Resume';
  },

  statusText(state) {
    const shown = this.displayType(state);
    if (!state) return `Ready: ${FocusTimer.typeLabel(shown)} · ${this.DURATIONS[shown]}m.`;
    const elapsed = Math.floor(FocusTimer.elapsedMs() / 60000);
    const running = `${FocusTimer.typeLabel(state.type)} ${state.running ? 'running' : 'paused'} · ${elapsed}m of ${state.plannedMinutes}m`;
    if (this.onRunningTab(state)) return running;
    return `${running}. “Start ${FocusTimer.typeLabel(shown)}” records it first, then begins ${this.DURATIONS[shown]}m of ${FocusTimer.typeLabel(shown)}.`;
  },

  formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  },

  bindControls(container) {
    const fail = (err, what) => showToast(err.message || `Could not ${what}`, 'error');

    container.querySelector('#timer-toggle-btn')?.addEventListener('click', async () => {
      const state = FocusTimer.state;
      try {
        if (!state) {
          const type = this.displayType(null);
          await FocusTimer.start(type, this.DURATIONS[type], this.selectedTaskId);
          this.selectedType = null;
        } else if (state.running) {
          await FocusTimer.pause();
        } else {
          await FocusTimer.resume();
        }
      } catch (err) {
        fail(err, 'update the timer');
      }
    });

    container.querySelector('#timer-stop-btn')?.addEventListener('click', async () => {
      try {
        await FocusTimer.stop();
      } catch (err) {
        fail(err, 'stop the block');
      }
    });

    container.querySelector('#timer-reset-btn')?.addEventListener('click', async () => {
      try {
        await FocusTimer.reset();
        this.selectedType = null;
      } catch (err) {
        fail(err, 'reset the block');
      }
    });

    container.querySelector('#timer-switch-btn')?.addEventListener('click', async () => {
      const type = this.displayType(FocusTimer.state);
      try {
        // The one place a running block is replaced: recorded as `switched`, then the new one starts.
        await FocusTimer.start(type, this.DURATIONS[type], this.selectedTaskId);
        this.selectedType = null;
      } catch (err) {
        fail(err, 'switch block');
      }
    });

    container.querySelector('#timer-popout-btn')?.addEventListener('click', () => FocusTimer.popOut());
  },

  bindEvents(container) {
    const taskSelect = container.querySelector('#focus-task-select');

    taskSelect?.addEventListener('change', (e) => {
      this.selectedTaskId = e.target.value || null;
    });

    this.bindControls(container);

    container.querySelectorAll('.timer-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        // Selection only. Picking the running block's tab goes back to following it.
        const state = FocusTimer.state;
        this.selectedType = state && tab.dataset.type === state.type ? null : tab.dataset.type;
        this.render(container);
      });
    });

    // Capturing a thought must never interrupt the block: no modal, no re-render,
    // no focus stealing. Type, press Enter, carry on.
    const captureInput = container.querySelector('#focus-capture-input');
    captureInput?.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const value = captureInput.value;
      captureInput.value = '';
      await ThoughtCapture.capture(value);
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
};
