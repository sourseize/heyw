// ── HeyWork: Core Application Controller ──
const App = {
  currentView: 'today',

  init() {
    this.initTheme();
    this.bindGlobalNavigation();
    this.bindKeyboardShortcuts();
    this.initTimer();
    ThoughtCapture.init();
    this.navigate(window.location.hash.slice(1) || 'today');

    window.addEventListener('hashchange', () => {
      const page = window.location.hash.slice(1) || 'today';
      this.navigate(page);
    });
  },

  /**
   * The timer is owned by the server, so the shell subscribes to it: the mini
   * countdown follows you across views, and a running focus block gently dims
   * the chrome (hover to bring it back).
   */
  initTimer() {
    FocusTimer.onChange(state => {
      this.renderMiniTimer(state);
      document.body.classList.toggle('focus-running', Boolean(state && state.running && state.type === 'focus'));
    });
    FocusTimer.init();
  },

  renderMiniTimer(state) {
    const el = document.getElementById('mini-timer');
    if (!el) return;
    // Shown on every view, the Focus view included: the focus card is only a launcher.
    const show = Boolean(state);
    el.hidden = !show;
    if (!show) {
      el.innerHTML = '';
      return;
    }

    const time = FocusTimer.formatRemaining();
    const label = FocusTimer.typeLabel(state.type);
    el.classList.toggle('mini-timer-paused', !state.running);

    const timeEl = el.querySelector('[data-testid="mini-timer-time"]');
    if (timeEl) {
      // Cheap path: only the digits change between ticks.
      timeEl.textContent = time;
      const labelEl = el.querySelector('.mini-timer-label');
      if (labelEl) labelEl.textContent = state.running ? label : `${label} · paused`;
      const toggle = el.querySelector('[data-testid="mini-timer-toggle"]');
      if (toggle) toggle.textContent = state.running ? '⏸' : '▶';
      return;
    }

    el.innerHTML = `
      <div class="mini-timer-main">
        <span class="mini-timer-time" data-testid="mini-timer-time">${time}</span>
        <span class="mini-timer-label">${state.running ? label : label + ' · paused'}</span>
      </div>
      <div class="mini-timer-actions">
        <button class="btn btn-secondary btn-sm" data-testid="mini-timer-toggle" title="Pause / resume">${state.running ? '⏸' : '▶'}</button>
        <button class="btn btn-secondary btn-sm" data-testid="mini-timer-stop" title="Stop and record">■</button>
        <button class="btn btn-secondary btn-sm" data-testid="mini-timer-popout" title="Pop out countdown">⧉</button>
      </div>
    `;
    el.querySelector('[data-testid="mini-timer-toggle"]').addEventListener('click', () => FocusTimer.toggle());
    el.querySelector('[data-testid="mini-timer-stop"]').addEventListener('click', () => FocusTimer.stop());
    el.querySelector('[data-testid="mini-timer-popout"]').addEventListener('click', () => FocusTimer.popOut());
  },

  /** Cycles soundscapes: off → rain → brown noise → white noise → off. */
  cycleSound() {
    const active = AmbientAudio.cycle();
    showToast(AmbientAudio.label(active));
    document.querySelectorAll('.sound-btn').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.sound || 'none') === (active || 'none'));
    });
  },

  initTheme() {
    const saved = localStorage.getItem('heyw-theme') || 'light';
    this.setTheme(saved);

    document.getElementById('theme-toggle')?.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      const next = current === 'light' ? 'dark' : 'light';
      this.setTheme(next);
      // Redraw current view if insights/canvas is open
      if (this.currentView === 'insights') {
        this.navigate('insights');
      }
    });
  },

  setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('heyw-theme', theme);
    const label = document.getElementById('theme-label');
    if (label) {
      label.textContent = theme === 'dark' ? '☀ Light Mode' : '🌙 Dark Mode';
    }
  },

  bindGlobalNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const page = item.dataset.page;
        window.location.hash = page;
      });
    });
  },

  bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Don't trigger shortcuts if typing in input/textarea
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName || '')) {
        return;
      }

      if (e.key === 'Escape' && ThoughtCapture.isOpen()) {
        ThoughtCapture.close();
        return;
      }

      if (e.code === 'Space' && this.currentView === 'today') {
        e.preventDefault();
        const toggleBtn = document.getElementById('timer-toggle-btn');
        toggleBtn?.click();
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        ThoughtCapture.open();
      } else if (e.key === 's' || e.key === 'S') {
        this.cycleSound();
      } else if (e.key === '1') {
        window.location.hash = 'today';
      } else if (e.key === '2') {
        window.location.hash = 'board';
      } else if (e.key === '3') {
        window.location.hash = 'journal';
      } else if (e.key === '4') {
        window.location.hash = 'notes';
      } else if (e.key === '5') {
        window.location.hash = 'insights';
      } else if (e.key === '6') {
        window.location.hash = 'inbox';
      } else if (e.key === '7') {
        window.location.hash = 'bookofwork';
      } else if (e.key === 't' || e.key === 'T') {
        document.getElementById('theme-toggle')?.click();
      }
    });
  },

  navigate(page) {
    this.currentView = page;
    this.renderMiniTimer(FocusTimer.state);
    const container = document.getElementById('page-content');
    const titleEl = document.getElementById('page-title');

    // Update active nav link
    document.querySelectorAll('.nav-item').forEach(item => {
      if (item.dataset.page === page) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    const pageTitles = {
      today: 'Focus & Today',
      board: 'Tasks & Projects',
      journal: 'Daily Journal',
      inbox: 'Thought Inbox',
      notes: 'Notes & Scratchpad',
      insights: 'Insights & Analytics',
      bookofwork: 'Book of Work',
    };

    if (titleEl) {
      titleEl.textContent = pageTitles[page] || 'HeyWork';
    }

    if (!container) return;
    container.innerHTML = '<div style="color:var(--text-muted);padding:2rem">Loading...</div>';

    switch (page) {
      case 'today':
        TodayView.render(container);
        break;
      case 'board':
        BoardView.render(container);
        break;
      case 'journal':
        JournalView.render(container);
        break;
      case 'inbox':
        InboxView.render(container);
        break;
      case 'notes':
        NotesView.render(container);
        break;
      case 'insights':
        InsightsView.render(container);
        break;
      case 'bookofwork':
        BookOfWorkView.render(container);
        break;
      default:
        TodayView.render(container);
        break;
    }
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
