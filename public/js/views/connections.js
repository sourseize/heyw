// ── HeyWork: Connections view (local graph) ──
//
// One item in the middle, what it touches around it, and — only when active in
// the chosen month — what those touch in turn. The layout is deterministic
// geometry (rings), not physics: nothing moves unless you do, nothing runs in
// the background. The server builds the graph (src/db/graph.ts); this file only
// draws it as SVG so every node is a real, focusable element.
const ConnectionsView = {
  focus: null,
  /** True when the focus came from the hash or a click; a merely suggested focus is re-suggested per month. */
  focusPinned: false,
  month: null,     // YYYY-MM; null = current month
  /** Also draw direct neighbours that were quiet this month (greyed). Off: the month really filters. */
  includeQuiet: false,
  W: 900,
  H: 600,

  /**
   * Three ways in:
   *   - `#connections/<type>/<id>` (a chip, a card's ◎, a clicked node): that item is pinned;
   *   - bare `#connections` (sidebar, key 8): nothing is pinned — the server suggests the
   *     most connected item of the month, and keeps suggesting as the month changes;
   *   - internal re-renders (month stepper, quiet toggle, picker) pass `keep: true` and
   *     leave the pin state alone.
   */
  async render(container, params = {}) {
    const path = params.path || [];
    if (path.length >= 2 && ['note', 'task', 'thought'].includes(path[0])) {
      this.focus = { type: path[0], id: path[1] };
      this.focusPinned = true;
    } else if (!params.keep) {
      this.focus = null;
      this.focusPinned = false;
    } else if (!this.focusPinned) {
      this.focus = null; // suggested focus: re-suggest for the new month
    }

    // No focus chosen: the server lands on the most connected item active this month.
    let graph;
    try {
      graph = await API.getGraph(this.focus, this.month, { quiet: this.includeQuiet });
    } catch (err) {
      container.innerHTML = `<div class="empty-hint">Could not load the graph: ${escapeHtml(err.message || '')}</div>`;
      return;
    }
    if (!graph || !graph.nodes) {
      container.innerHTML = `
        <div style="max-width:720px;margin:0 auto">
          ${this.headerHtml(null)}
          <div class="empty-hint" data-testid="connections-empty">Nothing to connect yet. Write a note and mention a task with <code>[[</code>, or open any note, task or thought and use “Link to…”.</div>
        </div>`;
      this.bindHeader(container);
      return;
    }
    this.focus = graph.focus;
    if (graph.suggested) this.focusPinned = false;
    const layout = this.layout(graph);

    container.innerHTML = `
      <div class="connections-view">
        ${this.headerHtml(graph)}
        <div class="connections-body">
          <div class="graph-card">
            ${this.svg(graph, layout)}
            ${graph.nodes.length === 1 ? `<div class="graph-empty" data-testid="graph-empty">${this.emptyText(graph)}</div>` : ''}
            ${graph.truncated ? `<div class="graph-note" data-testid="graph-truncated">Showing the first ${graph.nodes.length} items — focus a neighbour to see further.</div>` : ''}
            <div class="graph-legend">
              <span><i class="legend-dot legend-note"></i> note</span>
              <span><i class="legend-dot legend-task"></i> task</span>
              <span><i class="legend-dot legend-thought"></i> thought</span>
              <span><i class="legend-line legend-mention"></i> mentions</span>
              <span><i class="legend-line legend-link"></i> linked</span>
              <span><i class="legend-line legend-became"></i> became / captured during</span>
              ${graph.includeQuiet ? `<span><i class="legend-dot legend-stale"></i> quiet this month</span>` : ''}
            </div>
          </div>
          <aside class="graph-side">
            ${this.sideHtml(graph)}
          </aside>
        </div>
      </div>
    `;
    this.bindHeader(container);
    this.bindGraph(container, graph);
  },

  destroy() {
    // Nothing is animated or subscribed: the drawing is static by design.
  },

  subtitle(graph) {
    const tail = 'What this touches, and what those touch — one month at a time to keep it light.';
    if (!graph) return tail;
    if (graph.suggested === 'active') return `The most connected item this month. ${tail}`;
    if (graph.suggested === 'fallback') return `Nothing was active in ${this.monthLabel(graph.month)}; showing your latest note. ${tail}`;
    if (this.focusPinned) return `Pinned: stays in the centre as you change month. ${tail}`;
    return tail;
  },

  emptyText(graph) {
    const month = this.monthLabel(graph.month);
    const release = this.focusPinned ? ' Or release the pin to see the most connected item of the month.' : '';
    if (graph.hiddenQuiet) {
      return `Nothing connected to this was active in ${month}. ${graph.hiddenQuiet} quiet connection${graph.hiddenQuiet === 1 ? '' : 's'} hidden — show them, or step to another month.${release}`;
    }
    return `Nothing connected to this yet. Open it and type <code>[[</code>, or use “Link to…”.${release}`;
  },

  // ── Header: focus search + month stepper ──

  headerHtml(graph) {
    const focusNode = graph ? graph.nodes[0] : null;
    const month = graph ? graph.month : this.currentMonth();
    return `
      <div class="connections-header">
        <div>
          <h2 style="font-size:1.25rem;font-weight:700;display:flex;align-items:center;gap:0.5rem">
            ${focusNode ? `<span>${Links.ICON[focusNode.type]}</span><span data-testid="graph-focus-label">${escapeHtml(Links.truncate(focusNode.label, 60))}</span>` : 'Connections'}
            ${focusNode && !focusNode.deleted ? `<a class="btn btn-secondary btn-sm" href="${Links.hrefFor(focusNode)}" data-testid="graph-open-focus" title="Open">↗ Open</a>` : ''}
            ${graph && this.focusPinned ? `<button class="btn btn-secondary btn-sm" data-unpin data-testid="graph-unpin" title="Stop following this item; show the most connected item of the month instead">📌 pinned · release</button>` : ''}
          </h2>
          <p style="font-size:0.85rem;color:var(--text-muted)" data-testid="graph-subtitle">${this.subtitle(graph)}</p>
        </div>
        <div class="connections-controls">
          <div class="graph-search">
            <input type="text" id="graph-search" data-testid="graph-search" placeholder="Look at… (note, task or thought)" autocomplete="off">
            <div id="graph-search-results" class="graph-search-results" hidden></div>
          </div>
          <div class="month-stepper" data-testid="month-stepper">
            <button class="btn btn-secondary btn-sm" data-month-step="-1" title="Previous month">‹</button>
            <span class="month-label" data-testid="month-label">${escapeHtml(this.monthLabel(month))}</span>
            <button class="btn btn-secondary btn-sm" data-month-step="1" title="Next month">›</button>
            ${this.month ? `<button class="btn btn-secondary btn-sm" data-month-reset title="Back to this month">today</button>` : ''}
          </div>
          ${graph && (graph.hiddenQuiet || graph.includeQuiet) ? `
            <button class="btn btn-secondary btn-sm ${graph.includeQuiet ? 'active' : ''}" data-quiet-toggle data-testid="graph-quiet-toggle" title="Direct connections with no activity in this month">
              ${graph.includeQuiet ? 'Hide quiet' : `Show ${graph.hiddenQuiet} quiet`}
            </button>` : ''}
        </div>
      </div>`;
  },

  bindHeader(container) {
    container.querySelectorAll('[data-month-step]').forEach(btn => {
      btn.addEventListener('click', () => {
        const base = this.month || this.currentMonth();
        const [y, m] = base.split('-').map(Number);
        const d = new Date(Date.UTC(y, m - 1 + Number(btn.dataset.monthStep), 1));
        const next = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        this.month = next === this.currentMonth() ? null : next;
        this.render(container, { keep: true });
      });
    });
    container.querySelector('[data-month-reset]')?.addEventListener('click', () => {
      this.month = null;
      this.render(container, { keep: true });
    });
    container.querySelector('[data-quiet-toggle]')?.addEventListener('click', () => {
      this.includeQuiet = !this.includeQuiet;
      this.render(container, { keep: true });
    });
    container.querySelector('[data-unpin]')?.addEventListener('click', () => {
      // Release the pinned item: back to "most connected this month", and a clean hash.
      this.focus = null;
      this.focusPinned = false;
      if (window.location.hash.slice(1) !== 'connections') window.location.hash = 'connections';
      else this.render(container);
    });

    const input = container.querySelector('#graph-search');
    const results = container.querySelector('#graph-search-results');
    if (!input || !results) return;
    let timer = null;
    const search = async () => {
      const q = input.value.trim();
      if (!q) {
        results.hidden = true;
        return;
      }
      let hits = [];
      try { hits = await API.searchLinkables(q, null, 8); } catch { hits = []; }
      results.innerHTML = hits.length ? hits.map(h => `
        <div class="wiki-option" data-type="${h.ref.type}" data-id="${escapeHtml(h.ref.id)}" data-testid="graph-search-option">
          <span class="wiki-option-icon">${Links.ICON[h.ref.type]}</span>
          <span class="wiki-option-label">${escapeHtml(Links.truncate(h.label, 60))}</span>
        </div>`).join('') : `<div class="wiki-empty">Nothing matches</div>`;
      results.hidden = false;
      results.querySelectorAll('.wiki-option').forEach(el => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          window.location.hash = Links.graphHrefFor({ type: el.dataset.type, id: el.dataset.id }).slice(1);
        });
      });
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 150); });
    input.addEventListener('blur', () => setTimeout(() => { results.hidden = true; }, 150));
    input.addEventListener('focus', () => { if (input.value.trim()) search(); });
  },

  currentMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  },

  monthLabel(month) {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
  },

  // ── Layout: focus in the centre, ring of direct neighbours, outer ring of their neighbours ──

  layout(graph) {
    const key = n => `${n.type}:${n.id}`;
    const cx = this.W / 2;
    const cy = this.H / 2;
    const pos = new Map();
    const ring1 = graph.nodes.filter(n => n.depth === 1);
    const ring2 = graph.nodes.filter(n => n.depth === 2);
    const r1 = ring1.length > 12 ? 200 : 165;
    const r2 = 282;

    pos.set(key(graph.nodes[0]), { x: cx, y: cy, angle: 0 });

    // Ring 1: evenly spaced, starting at the top, in the server's order (active first).
    ring1.forEach((n, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / ring1.length;
      pos.set(key(n), { x: cx + r1 * Math.cos(angle), y: cy + r1 * Math.sin(angle), angle });
    });

    // Ring 2: near the mean angle of the ring-1 nodes they touch, pushed apart when crowded.
    const adjacency = new Map();
    for (const e of graph.edges) {
      const a = `${e.from.type}:${e.from.id}`;
      const b = `${e.to.type}:${e.to.id}`;
      if (!adjacency.has(a)) adjacency.set(a, []);
      if (!adjacency.has(b)) adjacency.set(b, []);
      adjacency.get(a).push(b);
      adjacency.get(b).push(a);
    }
    const ring1Keys = new Set(ring1.map(key));
    const placed = ring2.map(n => {
      const parents = (adjacency.get(key(n)) || []).filter(k => ring1Keys.has(k));
      let sx = 0;
      let sy = 0;
      for (const p of parents) {
        sx += Math.cos(pos.get(p).angle);
        sy += Math.sin(pos.get(p).angle);
      }
      const angle = parents.length ? Math.atan2(sy, sx) : -Math.PI / 2;
      return { n, angle };
    }).sort((a, b) => a.angle - b.angle);
    if (placed.length) {
      const minGap = Math.min(0.34, (2 * Math.PI) / placed.length);
      for (let i = 1; i < placed.length; i++) {
        if (placed[i].angle - placed[i - 1].angle < minGap) placed[i].angle = placed[i - 1].angle + minGap;
      }
      // Wrap-around: the last may now crowd the first.
      const overflow = placed[placed.length - 1].angle - (placed[0].angle + 2 * Math.PI);
      if (placed.length > 1 && overflow > -minGap) {
        const shift = (overflow + minGap) / placed.length;
        placed.forEach((p, i) => { p.angle -= shift * (placed.length - i); });
      }
      for (const p of placed) {
        pos.set(key(p.n), { x: cx + r2 * Math.cos(p.angle), y: cy + r2 * Math.sin(p.angle), angle: p.angle });
      }
    }
    return pos;
  },

  // ── Drawing ──

  svg(graph, pos) {
    const key = n => `${n.type}:${n.id}`;
    const radius = n => (n.depth === 0 ? 15 : n.depth === 1 ? 9 : 6);
    const focusKey = key(graph.nodes[0]);
    const depthOf = new Map(graph.nodes.map(n => [key(n), n.depth]));
    const cx = this.W / 2;
    const cy = this.H / 2;
    const edges = graph.edges.map(e => {
      const fromKey = `${e.from.type}:${e.from.id}`;
      const toKey = `${e.to.type}:${e.to.id}`;
      const a = pos.get(fromKey);
      const b = pos.get(toKey);
      if (!a || !b) return '';
      const width = e.kind === 'mention' ? 1 + Math.min(e.count || 1, 3) * 0.4 : e.kind === 'link' ? 1.8 : 1.2;
      const attrs = `class="gedge gedge-${e.kind}" data-from="${escapeHtml(fromKey)}" data-to="${escapeHtml(toKey)}" stroke-width="${width}" fill="none"`;
      const title = `<title>${escapeHtml(Links.KIND_LABEL[e.kind] || e.kind)}</title>`;
      if (fromKey === focusKey || toKey === focusKey) {
        return `<line ${attrs} x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}">${title}</line>`;
      }
      // Edges between neighbours bow away from the centre so they never hide behind the spokes.
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      let dx = mx - cx;
      let dy = my - cy;
      let dist = Math.hypot(dx, dy);
      if (dist < 1) {
        // Opposite neighbours: the chord passes through the centre, so bow perpendicular to it.
        dx = -(b.y - a.y);
        dy = b.x - a.x;
        dist = Math.hypot(dx, dy) || 1;
      }
      // Ring-1 ↔ ring-1 chords can cross the centre: bow them well clear. Ring-1 → ring-2 only needs a hint of a curve.
      const sameRing = depthOf.get(fromKey) === depthOf.get(toKey);
      const bow = Math.hypot(a.x - b.x, a.y - b.y) * (sameRing ? 0.35 : 0.12);
      const qx = mx + (dx / dist) * bow;
      const qy = my + (dy / dist) * bow;
      return `<path ${attrs} d="M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${qx.toFixed(1)},${qy.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}">${title}</path>`;
    }).join('');

    const nodes = graph.nodes.map(n => {
      const p = pos.get(key(n));
      const r = radius(n);
      const outward = Math.cos(p.angle) >= 0;
      const labelMax = n.depth === 0 ? 30 : n.depth === 1 ? 24 : 18;
      const anchor = n.depth === 0 ? 'middle' : outward ? 'start' : 'end';
      const lx = n.depth === 0 ? 0 : (outward ? r + 6 : -(r + 6));
      const ly = n.depth === 0 ? r + 16 : 4;
      const classes = ['gnode', `gnode-${n.type}`, `gnode-depth-${n.depth}`, n.stale ? 'gnode-stale' : '', n.deleted ? 'gnode-deleted' : ''].filter(Boolean).join(' ');
      const title = `${Links.LABEL[n.type]}: ${n.label}${n.deleted ? ' (deleted)' : n.stale ? ' · quiet this month' : ''}`;
      return `
        <g class="${classes}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})" data-key="${key(n)}" data-type="${n.type}" data-id="${escapeHtml(n.id)}" data-depth="${n.depth}" data-testid="graph-node" tabindex="0" role="button" aria-label="${escapeHtml(title)}">
          <title>${escapeHtml(title)}</title>
          <circle r="${r}"></circle>
          <text x="${lx}" y="${ly}" text-anchor="${anchor}" class="gnode-label gnode-label-${n.depth}">${escapeHtml(Links.truncate(n.label, labelMax))}</text>
        </g>`;
    }).join('');

    return `
      <svg class="graph-svg" viewBox="0 0 ${this.W} ${this.H}" preserveAspectRatio="xMidYMid meet" data-testid="graph-svg" role="img" aria-label="Connections graph">
        <g class="gedges">${edges}</g>
        <g class="gnodes">${nodes}</g>
      </svg>`;
  },

  sideHtml(graph) {
    const focus = graph.nodes[0];
    const focusKey = `${focus.type}:${focus.id}`;
    const kindsTo = new Map();
    for (const e of graph.edges) {
      const a = `${e.from.type}:${e.from.id}`;
      const b = `${e.to.type}:${e.to.id}`;
      if (a === focusKey) kindsTo.set(b, [...(kindsTo.get(b) || []), e.kind]);
      else if (b === focusKey) kindsTo.set(a, [...(kindsTo.get(a) || []), e.kind]);
    }
    const ring1 = graph.nodes.filter(n => n.depth === 1);
    const ring2 = graph.nodes.filter(n => n.depth === 2);
    const row = n => {
      const k = `${n.type}:${n.id}`;
      const kinds = [...new Set(kindsTo.get(k) || [])].map(x => Links.KIND_LABEL[x] || x).join(', ');
      return `
        <li class="graph-side-row ${n.stale ? 'stale' : ''} ${n.deleted ? 'deleted' : ''}" data-key="${k}" data-testid="graph-side-row">
          <button type="button" class="graph-side-focus" data-type="${n.type}" data-id="${escapeHtml(n.id)}" ${n.deleted ? 'disabled' : ''} title="Look at this one">${Links.ICON[n.type]} ${escapeHtml(Links.truncate(n.label, 44))}</button>
          <span class="graph-side-meta">${escapeHtml(kinds)}${n.stale ? ' · quiet' : ''}${n.deleted ? ' · deleted' : ''}</span>
          ${n.deleted ? '' : `<a class="graph-side-open" href="${Links.hrefFor(n)}" title="Open">↗</a>`}
        </li>`;
    };
    return `
      <h3 class="graph-side-title">Directly connected <span class="connections-count">${ring1.length}</span></h3>
      ${ring1.length ? `<ul class="graph-side-list">${ring1.map(row).join('')}</ul>` : `<div class="link-strip-hint">${graph.hiddenQuiet ? `${graph.hiddenQuiet} quiet connection${graph.hiddenQuiet === 1 ? '' : 's'} hidden this month.` : 'Nothing connected. Open the item and type <code>[[</code> or use “Link to…”.'}</div>`}
      ${ring2.length ? `<h3 class="graph-side-title">One step further <span class="connections-count">${ring2.length}</span></h3><ul class="graph-side-list">${ring2.map(row).join('')}</ul>` : ''}
      ${!focus.deleted ? `<div style="margin-top:1rem"><button class="btn btn-secondary btn-sm" id="graph-link-btn" data-testid="graph-link-btn">+ Link to…</button></div>` : ''}`;
  },

  bindGraph(container, graph) {
    const svg = container.querySelector('.graph-svg');
    const look = (type, id) => { window.location.hash = Links.graphHrefFor({ type, id }).slice(1); };
    const open = (type, id) => { window.location.hash = App.hashFor({ type, id }); };

    const clearHighlight = () => {
      svg.classList.remove('dimmed');
      svg.querySelectorAll('.hl').forEach(el => el.classList.remove('hl'));
      container.querySelectorAll('.graph-side-row.hl').forEach(el => el.classList.remove('hl'));
    };
    const highlight = (key) => {
      clearHighlight();
      svg.classList.add('dimmed');
      const touched = new Set([key]);
      svg.querySelectorAll('.gedge').forEach(line => {
        if (line.dataset.from === key || line.dataset.to === key) {
          line.classList.add('hl');
          touched.add(line.dataset.from);
          touched.add(line.dataset.to);
        }
      });
      svg.querySelectorAll('.gnode').forEach(g => { if (touched.has(g.dataset.key)) g.classList.add('hl'); });
      container.querySelectorAll('.graph-side-row').forEach(r => { if (touched.has(r.dataset.key)) r.classList.add('hl'); });
    };

    svg.querySelectorAll('.gnode').forEach(g => {
      const deleted = g.classList.contains('gnode-deleted');
      g.addEventListener('mouseenter', () => highlight(g.dataset.key));
      g.addEventListener('mouseleave', clearHighlight);
      g.addEventListener('focus', () => highlight(g.dataset.key));
      g.addEventListener('blur', clearHighlight);
      if (deleted) return;
      g.addEventListener('click', () => {
        if (g.dataset.depth === '0') open(g.dataset.type, g.dataset.id);
        else look(g.dataset.type, g.dataset.id);
      });
      g.addEventListener('dblclick', () => open(g.dataset.type, g.dataset.id));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); look(g.dataset.type, g.dataset.id); }
        if (e.key === 'o' || e.key === 'O') { e.preventDefault(); open(g.dataset.type, g.dataset.id); }
      });
    });

    container.querySelectorAll('.graph-side-row').forEach(row => {
      row.addEventListener('mouseenter', () => highlight(row.dataset.key));
      row.addEventListener('mouseleave', clearHighlight);
    });
    container.querySelectorAll('.graph-side-focus').forEach(btn => {
      btn.addEventListener('click', () => look(btn.dataset.type, btn.dataset.id));
    });
    container.querySelector('#graph-link-btn')?.addEventListener('click', () => {
      LinkPicker.open({ from: this.focus, onLinked: () => this.render(container, { keep: true }) });
    });
  },
};
