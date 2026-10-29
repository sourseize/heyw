// ── HeyWork: Connected thinking (shared client pieces) ──
//
// Notes, tasks and thoughts point at each other with `[[wiki]]` mentions typed
// into text, or with explicit "Link to…" links. This file holds what every view
// shares:
//   - Links:            labels, icons, chips, inline rendering of mentions
//   - WikiAutocomplete: a `[[` popover on any textarea/input
//   - LinkStrip:        the live "Links in this text" row under an editor
//   - LinkPicker:       the "Link to…" modal
//   - ConnectionsPanel: everything touching one item, with unlink / graph buttons

const Links = {
  ICON: { note: '📝', task: '📋', thought: '🧠' },
  LABEL: { note: 'Note', task: 'Task', thought: 'Thought' },
  KIND_LABEL: {
    mention: 'mentions',
    link: 'linked',
    became: 'became',
    captured_during: 'captured while working on',
  },

  hrefFor(ref) {
    return `#${App.hashFor(ref)}`;
  },

  graphHrefFor(ref) {
    return `#connections/${encodeURIComponent(ref.type)}/${encodeURIComponent(ref.id)}`;
  },

  truncate(text, max = 48) {
    const t = (text || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  },

  /** A small inline chip that opens the item. `opts`: { deleted, max, testid }. */
  chip(ref, label, opts = {}) {
    const text = escapeHtml(this.truncate(label, opts.max || 48));
    const icon = this.ICON[ref.type] || '•';
    const title = escapeHtml(`${this.LABEL[ref.type] || ref.type}: ${label}`);
    const testid = opts.testid ? ` data-testid="${opts.testid}"` : '';
    if (opts.deleted) {
      return `<span class="link-chip link-chip-deleted" title="${title} (deleted)"${testid}>${icon} ${text}</span>`;
    }
    return `<a class="link-chip link-chip-${ref.type}" href="${this.hrefFor(ref)}" title="${title}" data-ref-type="${ref.type}" data-ref-id="${escapeHtml(ref.id)}"${testid}>${icon} ${text}</a>`;
  },

  /**
   * Escapes `text` and swaps each mention (from /api/links/preview, with offsets)
   * for a chip. Unresolved mentions are shown as they were typed, softly marked.
   */
  renderInline(text, mentions) {
    if (!mentions || !mentions.length) return escapeHtml(text);
    let html = '';
    let cursor = 0;
    for (const m of mentions) {
      html += escapeHtml(text.slice(cursor, m.offset));
      if (m.resolved) {
        html += this.chip(m.resolved, m.label, { max: 40 });
      } else {
        html += `<span class="link-chip link-chip-unresolved" title="No ${m.type || 'note, task or thought'} called “${escapeHtml(m.target)}” yet">${escapeHtml(m.label)}</span>`;
      }
      cursor = m.offset + m.raw.length;
    }
    return html + escapeHtml(text.slice(cursor));
  },

  /** Fetches previews for several texts at once; returns a Map keyed by id. Texts without `[[` are skipped. */
  async previewMany(items) {
    const out = new Map();
    await Promise.all(items.filter(i => (i.text || '').includes('[[')).map(async i => {
      try {
        const res = await API.previewLinks(i.text);
        out.set(i.id, res.mentions);
      } catch { /* leave as plain text */ }
    }));
    return out;
  },
};

// ── `[[` autocomplete ──
//
// Watches a textarea (or input). When the caret is inside an unfinished `[[…`,
// a small popover lists matching notes, tasks and thoughts; picking one inserts
// the canonical `[[type:Title]]`. A typed prefix (`[[task:fo`) narrows the types.
const WikiAutocomplete = {
  DEBOUNCE_MS: 120,
  MAX_QUERY: 80,

  attach(field, options = {}) {
    const state = { field, options, open: false, items: [], index: 0, trigger: null, seq: 0, timer: null, popover: null };

    const onInput = () => this.update(state);
    const onKeydown = (e) => this.keydown(state, e);
    const onBlur = () => setTimeout(() => this.close(state), 150);
    const onClickAway = (e) => { if (state.popover && !state.popover.contains(e.target) && e.target !== field) this.close(state); };

    field.addEventListener('input', onInput);
    field.addEventListener('keydown', onKeydown);
    field.addEventListener('blur', onBlur);
    document.addEventListener('mousedown', onClickAway);

    return {
      detach: () => {
        this.close(state);
        field.removeEventListener('input', onInput);
        field.removeEventListener('keydown', onKeydown);
        field.removeEventListener('blur', onBlur);
        document.removeEventListener('mousedown', onClickAway);
      },
      isOpen: () => state.open,
    };
  },

  /** The unfinished mention the caret is in, or null. */
  findTrigger(field) {
    const caret = field.selectionStart;
    if (caret === null || caret === undefined) return null;
    const before = field.value.slice(0, caret);
    const open = before.lastIndexOf('[[');
    if (open === -1) return null;
    if (open > 0 && before[open - 1] === '\\') return null; // escaped
    const q = before.slice(open + 2);
    if (q.includes(']]') || q.includes('\n') || q.length > this.MAX_QUERY) return null;
    const typed = /^(note|task|thought):\s*/i.exec(q);
    return {
      start: open,
      end: caret,
      query: typed ? q.slice(typed[0].length) : q,
      types: typed ? [typed[1].toLowerCase()] : null,
    };
  },

  update(state) {
    const trigger = this.findTrigger(state.field);
    if (!trigger) {
      this.close(state);
      return;
    }
    state.trigger = trigger;
    clearTimeout(state.timer);
    state.timer = setTimeout(async () => {
      const seq = ++state.seq;
      let items = [];
      try {
        items = await API.searchLinkables(trigger.query, trigger.types, 8);
      } catch {
        items = [];
      }
      if (seq !== state.seq) return; // a newer keystroke superseded this lookup
      if (!this.findTrigger(state.field)) return; // caret moved on
      state.items = items;
      state.index = 0;
      this.render(state);
    }, this.DEBOUNCE_MS);
  },

  render(state) {
    if (!state.popover) {
      state.popover = document.createElement('div');
      state.popover.className = 'wiki-popover';
      state.popover.setAttribute('data-testid', 'wiki-popover');
      state.popover.setAttribute('role', 'listbox');
      document.body.appendChild(state.popover);
    }
    const pop = state.popover;
    const items = state.items;
    pop.innerHTML = `
      ${items.length ? items.map((it, i) => `
        <div class="wiki-option ${i === state.index ? 'active' : ''}" role="option" data-index="${i}" data-testid="wiki-option" aria-selected="${i === state.index}">
          <span class="wiki-option-icon">${Links.ICON[it.ref.type]}</span>
          <span class="wiki-option-label">${escapeHtml(Links.truncate(it.label, 64))}</span>
          <span class="wiki-option-meta">${escapeHtml(this.meta(it))}</span>
        </div>`).join('')
      : `<div class="wiki-empty">No match — keep typing to leave a plain [[mention]]</div>`}
      <div class="wiki-hint">↑↓ choose · Enter insert · Esc close · prefix with note: task: thought:</div>
    `;
    pop.querySelectorAll('.wiki-option').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault(); // keep the field focused
        this.insert(state, Number(el.dataset.index));
      });
      el.addEventListener('mousemove', () => {
        state.index = Number(el.dataset.index);
        this.highlight(state);
      });
    });
    this.position(state);
    state.open = true;
  },

  meta(item) {
    const m = item.meta || {};
    if (item.ref.type === 'task') return `${Links.LABEL.task} · ${String(m.status || '').replace('_', ' ')}`;
    if (item.ref.type === 'thought') return `${Links.LABEL.thought} · ${m.status || ''}`;
    return m.pinned ? 'Note · pinned' : 'Note';
  },

  highlight(state) {
    state.popover?.querySelectorAll('.wiki-option').forEach((el, i) => {
      el.classList.toggle('active', i === state.index);
      el.setAttribute('aria-selected', String(i === state.index));
    });
  },

  /** Places the popover just under the caret (mirror-div measurement), clamped to the viewport. */
  position(state) {
    const field = state.field;
    const pop = state.popover;
    const rect = field.getBoundingClientRect();
    const caret = this.caretCoordinates(field, state.trigger ? state.trigger.start : field.selectionStart);
    let top = rect.top + caret.top - field.scrollTop + caret.height + 4;
    let left = rect.left + caret.left - field.scrollLeft;
    pop.style.visibility = 'hidden';
    pop.style.display = 'block';
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    if (left + pw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pw - 8);
    if (top + ph > window.innerHeight - 8) top = Math.max(8, rect.top + caret.top - field.scrollTop - ph - 4);
    pop.style.top = `${Math.round(top)}px`;
    pop.style.left = `${Math.round(left)}px`;
    pop.style.visibility = '';
  },

  caretCoordinates(field, position) {
    const isInput = field.tagName === 'INPUT';
    const div = document.createElement('div');
    const style = window.getComputedStyle(field);
    const props = ['boxSizing', 'width', 'height', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'fontFamily', 'fontSize',
      'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'textIndent', 'tabSize'];
    for (const p of props) div.style[p] = style[p];
    div.style.position = 'absolute';
    div.style.visibility = 'hidden';
    div.style.top = '0';
    div.style.left = '-9999px';
    div.style.whiteSpace = isInput ? 'pre' : 'pre-wrap';
    div.style.wordWrap = isInput ? 'normal' : 'break-word';
    div.style.overflow = 'hidden';
    div.textContent = field.value.slice(0, position);
    const marker = document.createElement('span');
    marker.textContent = field.value.slice(position, position + 1) || '.';
    div.appendChild(marker);
    document.body.appendChild(div);
    const out = { top: marker.offsetTop, left: marker.offsetLeft, height: marker.offsetHeight || parseInt(style.lineHeight, 10) || 18 };
    div.remove();
    return out;
  },

  keydown(state, e) {
    if (!state.open) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const n = state.items.length;
      if (!n) return;
      state.index = (state.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      this.highlight(state);
    } else if ((e.key === 'Enter' || e.key === 'Tab') && state.items.length) {
      e.preventDefault();
      e.stopPropagation();
      this.insert(state, state.index);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // the modal's own Escape handler must not fire
      this.close(state);
    }
  },

  insert(state, index) {
    const item = state.items[index];
    const trigger = this.findTrigger(state.field) || state.trigger;
    if (!item || !trigger) return;
    const field = state.field;
    const value = field.value;
    let after = value.slice(trigger.end);
    if (after.startsWith(']]')) after = after.slice(2); // the user had already closed the brackets
    const before = value.slice(0, trigger.start);
    field.value = `${before}${item.insert}${after}`;
    const caret = before.length + item.insert.length;
    field.setSelectionRange(caret, caret);
    this.close(state);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    if (state.options.onInserted) state.options.onInserted(item);
    field.focus();
  },

  close(state) {
    clearTimeout(state.timer);
    state.seq++;
    state.open = false;
    if (state.popover) {
      state.popover.remove();
      state.popover = null;
    }
  },
};

// ── Live "links in this text" strip ──
const LinkStrip = {
  DEBOUNCE_MS: 250,

  /** Keeps `mount` in sync with the mentions in `field`. Returns { refresh, detach }. */
  attach(field, mount, options = {}) {
    let timer = null;
    let seq = 0;
    const refresh = async () => {
      const text = field.value;
      if (!text.includes('[[')) {
        this.render(mount, [], options);
        return;
      }
      const mine = ++seq;
      try {
        const res = await API.previewLinks(text);
        if (mine === seq) this.render(mount, res.mentions, options);
      } catch { /* keep the previous strip */ }
    };
    const onInput = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, this.DEBOUNCE_MS);
    };
    field.addEventListener('input', onInput);
    refresh();
    return {
      refresh,
      detach: () => {
        clearTimeout(timer);
        field.removeEventListener('input', onInput);
      },
    };
  },

  render(mount, mentions, options = {}) {
    if (!mount) return;
    if (!mentions.length) {
      mount.innerHTML = `<span class="link-strip-hint">Type <code>[[</code> to link a note, task or thought.</span>`;
      return;
    }
    const seen = new Set();
    const chips = [];
    for (const m of mentions) {
      const key = m.resolved ? `${m.resolved.type}:${m.resolved.id}` : `?${m.type || ''}:${m.target.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (m.resolved) {
        const amb = m.ambiguous ? `<span class="link-chip-flag" title="Several items share this title; the most recently edited one was chosen">?</span>` : '';
        chips.push(`<span class="link-strip-item" data-testid="link-strip-item">${Links.chip(m.resolved, m.resolvedLabel || m.label)}${amb}</span>`);
      } else {
        const canCreate = !m.type || m.type === 'note';
        chips.push(`
          <span class="link-strip-item link-strip-unresolved" data-testid="link-strip-unresolved" title="Nothing called “${escapeHtml(m.target)}” yet">
            <span class="link-chip link-chip-unresolved">${escapeHtml(Links.truncate(m.target, 40))}</span>
            ${canCreate ? `<button type="button" class="link-strip-create" data-title="${escapeHtml(m.target)}" data-testid="link-strip-create">create note</button>` : ''}
          </span>`);
      }
    }
    mount.innerHTML = `<span class="link-strip-label">Links</span>${chips.join('')}`;
    mount.querySelectorAll('.link-strip-create').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          const note = await API.createNote({ title: btn.dataset.title, content: '', tags: [] });
          showToast(`Note “${note.title}” created`, 'success');
          if (options.onCreated) options.onCreated(note);
          else window.location.hash = App.hashFor({ type: 'note', id: note.id });
        } catch (err) {
          showToast(err.message || 'Could not create the note', 'error');
        }
      });
    });
  },
};

// ── "Link to…" picker ──
const LinkPicker = {
  open({ from, onLinked }) {
    let selected = null;
    const overlay = showModal('Link to…', `
      <div style="display:flex;flex-direction:column;gap:0.75rem">
        <div style="display:flex;gap:0.5rem">
          <input type="text" id="link-picker-q" data-testid="link-picker-query" placeholder="Search notes, tasks and thoughts…" autocomplete="off" style="flex:1;padding:0.55rem 0.7rem;border:1px solid var(--border-light);border-radius:var(--radius-sm);background:var(--bg-surface);color:var(--text-primary)">
          <select id="link-picker-type" style="padding:0.5rem;border:1px solid var(--border-light);border-radius:var(--radius-sm);background:var(--bg-surface);color:var(--text-primary)">
            <option value="">All</option>
            <option value="note">Notes</option>
            <option value="task">Tasks</option>
            <option value="thought">Thoughts</option>
          </select>
        </div>
        <div id="link-picker-results" class="link-picker-results" data-testid="link-picker-results"></div>
      </div>
    `, async () => {
      if (!selected) {
        showToast('Pick something to link to', 'error');
        return false;
      }
      try {
        const link = await API.createLink(from, selected);
        showToast('Linked', 'success');
        if (onLinked) onLinked(link);
        return true;
      } catch (err) {
        showToast(err.message || 'Could not link', 'error');
        return false;
      }
    }, { confirmLabel: 'Link' });

    const q = overlay.querySelector('#link-picker-q');
    const typeSel = overlay.querySelector('#link-picker-type');
    const results = overlay.querySelector('#link-picker-results');
    let timer = null;
    const search = async () => {
      const types = typeSel.value ? [typeSel.value] : null;
      let hits = [];
      try { hits = await API.searchLinkables(q.value.trim(), types, 12); } catch { hits = []; }
      hits = hits.filter(h => !(h.ref.type === from.type && h.ref.id === from.id));
      results.innerHTML = hits.length ? hits.map(h => `
        <label class="link-picker-row ${selected && selected.id === h.ref.id && selected.type === h.ref.type ? 'active' : ''}" data-testid="link-picker-row">
          <input type="radio" name="link-picker-choice" value="${h.ref.type}:${escapeHtml(h.ref.id)}" ${selected && selected.id === h.ref.id ? 'checked' : ''}>
          <span>${Links.ICON[h.ref.type]}</span>
          <span class="link-picker-label">${escapeHtml(Links.truncate(h.label, 70))}</span>
          <span class="link-picker-meta">${escapeHtml(WikiAutocomplete.meta(h))}</span>
        </label>`).join('') : `<div class="wiki-empty">Nothing matches</div>`;
      results.querySelectorAll('input[type=radio]').forEach(r => {
        r.addEventListener('change', () => {
          const [type, ...rest] = r.value.split(':');
          selected = { type, id: rest.join(':') };
          results.querySelectorAll('.link-picker-row').forEach(row => row.classList.toggle('active', row.contains(r)));
        });
      });
    };
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 150); });
    typeSel.addEventListener('change', search);
    search();
  },
};

// ── Connections panel (backlinks) ──
const ConnectionsPanel = {
  /** Renders everything touching `ref` into `mount`. `options`: { onChange, compact }. */
  async render(mount, ref, options = {}) {
    if (!mount) return;
    mount.classList.add('connections-panel');
    mount.setAttribute('data-testid', 'connections-panel');
    let data;
    try {
      data = await API.getConnections(ref);
    } catch (err) {
      mount.innerHTML = `<div class="link-strip-hint">Could not load connections: ${escapeHtml(err.message || '')}</div>`;
      return;
    }
    const rows = data.connections.map(c => this.row(c));
    const count = data.connections.length;
    if (options.onCount) options.onCount(count);

    mount.innerHTML = `
      <div class="connections-head">
        <span class="connections-title">Connections <span class="connections-count" data-testid="connections-count">${count}</span></span>
        <span class="connections-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-act="link" data-testid="connections-link-btn">+ Link to…</button>
          <a class="btn btn-secondary btn-sm" href="${Links.graphHrefFor(ref)}" data-testid="connections-graph-btn" title="See this item's connections as a graph">◎ Graph</a>
        </span>
      </div>
      ${count ? `<ul class="connections-list">${rows.join('')}</ul>` : `<div class="link-strip-hint">Nothing connected yet. Type <code>[[</code> in the text, or use “Link to…”.</div>`}
      ${data.unresolved.length ? `
        <div class="connections-unresolved" data-testid="connections-unresolved">
          Not found: ${data.unresolved.map(u => `<span class="link-chip link-chip-unresolved" title="${escapeHtml(u.raw)}">${escapeHtml(Links.truncate(u.target, 32))}</span>`).join(' ')}
        </div>` : ''}
    `;

    mount.querySelector('[data-act="link"]')?.addEventListener('click', () => {
      LinkPicker.open({
        from: ref,
        onLinked: () => {
          this.render(mount, ref, options);
          if (options.onChange) options.onChange();
        },
      });
    });
    mount.querySelectorAll('[data-unlink]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await API.deleteLink(btn.dataset.unlink);
          showToast('Link removed');
          this.render(mount, ref, options);
          if (options.onChange) options.onChange();
        } catch (err) {
          showToast(err.message || 'Could not remove the link', 'error');
        }
      });
    });
  },

  row(c) {
    const e = c.edge;
    const other = c.other;
    const chip = Links.chip(other, other.label, { deleted: other.deleted, max: 56 });
    let verb;
    if (e.kind === 'mention') verb = c.direction === 'outgoing' ? 'mentions' : 'mentioned in';
    else if (e.kind === 'link') verb = 'linked to';
    else if (e.kind === 'became') verb = c.direction === 'outgoing' ? 'became' : 'came from thought';
    else verb = c.direction === 'outgoing' ? 'captured while working on' : 'thought captured during';
    const times = e.kind === 'mention' && e.count > 1 ? ` <span class="connections-times">×${e.count}</span>` : '';
    const unlink = e.kind === 'link' ? `<button type="button" class="connections-unlink" data-unlink="${escapeHtml(e.id)}" title="Remove this link" data-testid="connections-unlink">✕</button>` : '';
    return `<li class="connections-row connections-${e.kind}" data-testid="connections-row"><span class="connections-verb">${verb}</span>${chip}${times}${unlink}</li>`;
  },
};
