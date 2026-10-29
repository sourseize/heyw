/**
 * Background workers.
 *
 *  - Timer worker: finalises the active focus block when it reaches its planned
 *    length or when its client goes silent. This is what makes a session get
 *    recorded even if the browser was closed mid-block.
 *  - Backup worker: takes a rotating local backup of the store at intervals.
 *  - Book of Work freezer: at 00:00 UTC on the 1st (and when the user's zone
 *    rolls over, if that is later) it freezes the month that just closed. A
 *    catch-up pass at start-up covers months that closed while the app was off.
 *
 * Both use unref'd timers so they never keep a process (or a test run) alive.
 */
import { db } from '../db/database.js';
import { getBackupManager, timerEngine } from './context.js';
import type { FinalizeResult } from '../db/timer.js';
import { freezeClosedMonths, freezeZone, nextFreezeInstant } from '../db/bookofwork.js';
import type { MonthlySummaryRecord } from '../db/database.js';

export interface JobsOptions {
  timerTickMs?: number;
  backupCheckMs?: number;
  enableBackups?: boolean;
  enableFreeze?: boolean;
  onTimerFinalized?: (result: FinalizeResult) => void;
  /** Injectable clock for the freeze scheduler (tests). */
  now?: () => Date;
}

export interface Jobs {
  stop(): void;
  /** Runs one timer tick immediately (used at start-up and by tests). */
  tickTimer(): Promise<FinalizeResult | null>;
  /** Freezes any closed month lacking a snapshot (start-up catch-up and the scheduled run). */
  freezeMonths(): Promise<MonthlySummaryRecord[]>;
  /** When the next scheduled freeze will run, or null when disabled. */
  nextFreezeAt(): Date | null;
}

// setTimeout cannot wait longer than ~24.8 days; chain shorter waits instead.
const MAX_TIMEOUT_MS = 20 * 24 * 60 * 60 * 1000;

export function startBackgroundJobs(options: JobsOptions = {}): Jobs {
  const timerTickMs = options.timerTickMs ?? envInt('HEYW_TIMER_TICK_MS', 5_000);
  const backupCheckMs = options.backupCheckMs ?? envInt('HEYW_BACKUP_CHECK_MS', 5 * 60_000);
  const backupsEnabled = options.enableBackups ?? process.env.HEYW_BACKUP_DISABLE !== '1';

  const tickTimer = async (): Promise<FinalizeResult | null> => {
    try {
      const result = timerEngine.tick();
      if (result) {
        await db.persist();
        options.onTimerFinalized?.(result);
        const mins = Math.round(result.elapsedMs / 60_000);
        console.log(`⏱  Timer ${result.reason}: ${mins}m ${result.timer.type}${result.discarded ? ' (too short, not recorded)' : ''}`);
      }
      return result;
    } catch (err) {
      console.error('Timer worker error:', err);
      return null;
    }
  };

  const timerHandle = setInterval(() => void tickTimer(), timerTickMs);
  timerHandle.unref?.();

  let backupHandle: NodeJS.Timeout | null = null;
  if (backupsEnabled) {
    backupHandle = setInterval(() => {
      getBackupManager()
        .createIfDue('interval')
        .catch(err => console.error('Backup worker error:', err));
    }, backupCheckMs);
    backupHandle.unref?.();
  }

  const now = options.now || (() => new Date());
  const freezeEnabled = options.enableFreeze ?? true;
  let freezeHandle: NodeJS.Timeout | null = null;
  let freezeAt: Date | null = null;

  const freezeMonths = async (): Promise<MonthlySummaryRecord[]> => {
    try {
      const frozen = freezeClosedMonths(db, now());
      if (frozen.length) {
        await db.persist();
        console.log(`📘 Book of Work: froze ${frozen.map(f => f.month).join(', ')} (${freezeZone(db)})`);
      }
      return frozen;
    } catch (err) {
      console.error('Book of Work freeze failed:', err);
      return [];
    }
  };

  const scheduleFreeze = () => {
    if (!freezeEnabled) return;
    const at = nextFreezeInstant(now(), freezeZone(db));
    freezeAt = at;
    const wait = Math.max(1000, at.getTime() - now().getTime());
    freezeHandle = setTimeout(async () => {
      if (wait > MAX_TIMEOUT_MS) {
        scheduleFreeze(); // not there yet — keep chaining
        return;
      }
      await freezeMonths();
      scheduleFreeze();
    }, Math.min(wait, MAX_TIMEOUT_MS));
    freezeHandle.unref?.();
  };
  scheduleFreeze();

  return {
    stop() {
      clearInterval(timerHandle);
      if (backupHandle) clearInterval(backupHandle);
      if (freezeHandle) clearTimeout(freezeHandle);
    },
    tickTimer,
    freezeMonths,
    nextFreezeAt: () => (freezeEnabled ? freezeAt : null),
  };
}

function envInt(name: string, fallback: number): number {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
