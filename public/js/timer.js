// ── HeyWork: Focus Timer Client ──
//
// The countdown lives on the server; this is a thin, self-contained view of it.
// Consequences: reloading the page, navigating between views, or closing the tab
// no longer loses a block, and every ending is recorded by the server.
//
// Any window that loads this file (the app shell *and* the pop-out timer) keeps
// the block alive by sending heartbeats, and reports attention signals:
// time spent away from the window, and how much the user poked at HeyWork itself.
const FocusTimer = {
  state: null,            // latest TimerView from the server, or null
  syncedAtClient: 0,      // performance-independent client timestamp of last sync
  listeners: [],
  pollHandle: null,
  tickHandle: null,
  heartbeatHandle: null,
  started: false,

  // attention signals gathered since the last heartbeat
  pending: { hiddenMs: 0, hiddenEvents: 0, interactions: 0 },
  hiddenSince: null,

  TYPE_LABELS: {
    focus: 'Deep Focus',
    short_break: 'Short Break',
    long_break: 'Rest',
  },

  /** @param {{heartbeatMs?: number, syncMs?: number, trackInteractions?: boolean}} options */
  init(options = {}) {
    if (this.started) return;
    this.started = true;
    this.heartbeatMs = options.heartbeatMs || 15000;
    this.syncMs = options.syncMs || 30000;
    this.trackInteractions = options.trackInteractions !== false;

    this.sync();
    this.tickHandle = setInterval(() => this.emit(), 250);
    this.heartbeatHandle = setInterval(() => this.heartbeat(), this.heartbeatMs);
    this.pollHandle = setInterval(() => this.sync(), this.syncMs);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.hiddenSince = Date.now();
        this.pending.hiddenEvents++;
      } else {
        if (this.hiddenSince) {
          this.pending.hiddenMs += Date.now() - this.hiddenSince;
          this.hiddenSince = null;
        }
        this.sync(); // catch up after being away
      }
    });

    if (this.trackInteractions) {
      const bump = () => { this.pending.interactions++; };
      document.addEventListener('click', bump, true);
      document.addEventListener('keydown', bump, true);
    }

    window.addEventListener('beforeunload', () => this.heartbeat({ beacon: true }));
  },

  // ── Server calls ──

  async _request(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${method} ${path} failed`);
    return data;
  },

  _apply(payload) {
    const previous = this.state;
    this.state = payload && payload.timer ? payload.timer : null;
    this.syncedAtClient = Date.now();
    if (payload && payload.finalized) this._announce(payload.finalized);
    if (payload && payload.replaced) this._announce(payload.replaced);
    this.emit(previous);
    return this.state;
  },

  async sync() {
    try {
      return this._apply(await this._request('GET', '/api/timer'));
    } catch (err) {
      return this.state;
    }
  },

  async start(type, plannedMinutes, taskId, options = {}) {
    return this._apply(await this._request('POST', '/api/timer/start', {
      type, plannedMinutes, taskId: taskId || undefined, replaceReason: options.replaceReason,
    }));
  },

  /** Restarts the running block from the top; what was done so far is recorded. */
  async reset() {
    if (!this.state) return null;
    const { type, plannedMinutes, taskId } = this.state;
    return this.start(type, plannedMinutes, taskId, { replaceReason: 'stopped' });
  },

  async pause() {
    return this._apply(await this._request('POST', '/api/timer/pause'));
  },

  async resume() {
    return this._apply(await this._request('POST', '/api/timer/resume'));
  },

  /** Start / pause / resume depending on the current state. */
  async toggle(defaults = {}) {
    if (!this.state) return this.start(defaults.type || 'focus', defaults.plannedMinutes, defaults.taskId);
    return this.state.running ? this.pause() : this.resume();
  },

  /** Ends the block; the elapsed time is recorded, not discarded. */
  async stop() {
    return this._apply(await this._request('POST', '/api/timer/stop'));
  },

  async heartbeat(options = {}) {
    if (!this.state) return null;
    const payload = {
      visible: document.visibilityState === 'visible',
      hiddenMs: this.pending.hiddenMs + (this.hiddenSince ? Date.now() - this.hiddenSince : 0),
      hiddenEvents: this.pending.hiddenEvents,
      interactions: this.pending.interactions,
    };
    this.pending = { hiddenMs: 0, hiddenEvents: 0, interactions: 0 };
    if (this.hiddenSince) this.hiddenSince = Date.now();

    if (options.beacon && navigator.sendBeacon) {
      navigator.sendBeacon('/api/timer/heartbeat', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
      return null;
    }
    try {
      return this._apply(await this._request('POST', '/api/timer/heartbeat', payload));
    } catch {
      return this.state;
    }
  },

  // ── Derived view ──

  /** Milliseconds left, ticked locally between syncs so the display is smooth. */
  remainingMs() {
    if (!this.state) return 0;
    if (!this.state.running) return this.state.remainingMs;
    const drift = Date.now() - this.syncedAtClient;
    return Math.max(0, this.state.remainingMs - drift);
  },

  elapsedMs() {
    if (!this.state) return 0;
    if (!this.state.running) return this.state.elapsedMs;
    return this.state.elapsedMs + (Date.now() - this.syncedAtClient);
  },

  isRunning() {
    return Boolean(this.state && this.state.running);
  },

  isActive() {
    return Boolean(this.state);
  },

  typeLabel(type) {
    return this.TYPE_LABELS[type || (this.state && this.state.type)] || 'Focus';
  },

  formatRemaining() {
    const total = Math.ceil(this.remainingMs() / 1000);
    const m = Math.floor(total / 60).toString().padStart(2, '0');
    const s = (total % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  },

  // ── Events ──

  onChange(fn) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  },

  emit(previous) {
    // When the local countdown reaches zero, ask the server to settle the block.
    if (this.state && this.state.running && this.remainingMs() <= 0 && !this._settling) {
      this._settling = true;
      this.heartbeat().finally(() => { this._settling = false; });
    }
    for (const fn of this.listeners) {
      try {
        fn(this.state, previous);
      } catch (err) {
        console.error('timer listener failed', err);
      }
    }
  },

  _announce(result) {
    if (!result || result.discarded) return;
    const label = this.typeLabel(result.type);
    const minutes = result.elapsedMinutes;
    if (result.reason === 'completed') {
      if (typeof AmbientAudio !== 'undefined') AmbientAudio.playChime();
      this._toast(`${label} complete — ${minutes}m recorded. Take a mindful breath.`, 'success');
    } else if (result.reason === 'switched') {
      this._toast(`${minutes}m of ${label} recorded before switching.`);
    } else if (result.reason === 'abandoned') {
      this._toast(`${label} ended after losing contact — ${minutes}m recorded.`);
    } else {
      this._toast(`${label} stopped — ${minutes}m recorded.`);
    }
  },

  _toast(message, type) {
    if (typeof showToast === 'function') showToast(message, type);
  },

  /**
   * Opens the small always-visible countdown window. Uses the Document
   * Picture-in-Picture API when the browser has it (stays on top of other apps),
   * otherwise a plain popup window. Both render the same `/timer.html` page, which
   * keeps its own heartbeat going — so you can close the main window and keep working.
   */
  async popOut() {
    const width = 260;
    const height = 168;
    if (window.documentPictureInPicture && window.documentPictureInPicture.requestWindow) {
      try {
        const pip = await window.documentPictureInPicture.requestWindow({ width, height });
        const frame = pip.document.createElement('iframe');
        frame.src = '/timer.html?pip=1';
        frame.style.cssText = 'border:0;width:100%;height:100%;display:block';
        pip.document.body.style.cssText = 'margin:0;overflow:hidden';
        pip.document.body.appendChild(frame);
        return pip;
      } catch (err) {
        /* fall through to a normal popup */
      }
    }
    return window.open('/timer.html', 'heyw-timer', `popup=yes,width=${width},height=${height}`);
  },
};
