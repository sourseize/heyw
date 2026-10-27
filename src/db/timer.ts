/**
 * Server-authoritative focus timer.
 *
 * The browser used to own the countdown, so: switching Deep Focus → Break threw
 * the elapsed time away, a reload lost the block entirely, and a session was only
 * ever recorded if the page happened to stay open until the end.
 *
 * Here the timer lives in the store and the server is the clock. Every way a block
 * can end is recorded:
 *
 *   completed  the planned duration was reached (finalised by the background worker,
 *              even if no browser is open)
 *   stopped    the user stopped it
 *   switched   another timer type/task took over — the elapsed time is still logged
 *   abandoned  no client heartbeat for `staleAfterMs`; credited only up to the last
 *              heartbeat, so a closed laptop never earns focus minutes
 *
 * Blocks shorter than `minSessionMs` are dropped rather than logged as noise.
 *
 * Presence policy. A block is only credited for time we have evidence for: clients
 * (including the pop-out timer window) send a heartbeat every few seconds. Closing
 * every HeyWork window therefore ends the block at the last heartbeat. If you would
 * rather close the browser and be trusted for the full block, set
 * `HEYW_TIMER_TRUST_SILENCE=1`; the unverified stretch is then still recorded on the
 * session as `integrity.unverifiedMs`, so the Book of Work stays honest either way.
 */
import crypto from 'node:crypto';
import type { ActiveTimer, FocusSession, SessionEndReason, SessionIntegrity, TimerType } from './database.js';
import type { Database } from './database.js';

export const TIMER_TYPES: TimerType[] = ['focus', 'short_break', 'long_break'];

export const DEFAULT_PLANNED_MINUTES: Record<TimerType, number> = {
  focus: 25,
  short_break: 5,
  long_break: 15,
};

export interface TimerEngineOptions {
  /** A running timer whose client has been silent for this long is abandoned. */
  staleAfterMs?: number;
  /** When true, silence does not end a block; it runs to its planned end. */
  trustSilence?: boolean;
  /** Blocks shorter than this are not recorded at all. */
  minSessionMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

export interface StartInput {
  type: TimerType;
  plannedMinutes?: number;
  taskId?: string;
  taskTitle?: string;
  notes?: string;
}

export interface HeartbeatInput {
  visible?: boolean;
  /** Milliseconds spent hidden/unfocused since the previous heartbeat. */
  hiddenMs?: number;
  /** Number of times the user left the tab since the previous heartbeat. */
  hiddenEvents?: number;
  /** Clicks/keys inside HeyWork since the previous heartbeat. */
  interactions?: number;
}

/** What clients render. All times are absolute so a client can tick locally without drift. */
export interface TimerView {
  id: string;
  type: TimerType;
  taskId?: string;
  taskTitle?: string;
  plannedMinutes: number;
  plannedMs: number;
  startedAt: string;
  running: boolean;
  elapsedMs: number;
  remainingMs: number;
  /** When running, the wall-clock instant the block is due to end. */
  endsAt: string | null;
  integrity: SessionIntegrity;
  serverNow: string;
}

export interface FinalizeResult {
  timer: ActiveTimer;
  session: FocusSession | null;
  reason: SessionEndReason;
  elapsedMs: number;
  /** True when the block was too short to be worth recording. */
  discarded: boolean;
}

export class TimerEngine {
  private readonly db: Database;
  readonly staleAfterMs: number;
  readonly minSessionMs: number;
  readonly trustSilence: boolean;
  private readonly now: () => number;

  constructor(db: Database, options: TimerEngineOptions = {}) {
    this.db = db;
    this.staleAfterMs = options.staleAfterMs ?? envInt('HEYW_TIMER_STALE_MS', 90_000);
    this.minSessionMs = options.minSessionMs ?? envInt('HEYW_TIMER_MIN_SESSION_MS', 60_000);
    this.trustSilence = options.trustSilence ?? process.env.HEYW_TIMER_TRUST_SILENCE === '1';
    this.now = options.now || (() => Date.now());
  }

  // ── Queries ──

  /** Elapsed running time, excluding paused stretches. */
  elapsedMs(timer: ActiveTimer, at = this.now()): number {
    const live = timer.runningSince ? Math.max(0, at - Date.parse(timer.runningSince)) : 0;
    return timer.accumulatedMs + live;
  }

  view(timer: ActiveTimer | null = this.db.getActiveTimer(), at = this.now()): TimerView | null {
    if (!timer) return null;
    const plannedMs = timer.plannedMinutes * 60_000;
    const elapsed = this.elapsedMs(timer, at);
    const remaining = Math.max(0, plannedMs - elapsed);
    return {
      id: timer.id,
      type: timer.type,
      taskId: timer.taskId,
      taskTitle: timer.taskTitle,
      plannedMinutes: timer.plannedMinutes,
      plannedMs,
      startedAt: timer.startedAt,
      running: Boolean(timer.runningSince),
      elapsedMs: elapsed,
      remainingMs: remaining,
      endsAt: timer.runningSince ? new Date(at + remaining).toISOString() : null,
      integrity: { ...timer.integrity },
      serverNow: new Date(at).toISOString(),
    };
  }

  // ── Commands ──

  /**
   * Starts a block. Any timer already in flight is finalised first with reason
   * `switched`, so its elapsed time is preserved rather than thrown away.
   */
  start(input: StartInput, replaceReason: 'switched' | 'stopped' = 'switched'): { timer: ActiveTimer; replaced: FinalizeResult | null } {
    const at = this.now();
    const replaced = this.db.getActiveTimer() ? this.finalize(replaceReason, at) : null;

    const plannedMinutes = normalisePlanned(input.plannedMinutes, input.type);
    const iso = new Date(at).toISOString();
    const timer: ActiveTimer = {
      id: crypto.randomUUID(),
      type: input.type,
      taskId: input.taskId,
      taskTitle: input.taskTitle,
      plannedMinutes,
      startedAt: iso,
      accumulatedMs: 0,
      runningSince: iso,
      lastHeartbeatAt: iso,
      integrity: { awayMs: 0, distractions: 0, appInteractions: 0 },
      notes: input.notes,
    };
    this.db.setActiveTimer(timer);
    return { timer, replaced };
  }

  pause(): ActiveTimer | null {
    const timer = this.db.getActiveTimer();
    if (!timer || !timer.runningSince) return timer;
    const at = this.now();
    timer.accumulatedMs = this.elapsedMs(timer, at);
    delete timer.runningSince;
    timer.lastHeartbeatAt = new Date(at).toISOString();
    return timer;
  }

  resume(): ActiveTimer | null {
    const timer = this.db.getActiveTimer();
    if (!timer || timer.runningSince) return timer;
    const iso = new Date(this.now()).toISOString();
    timer.runningSince = iso;
    timer.lastHeartbeatAt = iso;
    return timer;
  }

  /** Records a sign of life and accumulates attention signals. */
  heartbeat(input: HeartbeatInput = {}): ActiveTimer | null {
    const timer = this.db.getActiveTimer();
    if (!timer) return null;
    timer.lastHeartbeatAt = new Date(this.now()).toISOString();
    const i = timer.integrity;
    if (typeof input.hiddenMs === 'number' && input.hiddenMs > 0) i.awayMs += Math.round(input.hiddenMs);
    if (typeof input.hiddenEvents === 'number' && input.hiddenEvents > 0) i.distractions += Math.round(input.hiddenEvents);
    if (typeof input.interactions === 'number' && input.interactions > 0) i.appInteractions += Math.round(input.interactions);
    return timer;
  }

  stop(): FinalizeResult | null {
    if (!this.db.getActiveTimer()) return null;
    return this.finalize('stopped', this.now());
  }

  /**
   * Called by the background worker. Finalises the active timer when it has run
   * its planned length, or when its client has gone silent.
   */
  tick(at = this.now()): FinalizeResult | null {
    const timer = this.db.getActiveTimer();
    if (!timer) return null;

    if (timer.runningSince) {
      const plannedMs = timer.plannedMinutes * 60_000;
      if (this.elapsedMs(timer, at) >= plannedMs) {
        // Credit exactly the planned duration, not the worker's polling lag.
        const endAt = Date.parse(timer.runningSince) + (plannedMs - timer.accumulatedMs);
        return this.finalize('completed', endAt);
      }
      const silentFor = at - Date.parse(timer.lastHeartbeatAt);
      if (silentFor > this.staleAfterMs && !this.trustSilence) {
        // Credit only up to the last sign of life.
        return this.finalize('abandoned', Date.parse(timer.lastHeartbeatAt));
      }
      return null;
    }

    // Paused timers are abandoned after a much longer silence (24h) to avoid
    // a stale timer sticking around forever.
    const silentFor = at - Date.parse(timer.lastHeartbeatAt);
    if (silentFor > 24 * 60 * 60 * 1000) return this.finalize('abandoned', Date.parse(timer.lastHeartbeatAt));
    return null;
  }

  /** Ends the active timer, writing a session unless the block was trivially short. */
  finalize(reason: SessionEndReason, at = this.now()): FinalizeResult {
    const timer = this.db.getActiveTimer();
    if (!timer) throw new Error('No active timer to finalize');

    const plannedMs = timer.plannedMinutes * 60_000;
    let elapsedMs = this.elapsedMs(timer, at);
    if (reason === 'completed') elapsedMs = plannedMs;
    elapsedMs = Math.max(0, Math.min(elapsedMs, plannedMs));

    this.db.setActiveTimer(null);

    if (elapsedMs < this.minSessionMs) {
      return { timer, session: null, reason, elapsedMs, discarded: true };
    }

    const durationMinutes = reason === 'completed' ? timer.plannedMinutes : Math.round(elapsedMs / 60_000);
    const endedAt = new Date(at).toISOString();
    // How much of the tail of this block had no client reporting in.
    const unverifiedMs = Math.max(0, Math.min(elapsedMs, at - Date.parse(timer.lastHeartbeatAt)));
    const session = this.db.logFocusSession({
      taskId: timer.taskId,
      taskTitle: timer.taskTitle,
      durationMinutes,
      plannedMinutes: timer.plannedMinutes,
      type: timer.type,
      notes: timer.notes || '',
      completed: reason === 'completed',
      endReason: reason,
      timestamp: timer.startedAt,
      endedAt,
      integrity: { ...timer.integrity, unverifiedMs },
    });
    return { timer, session, reason, elapsedMs, discarded: false };
  }
}

function envInt(name: string, fallback: number): number {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function normalisePlanned(minutes: unknown, type: TimerType): number {
  const n = typeof minutes === 'number' ? Math.round(minutes) : NaN;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PLANNED_MINUTES[type];
  return Math.min(n, 8 * 60); // a block longer than 8h is a mistake
}
