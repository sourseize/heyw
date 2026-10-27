// ── HeyWork: Insights & Analytics View ──
const InsightsView = {
  async render(container) {
    const summary = await API.getDashboard();
    const sessions = await API.getFocusSessions(20);

    container.innerHTML = `
      <div style="max-width:1000px;margin:0 auto">
        <div style="margin-bottom:1.5rem">
          <h2 style="font-size:1.25rem;font-weight:700">Deep Work & Habit Analytics</h2>
          <p style="font-size:0.85rem;color:var(--text-muted)">Objective metrics on your flow state and consistency</p>
        </div>

        <div class="stats-cards">
          <div class="stat-box">
            <div class="label">Current Streak</div>
            <div class="number" style="color:var(--accent)">${summary.streak} <span style="font-size:1rem;font-weight:normal">days</span></div>
          </div>
          <div class="stat-box">
            <div class="label">Focus Time Today</div>
            <div class="number">${summary.focusTodayMinutes} <span style="font-size:1rem;font-weight:normal">mins</span></div>
          </div>
          <div class="stat-box">
            <div class="label">Tasks Completed Today</div>
            <div class="number">${summary.completedToday}</div>
          </div>
          <div class="stat-box">
            <div class="label">Active Projects</div>
            <div class="number">${summary.totalProjects}</div>
          </div>
        </div>

        <!-- 7-Day Focus Trend Canvas Chart -->
        <div class="chart-card">
          <h3 style="font-size:1rem;font-weight:600;margin-bottom:1rem">Weekly Focus Time (Minutes / Day)</h3>
          <canvas id="weekly-focus-chart" width="800" height="240"></canvas>
        </div>

        <!-- Recent Focus Sessions -->
        <div style="background:var(--bg-surface);border:1px solid var(--border-light);border-radius:var(--radius-md);padding:1.5rem">
          <h3 style="font-size:1rem;font-weight:600;margin-bottom:1rem">Recent Focus Sessions</h3>
          ${sessions.length === 0 ? '<div style="color:var(--text-muted);font-size:0.88rem">No completed sessions logged yet.</div>' : `
            <table style="width:100%;border-collapse:collapse;font-size:0.88rem">
              <thead>
                <tr style="border-bottom:1px solid var(--border-light);text-align:left;color:var(--text-muted)">
                  <th style="padding:0.5rem 0">Time</th>
                  <th style="padding:0.5rem 0">Type</th>
                  <th style="padding:0.5rem 0">Duration</th>
                  <th style="padding:0.5rem 0">Task</th>
                </tr>
              </thead>
              <tbody>
                ${sessions.map(s => `
                  <tr style="border-bottom:1px solid var(--border-light)">
                    <td style="padding:0.6rem 0">${new Date(s.timestamp).toLocaleString()}</td>
                    <td style="padding:0.6rem 0"><span class="badge badge-medium">${s.type}</span></td>
                    <td style="padding:0.6rem 0">${s.durationMinutes} mins</td>
                    <td style="padding:0.6rem 0;color:var(--text-secondary)">${escapeHtml(s.taskTitle || 'Solo Focus')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `}
        </div>
      </div>
    `;

    // Render Canvas Chart
    const canvas = container.querySelector('#weekly-focus-chart');
    if (canvas) {
      const chartData = summary.last7Days.map(d => ({
        label: d.day,
        value: d.focusMinutes,
      }));
      CanvasCharts.drawBarChart(canvas, chartData);
    }
  }
};
