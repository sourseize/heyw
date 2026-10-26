import http from 'node:http';
import { db } from './db/database.js';
import { router } from './server/router.js';
import './routes/api.js'; // Registers all REST endpoints

const PORT = parseInt(process.env.PORT || '3000', 10);

export async function createServer() {
  await db.init();
  const server = http.createServer((req, res) => router.handle(req, res));
  return server;
}

async function main() {
  const server = await createServer();
  server.listen(PORT, () => {
    console.log(`
┌──────────────────────────────────────────────────┐
│  🌿 HeyWork — Calm Personal Work & Focus OS      │
│  Running at http://localhost:${PORT}                │
└──────────────────────────────────────────────────┘
    `);
  });
}

// Run if called directly
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  main().catch(console.error);
}
