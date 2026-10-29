// ── HeyWork: Daily Journal & Retrospective View ──
const JournalView = {
  currentDate: localDateStr(),

  async render(container) {
    let log = null;
    try {
      log = await API.getDailyLog(this.currentDate);
    } catch {
      log = {
        date: this.currentDate,
        intentions: ['', '', ''],
        retro: '',
        energyRating: 4,
        focusRating: 4,
        notes: '',
      };
    }

    const intentions = log.intentions && log.intentions.length >= 3
      ? log.intentions
      : [...(log.intentions || []), '', '', ''].slice(0, 3);

    const logsList = await API.getDailyLogs(10);

    container.innerHTML = `
      <div class="journal-layout">
        <!-- Main Entry Form -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
            <div>
              <h2 style="font-size:1.25rem;font-weight:700">Daily Journal & Retrospective</h2>
              <p style="font-size:0.85rem;color:var(--text-muted)">Plan with clarity, reflect with gratitude</p>
            </div>
            <input type="date" id="journal-date-picker" value="${this.currentDate}" style="padding:0.4rem 0.6rem;border:1px solid var(--border-light);border-radius:var(--radius-sm);background:var(--bg-surface);color:var(--text-primary)">
          </div>

          <!-- Morning Intentions -->
          <div class="journal-card">
            <h2>🌅 Morning Intentions</h2>
            <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:0.75rem">Define your 3 non-negotiable wins for today:</p>
            <div class="intentions-list">
              <div class="intention-item">
                <span style="font-weight:bold;color:var(--accent)">1.</span>
                <input type="text" class="intention-input" data-index="0" value="${escapeHtml(intentions[0] || '')}" placeholder="Primary mission..." style="border:none;background:transparent;width:100%;font-size:0.9rem;outline:none;color:var(--text-primary)">
              </div>
              <div class="intention-item">
                <span style="font-weight:bold;color:var(--accent)">2.</span>
                <input type="text" class="intention-input" data-index="1" value="${escapeHtml(intentions[1] || '')}" placeholder="Secondary objective..." style="border:none;background:transparent;width:100%;font-size:0.9rem;outline:none;color:var(--text-primary)">
              </div>
              <div class="intention-item">
                <span style="font-weight:bold;color:var(--accent)">3.</span>
                <input type="text" class="intention-input" data-index="2" value="${escapeHtml(intentions[2] || '')}" placeholder="Key follow-up..." style="border:none;background:transparent;width:100%;font-size:0.9rem;outline:none;color:var(--text-primary)">
              </div>
            </div>
          </div>

          <!-- Evening Retrospective -->
          <div class="journal-card">
            <h2>🌙 Evening Retrospective</h2>
            <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:0.75rem">What went well? What did you learn? Any blockers?</p>
            <textarea id="journal-retro" class="textarea-clean" placeholder="Reflect on today's progress and mindset...">${escapeHtml(log.retro || '')}</textarea>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-top:1.25rem">
              <div>
                <label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:0.35rem">Energy Level (1–5)</label>
                <div class="rating-group" data-target="energy">
                  ${[1, 2, 3, 4, 5].map(v => `<button type="button" class="btn btn-secondary btn-sm rating-btn ${log.energyRating === v ? 'active' : ''}" data-val="${v}" style="${log.energyRating === v ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : ''}">${v} ⚡</button>`).join(' ')}
                </div>
              </div>
              <div>
                <label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:0.35rem">Focus Level (1–5)</label>
                <div class="rating-group" data-target="focus">
                  ${[1, 2, 3, 4, 5].map(v => `<button type="button" class="btn btn-secondary btn-sm rating-btn ${log.focusRating === v ? 'active' : ''}" data-val="${v}" style="${log.focusRating === v ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : ''}">${v} 🎯</button>`).join(' ')}
                </div>
              </div>
            </div>

            <div style="margin-top:1.5rem;text-align:right">
              <button class="btn btn-primary" id="save-journal-btn">Save Journal Entry</button>
            </div>
          </div>
        </div>

        <!-- Past Entries Sidebar -->
        <div>
          <div style="background:var(--bg-surface);border:1px solid var(--border-light);border-radius:var(--radius-md);padding:1.25rem">
            <h3 style="font-size:0.95rem;font-weight:600;margin-bottom:1rem">Recent Entries</h3>
            <div style="display:flex;flex-direction:column;gap:0.6rem">
              ${logsList.map(l => `
                <div class="journal-history-item" data-date="${l.date}" style="cursor:pointer;padding:0.6rem 0.75rem;border-radius:var(--radius-sm);background:${l.date === this.currentDate ? 'var(--accent-light)' : 'var(--bg-subtle)'};display:flex;justify-content:space-between;align-items:center">
                  <span style="font-weight:600;font-size:0.85rem">${l.date}</span>
                  <span style="font-size:0.75rem;color:var(--text-muted)">⚡ ${l.energyRating || 3} • 🎯 ${l.focusRating || 3}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents(container, log);
  },

  bindEvents(container, currentLog) {
    let energyVal = currentLog.energyRating || 4;
    let focusVal = currentLog.focusRating || 4;

    container.querySelector('#journal-date-picker')?.addEventListener('change', (e) => {
      this.currentDate = e.target.value;
      this.render(container);
    });

    container.querySelectorAll('.journal-history-item').forEach(item => {
      item.addEventListener('click', () => {
        this.currentDate = item.dataset.date;
        this.render(container);
      });
    });

    container.querySelectorAll('.rating-group[data-target="energy"] .rating-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.rating-group[data-target="energy"] .rating-btn').forEach(b => {
          b.style.background = '';
          b.style.color = '';
          b.style.borderColor = '';
        });
        btn.style.background = 'var(--accent)';
        btn.style.color = '#fff';
        btn.style.borderColor = 'var(--accent)';
        energyVal = parseInt(btn.dataset.val, 10);
      });
    });

    container.querySelectorAll('.rating-group[data-target="focus"] .rating-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.rating-group[data-target="focus"] .rating-btn').forEach(b => {
          b.style.background = '';
          b.style.color = '';
          b.style.borderColor = '';
        });
        btn.style.background = 'var(--accent)';
        btn.style.color = '#fff';
        btn.style.borderColor = 'var(--accent)';
        focusVal = parseInt(btn.dataset.val, 10);
      });
    });

    container.querySelector('#save-journal-btn')?.addEventListener('click', async () => {
      const intentions = Array.from(container.querySelectorAll('.intention-input')).map(input => input.value.trim()).filter(Boolean);
      const retro = container.querySelector('#journal-retro').value.trim();

      await API.saveDailyLog({
        date: this.currentDate,
        intentions,
        retro,
        energyRating: energyVal,
        focusRating: focusVal,
      });

      showToast('Daily journal saved', 'success');
      this.render(container);
    });
  }
};
