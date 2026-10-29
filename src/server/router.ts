import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

export type Handler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray,
  body?: any,
  query?: URLSearchParams
) => void | Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  params: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  get(pattern: string, handler: Handler) {
    this.addRoute('GET', pattern, handler);
  }

  post(pattern: string, handler: Handler) {
    this.addRoute('POST', pattern, handler);
  }

  put(pattern: string, handler: Handler) {
    this.addRoute('PUT', pattern, handler);
  }

  delete(pattern: string, handler: Handler) {
    this.addRoute('DELETE', pattern, handler);
  }

  private addRoute(method: string, pattern: string, handler: Handler) {
    const paramNames: string[] = [];
    const regexStr = pattern.replace(/:([a-zA-Z_]+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    this.routes.push({
      method,
      pattern: new RegExp(`^${regexStr}$`),
      params: paramNames,
      handler,
    });
  }

  async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    // Privacy: the SPA is same-origin, so no CORS headers are ever emitted. Without
    // them, browsers block cross-origin reads of the API (e.g. from a random website
    // open in another tab). Pre-flight requests are answered with 204 but carry no
    // allow-headers, so the actual cross-origin request is refused by the browser.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);
    const pathname = url.pathname;

    // Static assets
    if (!pathname.startsWith('/api/')) {
      return this.serveStatic(req, res, pathname);
    }

    // Belt and braces against cross-site writes: browsers always attach `Origin`
    // to POST/PUT/DELETE. If it is present it must match the host we were asked for.
    // Non-browser clients (curl, tests) send no Origin and are unaffected.
    if (req.method !== 'GET' && req.method !== 'HEAD' && !this.isSameOrigin(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Cross-origin requests are not allowed' }));
      return;
    }

    // Body parsing for JSON
    let body: any = undefined;
    if (req.method === 'POST' || req.method === 'PUT') {
      body = await this.parseBody(req);
    }

    // Find route match
    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const match = pathname.match(route.pattern);
      if (!match) continue;

      try {
        await route.handler(req, res, match, body, url.searchParams);
      } catch (err: any) {
        console.error('Route error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  }

  private isSameOrigin(req: http.IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (!origin) return true;
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    try {
      return new URL(origin).host === (req.headers.host || '');
    } catch {
      return false;
    }
  }

  private async parseBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        if (!raw) return resolve(undefined);
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve(undefined);
        }
      });
      req.on('error', reject);
    });
  }

  private mimeTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
  };

  private async serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
    let filePath = path.join(process.cwd(), 'public', pathname === '/' ? 'index.html' : pathname);

    try {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
        await fs.stat(filePath);
      }
      const ext = path.extname(filePath).toLowerCase();
      const contentType = this.mimeTypes[ext] || 'application/octet-stream';
      const content = await fs.readFile(filePath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': content.length,
        'Cache-Control': 'no-cache',
      });
      res.end(content);
    } catch {
      // SPA Fallback: serve index.html for unknown frontend routes
      try {
        const fallback = path.join(process.cwd(), 'public', 'index.html');
        const content = await fs.readFile(fallback);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
      }
    }
  }
}

export const router = new Router();
