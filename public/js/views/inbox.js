// ── HeyWork: Thought Inbox (capture & triage) ──
//
// Thoughts parked during a focus block land here. Each one gets one of three
// decisions: turn it into a task, keep it for later, or discard it. Discarding
// only takes it out of sight — nothing is deleted, and anything can come back.
const InboxView = {
  tab: 'inbox',
  /** Resolved `[[mentions]]` per thought id, for the cards on screen. */
  mentions: new Map(),

  TABS: [
    { id: 'inbox', label: 'Inbox', empty: 'Nothing parked. Press P during a focus block to capture a thought without breaking flow.' },
    { id: 'kept', label: 'Kept for later', empty: 'Nothing kept for later yet.' },
    { id: 'converted', label: 'Became tasks', empty: 'No thoughts have become tasks yet.' },
    { id: 'discarded', label: 'Discarded', empty: 'Nothing discarded.' },
  ],

  async render(container, params = {}) {
    // Deep link `#inbox/<thoughtId>`: open the tab the thought lives in and highlight it.
    const requested = params.path && params.path[0];
    let highlight = null;
    if (requested) {
      const all = await API.getThoughts();
      const found = all.find(t => t.id === requested);
      if (found) {
        this.tab = found.status;
        highlight = found.id;
      } else {
        showToast('That thought no longer exists', 'error');
      }
    }

    const [thoughts, counts] = await Promise.all([
      API.getThoughts(this.tab),
      this.loadCounts(),
    ]);
    this.mentions = await Links.previewMany(thoughts.map(t => ({ id: t.id, text: t.text })));

    container.innerHTML = `
      <div style="max-width:820px;margin:0 auto">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.25rem">
          <div>
            <h2 style="font-size:1.25rem;font-weight:700">Thought Inbox</h2>
            <p style="font-size:0.85rem;color:var(--text-muted)">Park distractions mid-flow, decide later — task, later, or gone.</p>
          </div>
          <button class="btn btn-secondary btn-sm" data-testid="inbox-capture-btn">+ Park a thought</button>
        </div>

        <div class="inbox-tabs" role="tablist">
          ${this.TABS.map(t => `
            <button class="inbox-tab ${this.tab === t.id ? 'active' : ''}" data-tab="${t.id}" data-testid="inbox-tab-${t.id}" role="tab">
              ${t.label}${counts[t.id] ? ` <span class="inbox-tab-count">${counts[t.id]}</span>` : ''}
            </button>
          `).join('')}
        </div>

        <div id="thought-list" data-testid="thought-list" style="display:flex;flex-direction:column;gap:0.65rem;margin-top:1.1rem">
          ${thoughts.length === 0
            ? `<div class="empty-hint" data-testid="inbox-empty">${this.TABS.find(t => t.id === this.tab).empty}</div>`
            : thoughts.map(t => this.card(t)).join('')}
        </div>
      </div>
    `;

    this.bindEvents(container);

    if (highlight) {
      const card = container.querySelector(`.thought-card[data-id="${highlight}"]`);
      if (card) {
        card.classList.add('thought-card-highlight');
        card.scrollIntoView({ block: 'center' });
      }
    }
  },

  async loadCounts() {
    const all = await API.getThoughts();
    return all.reduce((acc, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1;
      return acc;
    }, {});
  },

  card(thought) {
    const ref = { type: 'thought', id: thought.id };
    const connect = `
        <button class="btn btn-secondary btn-sm" data-act="link" data-id="${thought.id}" data-testid="thought-link" title="Link this thought to a note or task">⛓ Link to…</button>
        <a class="btn btn-secondary btn-sm" href="${Links.graphHrefFor(ref)}" data-testid="thought-graph" title="See what this thought connects to">◎</a>`;
    const actions = {
      inbox: `
        <button class="btn btn-primary btn-sm" data-act="convert" data-id="${thought.id}" data-testid="thought-convert">→ Task</button>
        <button class="btn btn-secondary btn-sm" data-act="kept" data-id="${thought.id}" data-testid="thought-keep">Keep for later</button>
        <button class="btn btn-secondary btn-sm" data-act="discarded" data-id="${thought.id}" data-testid="thought-discard">Discard</button>${connect}`,
      kept: `
        <button class="btn btn-primary btn-sm" data-act="convert" data-id="${thought.id}" data-testid="thought-convert">→ Task</button>
        <button class="btn btn-secondary btn-sm" data-act="inbox" data-id="${thought.id}">Back to inbox</button>
        <button class="btn btn-secondary btn-sm" data-act="discarded" data-id="${thought.id}" data-testid="thought-discard">Discard</button>${connect}`,
      converted: `
        <span class="thought-linked" data-testid="thought-linked">✓ on the board</span>
        ${thought.taskId ? `<a class="btn btn-secondary btn-sm" href="${Links.hrefFor({ type: 'task', id: thought.taskId })}" data-testid="thought-open-task">↗ Open task</a>` : ''}${connect}`,
      discarded: `
        <button class="btn btn-secondary btn-sm" data-act="inbox" data-id="${thought.id}" data-testid="thought-restore">Restore</button>`,
    };

    return `
      <div class="thought-card" data-id="${thought.id}" data-testid="thought-card">
        <div class="thought-text">${Links.renderInline(thought.text, this.mentions.get(thought.id))}</div>
        <div class="thought-meta">${this.contextLine(thought)}</div>
        <div class="thought-actions">${actions[thought.status] || ''}</div>
      </div>
    `;
  },

  contextLine(thought) {
    const when = new Date(thought.capturedAt);
    const time = when.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const ctx = thought.context;
    if (!ctx) return `captured ${time}`;
    const labels = { focus: 'Deep Focus', short_break: 'a Short Break', long_break: 'Rest' };
    let line = `captured ${time}`;
    if (ctx.timerRunning && ctx.timerType) line += ` during ${labels[ctx.timerType] || 'a block'}`;
    if (ctx.taskTitle) {
      line += ctx.taskId
        ? ` on ${Links.chip({ type: 'task', id: ctx.taskId }, ctx.taskTitle, { max: 40 })}`
        : ` on “${escapeHtml(ctx.taskTitle)}”`;
    }
    return line;
  },

  bindEvents(container) {
    container.querySelectorAll('.inbox-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.tab = btn.dataset.tab;
        this.render(container);
      });
    });

    container.querySelector('[data-testid="inbox-capture-btn"]')?.addEventListener('click', () => {
      ThoughtCapture.open();
    });

    container.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const act = btn.dataset.act;
        try {
          if (act === 'convert') {
            await this.convert(container, id);
            return;
          }
          if (act === 'link') {
            LinkPicker.open({ from: { type: 'thought', id }, onLinked: () => this.render(container) });
            return;
          }
          await API.updateThought(id, { status: act });
          const messages = {
            kept: 'Kept for later',
            discarded: 'Discarded — out of sight, not gone',
            inbox: 'Back in your inbox',
          };
          showToast(messages[act] || 'Updated');
          ThoughtCapture.refreshBadge();
          this.render(container);
        } catch (err) {
          showToast(err.message || 'Could not update that thought', 'error');
        }
      });
    });
  },

  async convert(container, id) {
    const thoughts = await API.getThoughts();
    const thought = thoughts.find(t => t.id === id);
    if (!thought) return;

    showModal('Turn this thought into a task', `
      <div style="display:flex;flex-direction:column;gap:0.85rem">
        <div>
          <label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:0.25rem">Task title</label>
          <input type="text" id="convert-title" data-testid="convert-title" value="${escapeHtml(thought.text)}" style="width:100%;padding:0.6rem;border:1px solid var(--border-light);border-radius:var(--radius-sm)">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
          <div>
            <label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:0.25rem">Status</label>
            <select id="convert-status" style="width:100%;padding:0.5rem;border:1px solid var(--border-light);border-radius:var(--radius-sm)">
              <option value="todo">To Do</option>
              <option value="backlog">Backlog</option>
              <option value="in_progress">In Progress</option>
            </select>
          </div>
          <div>
            <label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:0.25rem">Priority</label>
            <select id="convert-priority" style="width:100%;padding:0.5rem;border:1px solid var(--border-light);border-radius:var(--radius-sm)">
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>
      </div>
    `, async () => {
      const title = document.getElementById('convert-title').value.trim();
      if (!title) return false;
      try {
        await API.convertThought(id, {
          title,
          status: document.getElementById('convert-status').value,
          priority: document.getElementById('convert-priority').value,
        });
        showToast('Thought is now a task on your board', 'success');
        ThoughtCapture.refreshBadge();
        this.render(container);
        return true;
      } catch (err) {
        showToast(err.message || 'Could not create the task', 'error');
        return false;
      }
    });
  },
};

// ── Global capture bar (P from anywhere, Enter to save) ──
const ThoughtCapture = {
  open(prefill = '') {
    const bar = document.getElementById('capture-bar');
    const input = document.getElementById('capture-bar-input');
    if (!bar || !input) return;
    bar.hidden = false;
    input.value = prefill;
    input.focus();
  },

  close() {
    const bar = document.getElementById('capture-bar');
    const input = document.getElementById('capture-bar-input');
    if (!bar) return;
    bar.hidden = true;
    if (input) input.value = '';
  },

  isOpen() {
    const bar = document.getElementById('capture-bar');
    return Boolean(bar && !bar.hidden);
  },

  /** Context makes a thought recallable later: what was running, on which task. */
  context() {
    const state = typeof FocusTimer !== 'undefined' ? FocusTimer.state : null;
    return {
      view: typeof App !== 'undefined' ? App.currentView : 'unknown',
      timerRunning: Boolean(state && state.running),
      timerType: state ? state.type : undefined,
      taskId: state ? state.taskId : undefined,
    };
  },

  /** Saves without stealing focus or interrupting the block. */
  async capture(text, options = {}) {
    const trimmed = (text || '').trim();
    if (!trimmed) return null;
    try {
      const thought = await API.captureThought(trimmed, this.context());
      showToast('Parked — back to it', 'success');
      this.refreshBadge();
      if (options.onSaved) options.onSaved(thought);
      return thought;
    } catch (err) {
      showToast(err.message || 'Could not park that thought', 'error');
      return null;
    }
  },

  async refreshBadge() {
    const badge = document.getElementById('inbox-badge');
    if (!badge) return;
    try {
      const inbox = await API.getThoughts('inbox');
      badge.textContent = String(inbox.length);
      badge.hidden = inbox.length === 0;
    } catch {
      badge.hidden = true;
    }
  },

  init() {
    const input = document.getElementById('capture-bar-input');
    if (!input) return;
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const value = input.value;
        input.value = '';
        const saved = await this.capture(value);
        if (saved && App.currentView === 'inbox') {
          InboxView.render(document.getElementById('page-content'));
        }
        this.close();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    document.addEventListener('click', (e) => {
      const bar = document.getElementById('capture-bar');
      if (this.isOpen() && bar && !bar.contains(e.target)) this.close();
    });
    this.refreshBadge();
  },
};
