// ── HeyWork: Notes & Scratchpad View ──
//
// Notes are where connected thinking starts: type `[[` to mention a task, a
// thought or another note. The strip under the editor shows where the mentions
// point, and the Connections panel shows everything pointing here.
const NotesView = {
  selectedNoteId: null,
  autocomplete: null,
  strip: null,

  async render(container, params = {}) {
    this.destroy();
    const requested = params.path && params.path[0];
    if (requested) this.selectedNoteId = requested;

    const notes = await API.getNotes();
    if (!this.selectedNoteId && notes.length > 0) {
      this.selectedNoteId = notes[0].id;
    }
    const currentNote = notes.find(n => n.id === this.selectedNoteId) || null;
    if (requested && !currentNote) showToast('That note no longer exists', 'error');

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:300px 1fr;gap:1.5rem;height:calc(100vh - 140px)">
        <!-- Notes Sidebar -->
        <div style="display:flex;flex-direction:column;border-right:1px solid var(--border-light);padding-right:1rem">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
            <h2 style="font-size:1.15rem;font-weight:700">Notes & Scratchpad</h2>
            <button class="btn btn-primary btn-sm" id="create-note-btn">+ Note</button>
          </div>

          <input type="text" id="notes-search-input" placeholder="Search notes..." style="padding:0.45rem 0.75rem;border:1px solid var(--border-light);border-radius:var(--radius-sm);background:var(--bg-surface);color:var(--text-primary);font-size:0.85rem;margin-bottom:1rem">

          <div id="notes-list" style="overflow-y:auto;display:flex;flex-direction:column;gap:0.4rem;flex:1">
            ${this.listHtml(notes)}
          </div>
        </div>

        <!-- Note Editor Area -->
        <div style="display:flex;flex-direction:column;padding-left:0.5rem;min-height:0">
          ${currentNote ? `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
              <input type="text" id="edit-note-title" data-testid="note-title" value="${escapeHtml(currentNote.title)}" style="font-size:1.35rem;font-weight:700;border:none;background:transparent;outline:none;color:var(--text-primary);width:70%">
              <div style="display:flex;gap:0.5rem">
                <button class="btn btn-secondary btn-sm" id="pin-note-btn">${currentNote.pinned ? 'Unpin' : '📌 Pin'}</button>
                <button class="btn btn-secondary btn-sm" id="delete-note-btn" style="color:#ef4444">🗑 Delete</button>
                <button class="btn btn-primary btn-sm" id="save-note-btn" data-testid="note-save">Save Note</button>
              </div>
            </div>
            <textarea id="edit-note-content" data-testid="note-content" class="textarea-clean" style="flex:1;min-height:260px;font-family:var(--font-mono);font-size:0.92rem;line-height:1.6">${escapeHtml(currentNote.content)}</textarea>
            <div id="note-link-strip" class="link-strip" data-testid="note-link-strip"></div>
            <div id="note-connections"></div>
          ` : `
            <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted)">
              Select or create a note to start writing
            </div>
          `}
        </div>
      </div>
    `;

    this.bindEvents(container, currentNote);
  },

  /** Releases the editor helpers; called by the router before another view renders. */
  destroy() {
    this.autocomplete?.detach();
    this.autocomplete = null;
    this.strip?.detach();
    this.strip = null;
  },

  listHtml(notes) {
    return notes.map(n => `
      <div class="note-list-item" data-id="${n.id}" data-testid="note-list-item" style="padding:0.75rem;border-radius:var(--radius-sm);background:${n.id === this.selectedNoteId ? 'var(--accent-light)' : 'var(--bg-surface)'};border:1px solid ${n.id === this.selectedNoteId ? 'var(--accent)' : 'var(--border-light)'};cursor:pointer">
        <div style="font-weight:600;font-size:0.9rem;display:flex;justify-content:space-between;align-items:center">
          <span>${n.pinned ? '📌 ' : ''}${escapeHtml(n.title)}</span>
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.3rem">
          ${new Date(n.updatedAt).toLocaleDateString()}
        </div>
      </div>
    `).join('');
  },

  /** Selecting a note goes through the hash so the address bar always names the open note. */
  select(container, id) {
    this.selectedNoteId = id;
    const target = `notes/${encodeURIComponent(id)}`;
    if (window.location.hash.slice(1) === target) {
      this.render(container);
    } else {
      window.location.hash = target;
    }
  },

  bindList(container) {
    container.querySelectorAll('.note-list-item').forEach(item => {
      item.addEventListener('click', () => this.select(container, item.dataset.id));
    });
  },

  bindEvents(container, currentNote) {
    this.bindList(container);

    container.querySelector('#create-note-btn')?.addEventListener('click', async () => {
      const newNote = await API.createNote({
        title: 'Untitled Note',
        content: '# New Note\n\nStart typing your thoughts here...',
        tags: [],
      });
      showToast('New note created');
      this.select(container, newNote.id);
    });

    const contentField = container.querySelector('#edit-note-content');
    if (currentNote && contentField) {
      this.autocomplete = WikiAutocomplete.attach(contentField);
      this.strip = LinkStrip.attach(contentField, container.querySelector('#note-link-strip'), {
        onCreated: async (note) => {
          // Save what is being typed first, so the mention is not lost, then open the new note.
          await this.save(container, currentNote, { silent: true });
          this.select(container, note.id);
        },
      });
      ConnectionsPanel.render(container.querySelector('#note-connections'), { type: 'note', id: currentNote.id });
    }

    container.querySelector('#save-note-btn')?.addEventListener('click', async () => {
      if (!currentNote) return;
      await this.save(container, currentNote);
      this.render(container);
    });

    container.querySelector('#pin-note-btn')?.addEventListener('click', async () => {
      if (!currentNote) return;
      await API.updateNote(currentNote.id, { pinned: !currentNote.pinned });
      showToast(currentNote.pinned ? 'Note unpinned' : 'Note pinned');
      this.render(container);
    });

    container.querySelector('#delete-note-btn')?.addEventListener('click', async () => {
      if (!currentNote) return;
      const ok = await showConfirm('Delete this note?', `“${currentNote.title}” will be deleted. This cannot be undone (your rotating backups still hold earlier copies). Links pointing here will remember its title.`, { confirmLabel: 'Delete', danger: true });
      if (ok) {
        await API.deleteNote(currentNote.id);
        this.selectedNoteId = null;
        showToast('Note deleted');
        window.location.hash = 'notes';
        if (App.currentView === 'notes') this.render(container);
      }
    });

    const searchInput = container.querySelector('#notes-search-input');
    searchInput?.addEventListener('input', async (e) => {
      const q = e.target.value.trim();
      const filtered = await API.getNotes(undefined, q);
      const listEl = container.querySelector('#notes-list');
      if (listEl) {
        listEl.innerHTML = this.listHtml(filtered);
        this.bindList(container);
      }
    });
  },

  async save(container, currentNote, options = {}) {
    const title = container.querySelector('#edit-note-title').value.trim() || 'Untitled Note';
    const content = container.querySelector('#edit-note-content').value;
    const updated = await API.updateNote(currentNote.id, { title, content });
    if (!options.silent) {
      const rewritten = updated.rewrittenMentions || 0;
      showToast(rewritten ? `Note saved · ${rewritten} mention${rewritten === 1 ? '' : 's'} of the old title updated` : 'Note saved', 'success');
    }
    return updated;
  },
};
