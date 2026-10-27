/**
 * Boots the real HeyWork server (compiled code, real router, real JSON store)
 * on an ephemeral loopback port with a data file inside a fresh temp directory.
 * Nothing a test does can reach the developer's own `data/database.json`.
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServer } from '../../server.js';
import { db } from '../../db/database.js';

export interface TestServer {
  baseUrl: string;
  host: string;
  port: number;
  tmpDir: string;
  dataFile: string;
  server: http.Server;
  /** JSON helper: returns { status, headers, data } and never throws on HTTP errors. */
  api<T = any>(method: string, apiPath: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; headers: Headers; data: T }>;
  /** Reads the raw data file as parsed JSON. */
  readStore(): Promise<any>;
  /** Stops the server (keeps the temp dir so it can be re-opened). */
  stop(): Promise<void>;
  /** Stops the server and deletes the temp dir. */
  close(): Promise<void>;
}

export interface StartOptions {
  /** Re-use an existing directory/data file (e.g. to test persistence across restarts). */
  tmpDir?: string;
  dataFile?: string;
  /** Pre-populate the data file before the server starts. */
  initialStore?: unknown;
}

export async function startTestServer(options: StartOptions = {}): Promise<TestServer> {
  const tmpDir = options.tmpDir || (await fs.mkdtemp(path.join(os.tmpdir(), 'heyw-test-')));
  const dataFile = options.dataFile || path.join(tmpDir, 'database.json');

  if (options.initialStore !== undefined) {
    await fs.mkdir(path.dirname(dataFile), { recursive: true });
    const raw = typeof options.initialStore === 'string' ? options.initialStore : JSON.stringify(options.initialStore, null, 2);
    await fs.writeFile(dataFile, raw, 'utf-8');
  }

  const server = await createServer({ dataFile });
  const host = '127.0.0.1';
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://${host}:${port}`;

  const api = async (method: string, apiPath: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${baseUrl}${apiPath}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: any = text;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      /* non-JSON body, keep text */
    }
    return { status: res.status, headers: res.headers, data };
  };

  const stop = () =>
    new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));

  return {
    baseUrl,
    host,
    port,
    tmpDir,
    dataFile,
    server,
    api,
    readStore: async () => JSON.parse(await fs.readFile(dataFile, 'utf-8')),
    stop,
    close: async () => {
      await stop().catch(() => {});
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

/** Resets the singleton so a new `createServer` in the same process starts clean. */
export function resetDb(dataFile: string) {
  db.useFile(dataFile);
}

/**
 * Rewinds the running block by `minutes` so tests do not have to wait in real time.
 * Tests run in the same process as the server, so this mutates the live store the
 * server is serving from (writing the file alone would not be seen).
 */
export async function ageActiveTimer(minutes: number, options: { stale?: boolean } = {}) {
  const timer = db.getActiveTimer();
  if (!timer) throw new Error('No active timer to age');
  const ago = new Date(Date.now() - minutes * 60_000).toISOString();
  timer.startedAt = ago;
  if (timer.runningSince) timer.runningSince = ago;
  // Keep the client looking alive unless the test wants an abandoned block.
  timer.lastHeartbeatAt = options.stale ? ago : new Date().toISOString();
  await db.persist();
  return timer;
}
