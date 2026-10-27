import http from 'node:http';
import path from 'node:path';
import { db, DatabaseFileError } from './db/database.js';
import { router } from './server/router.js';
import { getBackupManager } from './server/context.js';
import { startBackgroundJobs } from './server/jobs.js';
import type { Jobs, JobsOptions } from './server/jobs.js';
import './routes/api.js'; // Registers all REST endpoints

export const DEFAULT_PORT = 3000;
/** Loopback only by default: the store is personal, nobody on the LAN should reach it. */
export const DEFAULT_HOST = '127.0.0.1';

export interface ServerOptions {
  /** Path of the JSON store. Precedence: option > HEYW_DATA_FILE env > ./data/database.json */
  dataFile?: string;
  /** Background worker tuning (timer finalisation, rotating backups). */
  jobs?: JobsOptions | false;
}

export interface HeyWorkServer extends http.Server {
  /** Background workers attached to this server; stopped automatically on close. */
  jobs?: Jobs;
}

/**
 * Initialises the database and returns an (unlistened) HTTP server.
 * Throws `DatabaseFileError` when the data file exists but cannot be read/parsed —
 * the file is left untouched in that case.
 */
export async function createServer(options: ServerOptions = {}): Promise<HeyWorkServer> {
  const dataFile = options.dataFile || process.env.HEYW_DATA_FILE;
  if (dataFile) {
    db.useFile(path.resolve(dataFile));
  }
  await db.init();

  // A safety copy of whatever we just loaded, before the app can write to it.
  if (options.jobs !== false && process.env.HEYW_BACKUP_DISABLE !== '1') {
    await getBackupManager().create('startup').catch(err => console.error('Start-up backup failed:', err));
  }

  const server: HeyWorkServer = http.createServer((req, res) => router.handle(req, res));

  if (options.jobs !== false) {
    const jobs = startBackgroundJobs(options.jobs || {});
    // Catch up on a timer left running by a previous process before finishing start-up,
    // and freeze any month that closed while the app was not running.
    await jobs.tickTimer();
    await jobs.freezeMonths();
    server.jobs = jobs;
    server.on('close', () => jobs.stop());
  }
  return server;
}

export function resolveHost(): string {
  return process.env.HOST || DEFAULT_HOST;
}

export function resolvePort(): number {
  const p = parseInt(process.env.PORT || '', 10);
  return Number.isFinite(p) && p >= 0 ? p : DEFAULT_PORT;
}

async function main() {
  const host = resolveHost();
  const port = resolvePort();
  let server: http.Server;
  try {
    server = await createServer();
  } catch (err) {
    if (err instanceof DatabaseFileError) {
      console.error(`\n✖ HeyWork refused to start to protect your data.\n  File: ${err.filePath}\n  ${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }

  server.listen(port, host, () => {
    const displayHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
    const rel = path.relative(process.cwd(), db.file);
    const shownFile = rel && !rel.startsWith('..') ? rel : db.file;
    console.log('');
    console.log('  🌿 HeyWork — Calm Personal Work & Focus OS');
    console.log(`  Running at  http://${displayHost}:${port}`);
    console.log(`  Data file   ${shownFile}`);
    if (host !== DEFAULT_HOST) {
      console.log(`  ⚠ Listening on ${host}: the app is reachable from the network.`);
    } else {
      console.log('  Local • Offline • Loopback only');
    }
    console.log('');
  });
}

// Run if called directly
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
