// ── HeyWork: Utility Functions ──
function $(selector) {
  return document.querySelector(selector);
}

function $$(selector) {
  return document.querySelectorAll(selector);
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  const icon = type === 'success' ? '✓' : type === 'error' ? '⚠' : 'ℹ';
  toast.innerHTML = `<span style="color:var(--accent);font-weight:bold">${icon}</span> <span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}

function showModal(title, bodyHtml, onConfirm) {
  const existing = document.querySelector('.modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem">
        <h3 style="font-size:1.15rem;font-weight:700">${escapeHtml(title)}</h3>
        <button class="btn btn-secondary btn-sm close-modal-btn" style="border:none;font-size:1.1rem;padding:0.2rem 0.5rem">✕</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
      <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-top:1.5rem">
        <button class="btn btn-secondary cancel-modal-btn">Cancel</button>
        <button class="btn btn-primary confirm-modal-btn">Confirm</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('.close-modal-btn').addEventListener('click', close);
  overlay.querySelector('.cancel-modal-btn').addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  overlay.querySelector('.confirm-modal-btn').addEventListener('click', async () => {
    if (onConfirm) {
      const shouldClose = await onConfirm();
      if (shouldClose !== false) close();
    } else {
      close();
    }
  });
}

// ── Lightweight Canvas Chart Renderer (Zero dependencies) ──
const CanvasCharts = {
  drawBarChart(canvas, data, options = {}) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const padding = 36;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;
    const maxVal = Math.max(...data.map(d => d.value), 10);

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#a3a39e' : '#5a5a54';
    const gridColor = isDark ? '#2c2e33' : '#e5e5e0';
    const barColor = options.barColor || (isDark ? '#4ade80' : '#2e7d32');

    // Draw horizontal grid lines
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding + (chartHeight / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();

      const labelVal = Math.round(maxVal - (maxVal / 4) * i);
      ctx.fillStyle = textColor;
      ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(labelVal + 'm', padding - 6, y + 3);
    }

    // Draw bars
    const barWidth = Math.min(36, (chartWidth / data.length) * 0.6);
    const step = chartWidth / data.length;

    data.forEach((item, index) => {
      const barHeight = (item.value / maxVal) * chartHeight;
      const x = padding + step * index + (step - barWidth) / 2;
      const y = padding + chartHeight - barHeight;

      // Bar with rounded top
      ctx.fillStyle = barColor;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, Math.max(barHeight, 2), [4, 4, 0, 0]);
      ctx.fill();

      // X-axis label
      ctx.fillStyle = textColor;
      ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(item.label, x + barWidth / 2, height - padding + 18);
    });
  }
};
