// ── HeyWork: Utility Functions ──
function $(selector) {
  return document.querySelector(selector);
}

function $$(selector) {
  return document.querySelectorAll(selector);
}

/** Today's date as YYYY-MM-DD in the browser's local time zone (not UTC). */
function localDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

/**
 * Application modal. `options`: { confirmLabel, cancelLabel, danger, onCancel }.
 * `onConfirm` may return false to keep the modal open (e.g. validation failed).
 */
function showModal(title, bodyHtml, onConfirm, options = {}) {
  const existing = document.querySelector('.modal-overlay');
  if (existing) existing.remove();

  const confirmLabel = options.confirmLabel || 'Confirm';
  const cancelLabel = options.cancelLabel || 'Cancel';
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('data-testid', 'modal');
  overlay.innerHTML = `
    <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem">
        <h3 id="modal-title" style="font-size:1.15rem;font-weight:700">${escapeHtml(title)}</h3>
        <button class="btn btn-secondary btn-sm close-modal-btn" style="border:none;font-size:1.1rem;padding:0.2rem 0.5rem" aria-label="Close">✕</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
      <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-top:1.5rem">
        <button class="btn btn-secondary cancel-modal-btn" data-testid="modal-cancel">${escapeHtml(cancelLabel)}</button>
        <button class="btn ${options.danger ? 'btn-danger' : 'btn-primary'} confirm-modal-btn" data-testid="modal-confirm">${escapeHtml(confirmLabel)}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  let settled = false;
  const close = (cancelled) => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (cancelled && !settled && options.onCancel) options.onCancel();
    settled = true;
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close(true);
  };
  document.addEventListener('keydown', onKey);

  overlay.querySelector('.close-modal-btn').addEventListener('click', () => close(true));
  overlay.querySelector('.cancel-modal-btn').addEventListener('click', () => close(true));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close(true);
  });

  overlay.querySelector('.confirm-modal-btn').addEventListener('click', async () => {
    if (onConfirm) {
      const shouldClose = await onConfirm();
      if (shouldClose !== false) close(false);
    } else {
      close(false);
    }
  });

  // Focus the first field, or the confirm button, so the keyboard works straight away
  const firstField = overlay.querySelector('input, textarea, select');
  (firstField || overlay.querySelector('.confirm-modal-btn')).focus();
  return overlay;
}

/**
 * In-app replacement for window.confirm(). Resolves true when confirmed.
 * `options`: { confirmLabel = 'Confirm', danger = false }.
 */
function showConfirm(title, message, options = {}) {
  return new Promise(resolve => {
    showModal(
      title,
      `<p style="font-size:0.92rem;color:var(--text-secondary);line-height:1.5" data-testid="confirm-message">${escapeHtml(message)}</p>`,
      () => {
        resolve(true);
        return true;
      },
      { confirmLabel: options.confirmLabel || 'Confirm', danger: Boolean(options.danger), onCancel: () => resolve(false) },
    );
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
