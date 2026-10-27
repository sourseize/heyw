/**
 * Real-browser helper for the UI suite. Uses Playwright (dev dependency) with the
 * `chromium-headless-shell` channel. When Playwright or the browser binary is not
 * available the helper reports `available: false` and the UI tests skip themselves,
 * so the core suite never depends on a browser.
 *
 * Browser location: Playwright honours `PLAYWRIGHT_BROWSERS_PATH`. As a convenience
 * for machines that keep browsers in the conventional shared location, we fall back
 * to `/opt/pw-browsers` when it exists and the variable is unset.
 */
import fs from 'node:fs';
import path from 'node:path';

const SHARED_BROWSER_DIR = '/opt/pw-browsers';

export interface BrowserHandle {
  available: boolean;
  reason?: string;
  browser?: any;
  /** Opens a page and wires console/page-error capture. */
  newPage(options?: { timezoneId?: string; viewport?: { width: number; height: number } }): Promise<{ page: any; errors: string[]; consoleErrors: string[]; context: any }>;
  close(): Promise<void>;
}

export async function launchBrowser(): Promise<BrowserHandle> {
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(SHARED_BROWSER_DIR)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = SHARED_BROWSER_DIR;
  }

  // Import by variable name so TypeScript does not require the module at compile time.
  const moduleName = 'playwright';
  let pw: any;
  try {
    pw = await import(moduleName);
  } catch (err: any) {
    return unavailable(`Playwright is not installed (${err?.message || err}). Run: npm install`);
  }

  let browser: any;
  try {
    browser = await pw.chromium.launch({ channel: 'chromium-headless-shell' });
  } catch (err: any) {
    try {
      browser = await pw.chromium.launch();
    } catch (err2: any) {
      return unavailable(
        `No Chromium available for Playwright (${String(err2?.message || err2).split('\n')[0]}). ` +
        `Set PLAYWRIGHT_BROWSERS_PATH or run: npx playwright install chromium-headless-shell`,
      );
    }
  }

  const contexts: any[] = [];
  return {
    available: true,
    browser,
    async newPage(options = {}) {
      const context = await browser.newContext({
        viewport: options.viewport || { width: 1280, height: 800 },
        timezoneId: options.timezoneId,
      });
      contexts.push(context);
      const page = await context.newPage();
      const errors: string[] = [];
      const consoleErrors: string[] = [];
      page.on('pageerror', (e: any) => errors.push(String(e?.message || e)));
      page.on('console', (msg: any) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });
      return { page, errors, consoleErrors, context };
    },
    async close() {
      for (const c of contexts) await c.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

function unavailable(reason: string): BrowserHandle {
  return {
    available: false,
    reason,
    newPage: async () => {
      throw new Error(reason);
    },
    close: async () => {},
  };
}

/** Where failure artefacts (screenshots, console logs) are written. */
export function artefactDir(): string {
  const dir = path.join(process.cwd(), 'test-results');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function saveFailureArtefacts(name: string, page: any, logs: string[]) {
  const dir = artefactDir();
  const safe = name.replace(/[^a-z0-9-_]+/gi, '_');
  try {
    await page.screenshot({ path: path.join(dir, `${safe}.png`), fullPage: true });
  } catch {
    /* page may be closed */
  }
  fs.writeFileSync(path.join(dir, `${safe}.log`), logs.join('\n'), 'utf-8');
}
