// ── HeyWork: Book of Work (monthly summaries & archive) ──
//
// One auto-generated page per month: deep-work hours, flow integrity,
// accomplishments, reflections, thoughts. The month in progress is computed
// live; closed months are frozen by the server and listed in the archive on
// the right, each downloadable as Markdown.
const BookOfWorkView = {
  month: null, // YYYY-MM being shown; null = current month

  MONTHS: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],

  title(month) {
    const [y, m] = month.split('-').map(Number);
    return `${this.MONTHS[m - 1]} ${y}`;
  },

  shift(month, delta) {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  },

  hours(minutes) {
    return `${Math.round((minutes / 60) * 10) / 10}h`;
  },

  async render(container) {
    let page;
    let archive;
    try {
      [page, archive] = await Promise.all([API.getMonthlySummary(this.month), API.getSummaryMonths()]);
    } catch (err) {
      container.innerHTML = `<div class="empty-hint">Could not load the Book of Work: ${escapeHtml(err.message)}</div>`;
      return;
    }
    const s = page.summary;
    this.month = s.month;
    const current = archive.find(a => a.current);
    const newest = current ? current.month : s.month;

    container.innerHTML = `
      <div class="journal-layout">
        <div>
          <div class="bow-header">
            <div>
              <div class="bow-nav">
                <button class="btn btn-secondary btn-sm" id="bow-prev" data-testid="bow-prev" title="Previous month">‹</button>
                <h2 data-testid="bow-title">${this.title(s.month)}</h2>
                <button class="btn btn-secondary btn-sm" id="bow-next" data-testid="bow-next" ${s.month >= newest ? 'disabled' : ''} title="Next month">›</button>
              </div>
              <p class="bow-subtitle" data-testid="bow-status">
                ${page.current
                  ? `In progress — day ${s.daysElapsed} of ${s.daysInMonth}. Frozen automatically once the month ends.`
                  : page.frozen
                    ? `Frozen ${new Date(page.frozenAt).toLocaleDateString()} · ${escapeHtml(s.timeZone)}`
                    : 'Not frozen yet — computed live.'}
              </p>
            </div>
            <div class="bow-actions">
              ${!page.current ? `<button class="btn btn-secondary btn-sm" id="bow-freeze" data-testid="bow-freeze" title="Recompute this month's page from the current data">${page.frozen ? '↻ Regenerate' : '❄ Freeze now'}</button>` : ''}
              <a class="btn btn-primary btn-sm" id="bow-download" data-testid="bow-download" href="/api/summary/monthly/${s.month}.md?tz=${encodeURIComponent(API.timeZone)}" download="heywork-book-of-work-${s.month}.md">⬇ Download .md</a>
            </div>
          </div>

          <div class="stats-cards">
            <div class="stat-box"><div class="label">Deep work</div><div class="number" style="color:var(--accent)" data-testid="bow-deepwork">${this.hours(s.deepWork.totalMinutes)}</div></div>
            <div class="stat-box"><div class="label">Focus blocks</div><div class="number" data-testid="bow-sessions">${s.deepWork.sessions}</div></div>
            <div class="stat-box"><div class="label">Active days</div><div class="number">${s.deepWork.activeDays}<span class="stat-sub">/ ${s.daysInMonth}</span></div></div>
            <div class="stat-box"><div class="label">Tasks done</div><div class="number" data-testid="bow-tasks">${s.accomplishments.tasksCompleted}</div></div>
          </div>

          <div class="chart-card">
            <h3>Deep work per week (minutes)</h3>
            <canvas id="bow-week-chart" width="760" height="200"></canvas>
          </div>

          ${this.sectionDeepWork(s)}
          ${this.sectionFlow(s)}
          ${this.sectionAccomplishments(s)}
          ${this.sectionReflections(s)}
          ${this.sectionThoughts(s)}
        </div>

        <div>
          <div class="bow-archive" data-testid="bow-archive">
            <h3>Archive</h3>
            ${archive.length === 0 ? '<div class="empty-hint">No months yet.</div>' : ''}
            <div class="bow-archive-list">
              ${archive.map(a => `
                <div class="bow-archive-item ${a.month === s.month ? 'active' : ''}" data-month="${a.month}" data-testid="bow-archive-item">
                  <div class="bow-archive-main">
                    <span class="bow-archive-month">${this.title(a.month)}</span>
                    <span class="bow-archive-meta">${a.current ? 'in progress' : a.frozen ? '❄ frozen' : 'live'} · ${this.hours(a.deepWorkMinutes)} · ${a.tasksCompleted} tasks</span>
                  </div>
                  <a class="btn btn-secondary btn-sm bow-archive-download" title="Download ${a.month} as Markdown" href="/api/summary/monthly/${a.month}.md?tz=${encodeURIComponent(API.timeZone)}" download="heywork-book-of-work-${a.month}.md" data-testid="bow-archive-download">⬇</a>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    const canvas = container.querySelector('#bow-week-chart');
    if (canvas) {
      CanvasCharts.drawBarChart(canvas, s.deepWork.byWeek.map(w => ({
        label: `${w.weekStart.slice(5)}–${w.weekEnd.slice(5)}`,
        value: w.minutes,
      })));
    }

    this.bindEvents(container, page);
  },

  sectionDeepWork(s) {
    const dw = s.deepWork;
    if (dw.sessions === 0) return `<section class="bow-section"><h3>Deep work</h3><div class="empty-hint">No focus blocks this month.</div></section>`;
    return `
      <section class="bow-section">
        <h3>Deep work</h3>
        <ul class="bow-list">
          <li><strong>${this.hours(dw.totalMinutes)}</strong> across ${dw.sessions} blocks · avg ${dw.avgSessionMinutes}m · ${dw.completedSessions} ran to the planned end</li>
          ${dw.bestDay ? `<li>Best day: <strong>${dw.bestDay.date}</strong> with ${dw.bestDay.minutes}m</li>` : ''}
          <li>Longest streak: <strong>${dw.longestStreakDays}</strong> day${dw.longestStreakDays === 1 ? '' : 's'} · breaks taken: ${dw.breakMinutes}m</li>
        </ul>
        <table class="bow-table">
          <thead><tr><th>Project</th><th>Deep work</th><th>Blocks</th><th>Share</th></tr></thead>
          <tbody>
            ${dw.byProject.map(p => `<tr><td>${escapeHtml(p.projectName)}</td><td>${this.hours(p.minutes)}</td><td>${p.sessions}</td><td>${dw.totalMinutes ? Math.round((p.minutes / dw.totalMinutes) * 100) : 0}%</td></tr>`).join('')}
          </tbody>
        </table>
      </section>`;
  },

  sectionFlow(s) {
    const f = s.flow;
    if (f.sessionsWithSignals === 0) return '';
    const e = f.endings;
    return `
      <section class="bow-section">
        <h3>Flow integrity</h3>
        <ul class="bow-list">
          <li><strong>${f.uninterruptedSessions}</strong> of ${f.sessionsWithSignals} blocks ran with no tab-switching and no clicks inside HeyWork</li>
          <li>Away from the window ${Math.round(f.awayMinutes)}m over ${f.distractions} departure${f.distractions === 1 ? '' : 's'} · ${f.appInteractions} interactions with the app${f.unverifiedMinutes > 0 ? ` · ${Math.round(f.unverifiedMinutes)}m unverified` : ''}</li>
          <li>Endings: ${e.completed} completed · ${e.stopped} stopped · ${e.switched} switched · ${e.abandoned} abandoned</li>
        </ul>
      </section>`;
  },

  sectionAccomplishments(s) {
    const a = s.accomplishments;
    if (a.tasksCompleted === 0) return `<section class="bow-section"><h3>Accomplishments</h3><div class="empty-hint">No tasks completed this month.</div></section>`;
    const bp = a.byPriority;
    return `
      <section class="bow-section" data-testid="bow-accomplishments">
        <h3>Accomplishments</h3>
        <ul class="bow-list">
          <li><strong>${a.tasksCompleted} tasks completed</strong> — ${bp.urgent} urgent · ${bp.high} high · ${bp.medium} medium · ${bp.low} low; ${a.tasksCreated} created, ${a.tasksStillOpen} still open</li>
          ${a.estimationAccuracy.ratio !== null ? `<li>Estimation: ${a.estimationAccuracy.actual}m spent against ${a.estimationAccuracy.estimated}m estimated (×${a.estimationAccuracy.ratio})</li>` : ''}
        </ul>
        ${a.byProject.map(p => `
          <h4 class="bow-subhead">${escapeHtml(p.projectName)}</h4>
          <ul class="bow-tasks">
            ${p.tasks.map(t => `<li><span class="badge badge-${t.priority}">${t.priority}</span> ${escapeHtml(t.title)} <span class="bow-muted">— ${t.completedOn}, ${t.actualMinutes}m${t.estimatedMinutes !== null ? ` / ${t.estimatedMinutes}m` : ''}</span></li>`).join('')}
          </ul>
        `).join('')}
      </section>`;
  },

  sectionReflections(s) {
    const r = s.reflections;
    if (r.journalDays === 0) return `<section class="bow-section"><h3>Reflections</h3><div class="empty-hint">No journal entries this month.</div></section>`;
    return `
      <section class="bow-section" data-testid="bow-reflections">
        <h3>Reflections</h3>
        <p class="bow-muted">${r.journalDays} journal day${r.journalDays === 1 ? '' : 's'} · average energy ⚡${r.avgEnergy} · average focus 🎯${r.avgFocus}</p>
        ${r.entries.map(e => `
          <div class="bow-entry">
            <div class="bow-entry-head"><strong>${e.date}</strong> <span class="bow-muted">⚡${e.energyRating} 🎯${e.focusRating}</span></div>
            ${e.intentions.length ? `<div class="bow-muted">Intentions: ${e.intentions.map(i => `<em>${escapeHtml(i)}</em>`).join(' · ')}</div>` : ''}
            ${e.retro.trim() ? `<blockquote class="bow-quote">${escapeHtml(e.retro)}</blockquote>` : ''}
          </div>
        `).join('')}
      </section>`;
  },

  sectionThoughts(s) {
    const t = s.thoughts;
    return `
      <section class="bow-section">
        <h3>Thoughts parked</h3>
        ${t.captured === 0
          ? '<div class="empty-hint">Nothing captured this month.</div>'
          : `<ul class="bow-list"><li>${t.captured} captured (${t.capturedDuringFocus} during deep focus) → ${t.converted} became tasks · ${t.kept} kept · ${t.discarded} discarded · ${t.pendingInbox} still waiting</li></ul>`}
        <p class="bow-muted">Notes: ${s.notes.created} created · ${s.notes.updated} updated</p>
      </section>`;
  },

  bindEvents(container, page) {
    container.querySelector('#bow-prev')?.addEventListener('click', () => {
      this.month = this.shift(page.summary.month, -1);
      this.render(container);
    });
    container.querySelector('#bow-next')?.addEventListener('click', () => {
      this.month = this.shift(page.summary.month, 1);
      this.render(container);
    });
    container.querySelectorAll('.bow-archive-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('a')) return; // the download link handles itself
        this.month = item.dataset.month;
        this.render(container);
      });
    });
    container.querySelector('#bow-freeze')?.addEventListener('click', async () => {
      try {
        await API.freezeMonth(page.summary.month);
        showToast(`${this.title(page.summary.month)} ${page.frozen ? 'regenerated' : 'frozen'}`, 'success');
        this.render(container);
      } catch (err) {
        showToast(err.message || 'Could not freeze that month', 'error');
      }
    });
  },
};
