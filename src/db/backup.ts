/**
 * Local rotating backups of the JSON store.
 *
 * Why: the store is a single file that a human can open and edit. A fat-fingered
 * save, a half-written manual edit, or a bad restore should never be terminal.
 *
 * Policy (all configurable):
 *   - a backup is taken at server start-up, then at most every `minIntervalMs`
 *     while the app runs, and on demand;
 *   - a backup is skipped when the store is byte-identical to the newest backup,
 *     so idle days do not fill the disk;
 *   - pruning keeps `keepPerDay` newest backups for each of the last `keepDays`
 *     days, plus always the newest one overall, capped at `maxTotal`;
 *   - backups live next to the store in `backups/` with mode 0600.
 *
 * Restoring always snapshots the current file first (reason `pre-restore`), so a
 * mistaken restore can itself be undone.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { normaliseSchema, DatabaseFileError, jsonCodec } from './database.js';
import type { StorageCodec } from './database.js';

export type BackupReason = 'startup' | 'interval' | 'manual' | 'pre-restore' | 'pre-seed' | 'pre-clean';

export interface BackupEntry {
  name: string;
  file: string;
  createdAt: string;   // ISO UTC
  reason: BackupReason | string;
  size: number;
}

export interface BackupOptions {
  dir?: string;
  keepPerDay?: number;
  keepDays?: number;
  maxTotal?: number;
  minIntervalMs?: number;
  codec?: StorageCodec;
}

const STAMP_RE_SOURCE = '(\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}Z)(?:-([a-z-]+))?\\.json$';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function backupStamp(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

function parseStamp(stamp: string): string {
  // 2025-03-31T14-25-01Z -> 2025-03-31T14:25:01Z
  const [day, time] = stamp.split('T');
  return `${day}T${time.replace(/-/g, ':')}`;
}

export class BackupManager {
  readonly dir: string;
  /** Backups are named after their store (`database-…`, `test-database-…`) so stores sharing a directory never mix. */
  readonly prefix: string;
  private readonly fileRe: RegExp;
  private readonly dataFile: string;
  private readonly keepPerDay: number;
  private readonly keepDays: number;
  private readonly maxTotal: number;
  readonly minIntervalMs: number;
  private readonly codec: StorageCodec;
  private lastBackupAt = 0;

  constructor(dataFile: string, options: BackupOptions = {}) {
    this.dataFile = dataFile;
    this.prefix = path.basename(dataFile).replace(/\.json$/i, '') || 'database';
    this.fileRe = new RegExp(`^${escapeRegex(this.prefix)}-${STAMP_RE_SOURCE}`);
    this.dir = options.dir || process.env.HEYW_BACKUP_DIR || path.join(path.dirname(dataFile), 'backups');
    this.keepPerDay = options.keepPerDay ?? envInt('HEYW_BACKUP_KEEP_PER_DAY', 3);
    this.keepDays = options.keepDays ?? envInt('HEYW_BACKUP_KEEP_DAYS', 7);
    this.maxTotal = options.maxTotal ?? envInt('HEYW_BACKUP_MAX', 40);
    this.minIntervalMs = options.minIntervalMs ?? envInt('HEYW_BACKUP_INTERVAL_MS', 30 * 60 * 1000);
    this.codec = options.codec || jsonCodec;
  }

  /** Lists backups, newest first. */
  async list(): Promise<BackupEntry[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return [];
    }
    const entries: BackupEntry[] = [];
    for (const name of names) {
      const m = this.fileRe.exec(name);
      if (!m) continue;
      const file = path.join(this.dir, name);
      let size = 0;
      try {
        size = (await fs.stat(file)).size;
      } catch {
        continue;
      }
      entries.push({ name, file, createdAt: parseStamp(m[1]), reason: m[2] || 'manual', size });
    }
    // Newest first. Stamps are unique (see `create`), so this is a total order;
    // the name is only a tie-breaker for files copied in by hand.
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
  }

  async latest(): Promise<BackupEntry | null> {
    return (await this.list())[0] || null;
  }

  /**
   * Copies the current store into the backup directory.
   * Returns null when there is nothing to back up or the content is unchanged.
   */
  async create(reason: BackupReason = 'manual', options: { force?: boolean; now?: Date } = {}): Promise<BackupEntry | null> {
    let content: Buffer;
    try {
      content = await fs.readFile(this.dataFile);
    } catch {
      return null; // no store yet
    }
    if (content.length === 0) return null;

    if (!options.force) {
      const newest = await this.latest();
      if (newest && (await sha256File(newest.file)) === sha256(content)) {
        this.lastBackupAt = Date.now();
        return null; // unchanged since the last backup
      }
    }

    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const now = options.now || new Date();
    // Stamps must be unique across *all* reasons, otherwise two backups taken in
    // the same second cannot be ordered reliably.
    const stampLen = '0000-00-00T00-00-00Z'.length;
    const taken = new Set((await this.list()).map(e => e.name.slice(this.prefix.length + 1, this.prefix.length + 1 + stampLen)));
    let stamp = backupStamp(now);
    let counter = 1;
    while (taken.has(stamp)) {
      stamp = backupStamp(new Date(now.getTime() + counter * 1000));
      counter++;
    }
    const name = `${this.prefix}-${stamp}-${reason}.json`;
    const file = path.join(this.dir, name);
    await fs.writeFile(file, content, { mode: 0o600 });
    this.lastBackupAt = Date.now();
    await this.prune();
    return { name, file, createdAt: parseStamp(stamp), reason, size: content.length };
  }

  /** Creates a backup only when `minIntervalMs` has elapsed since the last one. */
  async createIfDue(reason: BackupReason = 'interval'): Promise<BackupEntry | null> {
    if (Date.now() - this.lastBackupAt < this.minIntervalMs) return null;
    return this.create(reason);
  }

  /** Applies the retention policy. Returns the names it deleted. */
  async prune(): Promise<string[]> {
    const entries = await this.list(); // newest first
    const keep = new Set<string>();
    if (entries[0]) keep.add(entries[0].name);

    const cutoffDays = new Set<string>();
    const perDay = new Map<string, number>();
    for (const e of entries) {
      const day = e.createdAt.slice(0, 10);
      if (!cutoffDays.has(day)) {
        if (cutoffDays.size >= this.keepDays) continue;
        cutoffDays.add(day);
      }
      const used = perDay.get(day) || 0;
      if (used < this.keepPerDay) {
        perDay.set(day, used + 1);
        keep.add(e.name);
      }
    }

    // Global cap: drop the oldest kept entries beyond maxTotal
    const kept = entries.filter(e => keep.has(e.name));
    for (const e of kept.slice(this.maxTotal)) keep.delete(e.name);

    const removed: string[] = [];
    for (const e of entries) {
      if (keep.has(e.name)) continue;
      await fs.rm(e.file, { force: true });
      removed.push(e.name);
    }
    return removed;
  }

  /** Resolves 'latest' or a file name to a backup entry. */
  async resolve(which: string): Promise<BackupEntry | null> {
    if (which === 'latest') return this.latest();
    const all = await this.list();
    return all.find(e => e.name === which || e.file === which || e.name === path.basename(which)) || null;
  }

  /**
   * Replaces the store with a backup. Validates the backup parses as a HeyWork
   * store first, and snapshots the current file (reason `pre-restore`) before
   * overwriting, so the restore itself is reversible.
   */
  async restore(which: string): Promise<{ restored: BackupEntry; safetyCopy: BackupEntry | null }> {
    const entry = await this.resolve(which);
    if (!entry) throw new DatabaseFileError(`No such backup: ${which}`, this.dir);

    const raw = await fs.readFile(entry.file);
    let parsed: unknown;
    try {
      parsed = this.codec.decode(raw);
    } catch (err: any) {
      throw new DatabaseFileError(`Backup is not readable (${err?.message || err})`, entry.file);
    }
    normaliseSchema(parsed, entry.file); // throws when the shape is wrong

    const safetyCopy = await this.create('pre-restore', { force: true });

    await fs.mkdir(path.dirname(this.dataFile), { recursive: true, mode: 0o700 });
    const tmp = `${this.dataFile}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tmp, raw, { mode: 0o600 });
    await fs.rename(tmp, this.dataFile);
    return { restored: entry, safetyCopy };
  }
}

function envInt(name: string, fallback: number): number {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function sha256File(file: string): Promise<string | null> {
  try {
    return sha256(await fs.readFile(file));
  } catch {
    return null;
  }
}

