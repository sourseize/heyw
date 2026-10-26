// ── HeyWork: Core Application Controller ──
const App = {
  currentView: 'today',

  init() {
    this.initTheme();
    this.bindGlobalNavigation();
    this.bindKeyboardShortcuts();
    this.navigate(window.location.hash.slice(1) || 'today');

    window.addEventListener('hashchange', () => {
      const page = window.location.hash.slice(1) || 'today';
      this.navigate(page);
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

      if (e.code === 'Space' && this.currentView === 'today') {
        e.preventDefault();
        const toggleBtn = document.getElementById('timer-toggle-btn');
        toggleBtn?.click();
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
      }
    });
  },

  navigate(page) {
    this.currentView = page;
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
      notes: 'Notes & Scratchpad',
      insights: 'Insights & Analytics',
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
      case 'notes':
        NotesView.render(container);
        break;
      case 'insights':
        InsightsView.render(container);
        break;
      default:
        TodayView.render(container);
        break;
    }
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
