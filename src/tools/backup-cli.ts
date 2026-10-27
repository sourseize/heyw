#!/usr/bin/env node
/**
 * Backup / restore CLI for the local store.
 *
 *   npm run backup -- list
 *   npm run backup -- create
 *   npm run backup -- restore latest
 *   npm run backup -- restore database-2025-03-31T09-12-00Z-startup.json
 *
 * Honours HEYW_DATA_FILE and HEYW_BACKUP_DIR.
 */
import path from 'node:path';
import { Database, DatabaseFileError, DEFAULT_DATA_FILE } from '../db/database.js';
import { BackupManager } from '../db/backup.js';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  const [command = 'list', arg] = process.argv.slice(2);
  const dataFile = path.resolve(process.env.HEYW_DATA_FILE || DEFAULT_DATA_FILE());
  const manager = new BackupManager(dataFile);

  switch (command) {
    case 'list': {
      const entries = await manager.list();
      console.log(`Store   : ${dataFile}`);
      console.log(`Backups : ${manager.dir}`);
      if (entries.length === 0) {
        console.log('\n(no backups yet — one is taken every time the server starts)');
        return;
      }
      console.log('');
      for (const e of entries) {
        console.log(`  ${e.createdAt}  ${formatSize(e.size).padStart(9)}  ${e.reason.padEnd(12)} ${e.name}`);
      }
      console.log(`\n${entries.length} backup(s). Restore with:  npm run backup -- restore latest`);
      return;
    }

    case 'create': {
      const entry = await manager.create('manual', { force: arg === '--force' });
      if (!entry) {
        console.log('Store is unchanged since the last backup — nothing written.');
        console.log('Use "npm run backup -- create --force" to copy it anyway.');
        return;
      }
      console.log(`✔ Backup created: ${entry.name} (${formatSize(entry.size)})`);
      return;
    }

    case 'restore': {
      if (!arg) {
        console.error('Usage: npm run backup -- restore <latest|backup-file-name>');
        process.exitCode = 1;
        return;
      }
      const { restored, safetyCopy } = await manager.restore(arg);
      console.log(`✔ Restored ${restored.name} (taken ${restored.createdAt}) into ${dataFile}`);
      if (safetyCopy) console.log(`  The previous store was saved as ${safetyCopy.name}`);
      const db = new Database(dataFile);
      await db.init();
      const s = db.snapshot();
      console.log(`  Now holding: ${s.tasks.length} tasks, ${s.focusSessions.length} sessions, ${s.notes.length} notes, ${s.dailyLogs.length} journal days.`);
      return;
    }

    default:
      console.error(`Unknown command "${command}". Use: list | create | restore <name|latest>`);
      process.exitCode = 1;
  }
}

main().catch(err => {
  if (err instanceof DatabaseFileError) {
    console.error(`✖ ${err.message}\n  File: ${err.filePath}`);
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
