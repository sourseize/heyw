/**
 * Shared server-side singletons. They follow the database singleton, so pointing
 * the app at a different data file (tests, `HEYW_DATA_FILE`) re-targets everything.
 */
import { db } from '../db/database.js';
import { BackupManager } from '../db/backup.js';
import { TimerEngine } from '../db/timer.js';

let backupManager: BackupManager | null = null;
let backupManagerFor: string | null = null;

export function getBackupManager(): BackupManager {
  if (!backupManager || backupManagerFor !== db.file) {
    backupManager = new BackupManager(db.file);
    backupManagerFor = db.file;
  }
  return backupManager;
}

export const timerEngine = new TimerEngine(db);
