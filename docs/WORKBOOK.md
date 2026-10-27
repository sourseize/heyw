# HeyWork — Development Workbook

> Status: **v7 — all phases DONE** (0, 0.5, 1, 2, 3, 4) plus the review round in §14. Optional follow-ups in §13.
> Scope: (1) Thought capture during focus, (2) Monthly "Book of Work" summary + archive,
> (3) Deterministic test-data generator with cleanup, (4) End-to-end regression suite (HTTP + real browser),
> (5) Privacy hardening of the local data file and server.
>
> v2 changes after review: time-zone model fixed (UTC at rest, user time on the client); Playwright + `chrome-headless-shell`
> verified and adopted; discard = soft, never purged; monthly summaries are auto-generated only, with an Archive
> section and `.md` download; PUT hardening accepted; new §7 privacy assessment.
>
> v3 decisions (second review): Q1 confirmed (permanent soft-hide, restorable). Q2 → summaries are **computed on demand
> for the in-progress month** *and* **frozen automatically** into `monthlySummaries` at 00:00 UTC on the 1st, with a
> catch-up pass at server start for any closed month that has no snapshot. Q3 → per-month `.md` download only, no merged
> file. Q4 → privacy A–C done in Phase 0; encryption (D) parked but the codec seam is in place. Q5 → `--into` confirmed.
> Q6 → Playwright is a devDependency. See §8 for the Phase 0 log.

---

## 0. Codebase understanding (what exists today)

### 0.1 Shape of the system

| Layer | Location | Notes |
|---|---|---|
| Entry | `src/server.ts` | `createServer()` → `db.init()` + `http.createServer(router.handle)`. `PORT` env only. `listen(PORT)` with **no host → all interfaces**. |
| Router | `src/server/router.ts` | Hand-rolled regex router. `Handler(req, res, match, body, query)`. Non-`/api/` paths → static files from `public/`, SPA fallback to `index.html`. JSON body parsed for POST/PUT only. Sets `Access-Control-Allow-Origin: *` on every response. |
| API | `src/routes/api.ts` | Registers routes on the `router` singleton at import time. Every mutating route calls `db.persist()` itself. |
| Data | `src/db/database.ts` | Single `Database` class; whole DB in memory (`DatabaseSchema`), atomic write via temp file + rename to `data/database.json` (mode 0644). Singleton `db` exported with default path. Seeds a "welcome" dataset on first run. |
| Front-end | `public/js/*.js` | No bundler, no modules: plain `<script>` globals (`API`, `App`, `TodayView`, `BoardView`, `JournalView`, `NotesView`, `InsightsView`, `AmbientAudio`, `CanvasCharts`, `showModal`, `showToast`, `escapeHtml`). Each view is an object with `render(container)` + `bindEvents()`; re-renders by rebuilding `innerHTML`. Hash routing via `App.navigate()`. |
| Styling | `public/css/style.css` | CSS variables, light/dark via `data-theme`. Reusable classes: `.btn`, `.badge-*`, `.task-card`, `.journal-card`, `.stat-box`, `.chart-card`, `.modal-overlay`, `.toast`. |
| Tests | `src/test/*.test.ts` | `node:test` + `node:assert/strict`, compiled to `dist/test`, run with `node --test`. DB unit tests use a temp file; API tests boot the real server on port 0. |

Entities: `Project`, `Task` (status `backlog|todo|in_progress|done`, `actualMinutes` credited by completed focus sessions), `FocusSession` (`focus|short_break|long_break`, logged only on completion), `DailyLog` (keyed by `date`, upsert), `Note`.

Conventions to keep following:
- Zero **runtime** deps; only `node:*` modules. TypeScript for server, vanilla JS in the browser. (Playwright becomes a **dev-only** dependency, see §4.)
- IDs = `crypto.randomUUID()`, timestamps = ISO strings, dates = `YYYY-MM-DD`.
- Each API route validates minimally, mutates `db`, calls `await db.persist()`, returns JSON via `json(res, data, status)`.
- Views re-render the whole container after every mutation and show a `showToast()`.
- Keyboard shortcuts are ignored while an `INPUT/TEXTAREA/SELECT` is focused.

### 0.2 Findings that affect this work

| # | Finding | Impact | Handling |
|---|---|---|---|
| F1 | **`npm test` writes to the real `data/database.json`.** `api.test.ts` boots the server on the `db` singleton with the default path. Verified: the suite added a task and a focus session to the live store. | Blocks any safe regression suite. | Phase 0: `HEYW_DATA_FILE` env + `createServer({ dataFile })`; all tests use temp dirs. |
| F2 | "Today" is computed with `toISOString().slice(0,10)` → **UTC date**. Streak, last-7-days, journal default date and `completedAt` bucketing all use UTC. | Wrong day for anyone not in UTC. | **Decided:** persist UTC, bucket in the user's time zone (§0.3). |
| F3 | `PUT` routes spread the raw body into the record (`id`, `createdAt` overwritable). | Contract hole. | **Accepted:** allow-listed fields per entity in Phase 0. |
| F4 | `Database.init()` seeds on *any* read/parse error (e.g. corrupt JSON) and silently overwrites. | Data-loss risk; generator must never trigger it. | Phase 0: distinguish "file missing" (seed) from "file unreadable" (refuse to start, keep the file). |
| F5 | Deterministic data is impossible via `db.createX()` (random IDs, `new Date()`). | Generator design. | Generator builds records directly (pure function), never through `createX`. |
| F6 | Browser automation: `chrome-headless-shell` (Chromium 141, Playwright revision 1194) exists at `/opt/pw-browsers`; Playwright 1.56.1 installs from the local npm cache. **Verified end-to-end** (keyboard shortcuts, modal, toast, timer tick, zero page errors). | Real-browser E2E is feasible. | **Adopted** as dev-only `test:ui` (§4). Note: `chrome-headless-shell` is the browser binary, not chromedriver; Playwright drives it over CDP directly, no WebDriver needed. |
| F7 | **Server binds to all interfaces and answers with `Access-Control-Allow-Origin: *`**, no auth. | Anyone on the LAN can read/modify everything via `/api/*`; any website open in the browser can call the API cross-origin. | **Phase 0 privacy hardening** (§7): bind `127.0.0.1` by default, drop CORS wildcard. |
| F8 | Data file written `0644`. | Readable by other accounts on a shared machine. | Phase 0: write with mode `0600`, `data/` dir `0700` (POSIX; no-op on Windows). |

### 0.3 Time model (decided)
- **At rest (server/JSON):** every instant is an ISO-8601 UTC string (`timestamp`, `createdAt`, `completedAt`, `capturedAt`). Unchanged.
- **Calendar fields** (`DailyLog.date`, summary `month`) are *user-calendar* values (`YYYY-MM-DD` / `YYYY-MM`), chosen by the client.
- **Bucketing** (which day/week/month an instant belongs to) is done **on the server in the user's IANA time zone**, supplied by the client: `?tz=Europe/Amsterdam` (from `Intl.DateTimeFormat().resolvedOptions().timeZone`). Server uses `Intl.DateTimeFormat` with `timeZone` — built into Node, zero deps. Missing/invalid `tz` → `UTC` (+ a warning header), so the API stays usable from curl.
- Affected endpoints: `/api/dashboard`, `/api/summary/*`; the client `API` wrapper adds `tz` automatically. A new `src/db/time.ts` (`dateInZone(iso, tz)`, `monthRange(month, tz)`, `weekStart(date)`) is the only place that knows about zones; unit-tested with fixed instants across DST boundaries.
- Generator/report accept `--tz` (default: system zone) so the printed expected figures match what the UI on that machine shows; the regression suite pins `tz=UTC` for goldens and adds one test in a non-UTC zone to prove bucketing shifts correctly.

---

## 1. Feature: Thought Capture ("Parking Lot")

### 1.1 Goal
While a focus session is running, capture a stray thought in one keystroke + Enter without leaving the view, opening a modal, or stopping the timer. Later, triage each thought: **turn into a task**, **keep for later**, or **discard**.

### 1.2 Data model (`src/db/database.ts`)

```ts
export type ThoughtStatus = 'inbox' | 'kept' | 'converted' | 'discarded';

export interface Thought {
  id: string;
  text: string;                 // required, trimmed, max 500 chars
  status: ThoughtStatus;        // new thoughts start in 'inbox'
  capturedAt: string;           // ISO UTC
  reviewedAt?: string;          // set when leaving 'inbox'
  context?: {
    view: string;               // 'today' | 'board' | ...
    timerRunning: boolean;
    timerType?: 'focus' | 'short_break' | 'long_break';
    taskId?: string; taskTitle?: string;   // task attached to the timer at capture time
  };
  taskId?: string;              // set when status === 'converted'
}
```
`DatabaseSchema` gains `thoughts: Thought[]` (loaded with `parsed.thoughts || []`; existing files stay valid).

**Discard semantics (decided):** `discarded` is a soft status; records are **never purged** by the app. Discarded thoughts leave the Inbox/Kept lists immediately and are only reachable through a collapsed *"Discarded (n)"* filter in the Inbox view, where a thought can be restored to Inbox. See **Q1** for the "one day" detail.

### 1.3 Database methods
`getThoughts(filters?: { status? })` (newest first) · `getThought(id)` · `createThought({ text, context? })` · `updateThought(id, { text?, status? })` (sets `reviewedAt` on leaving `inbox`) · `convertThoughtToTask(id, taskInput)` (uses existing `createTask`, marks `converted`, links `taskId`, returns `{ thought, task }`) · `getDashboardSummary()` gains `inboxCount`.
No `deleteThought` in the UI; the API keeps `DELETE /api/thoughts/:id` only for the generator's cleanup and tests.

### 1.4 API

| Method | Path | Body / Query | Response |
|---|---|---|---|
| GET | `/api/thoughts` | `?status=` | `Thought[]` |
| POST | `/api/thoughts` | `{ text, context? }` — 400 if empty/too long | `201 Thought` |
| PUT | `/api/thoughts/:id` | `{ text?, status? }` (allow-listed) | `Thought` / 404 |
| POST | `/api/thoughts/:id/convert` | `{ title?, priority?, status?, projectId?, estimatedMinutes? }` (title defaults to the text) | `201 { thought, task }` / 404 / 409 if already converted |
| DELETE | `/api/thoughts/:id` | — (tooling only) | `{ success }` / 404 |

### 1.5 UI
- **Capture bar (Focus view)** — one-line input under the timer controls, placeholder "Park a thought… (Enter)". Enter → POST, clear, toast "Parked", timer untouched. Not auto-focused so `Space` still toggles the timer. Shortcut **`P`** focuses it from anywhere: on other views a small non-modal bar slides in at the bottom; `Esc` dismisses.
- **Inbox view** (`public/js/views/inbox.js`, nav "Thought Inbox" under *Reflect*, key **`6`**, sidebar badge = `inboxCount`). Tabs *Inbox* / *Kept* / *Converted*, collapsed *Discarded*. Card: text, "captured 14:32 during Deep Focus on ‹task›" (local time), actions **→ Task** (pre-filled existing task modal), **Keep**, **Discard**; Kept also offers → Task / Discard; Discarded offers *Restore*.
- All new interactive elements get `data-testid` attributes for the UI suite.

### 1.6 Acceptance criteria
- Capturing while the timer runs never pauses/resets it and never steals `Space`.
- New thoughts appear newest-first with correct context; times shown in local zone.
- Convert creates exactly one task, links both ways; repeat → 409.
- Keep/Discard/Restore move status and set `reviewedAt`; discarded never shown in Inbox/Kept; nothing is ever deleted.
- Existing `database.json` without `thoughts` loads and persists.

---

## 2. Feature: Monthly Summary — "Book of Work" + Archive

### 2.1 Goal (decided: auto-generated only)
One auto-generated page per month bringing together **deep-work hours**, **accomplishments**, and **reflections** (journal intentions/retros/ratings). No user-authored fields. An **Archive** section lists every month that has data; each month can be viewed in-app and **downloaded as `.md`**.

### 2.2 Generation model (decided): live for the current month, frozen snapshots for closed months
- **Current month** is computed on demand (`GET /api/summary/monthly?month=`), always up to date.
- **Closed months** are frozen into `monthlySummaries` (schema already added in Phase 0: `{ id, month, timeZone, generatedAt, summary }`).
  - **Scheduler:** a `setTimeout` chain inside the server process fires at **00:00 UTC on the 1st** and freezes the month that just closed.
  - **Catch-up at start-up:** on `createServer()` every closed month that has data but no snapshot is frozen (covers the common case of the app not running at midnight).
  - **Zone used for freezing:** `settings.timeZone` (the last zone a client sent — added in Phase 0); UTC if none has been seen yet. The record stores the zone it was bucketed in.
  - Snapshots are never regenerated silently; a *Regenerate* action on the archive entry re-freezes on demand (e.g. after back-filling a journal entry).
- **Archive** lists frozen months (plus the live current month); each entry downloads as one `.md` — **no merged "all months" file** (decided).
- Determinism: same data + same `tz` ⇒ same summary and same Markdown, which is what the goldens pin.

### 2.3 Computation — `src/db/summary.ts` (pure, takes a `DatabaseSchema` + `month` + `tz`)

```ts
interface MonthlySummary {
  month: string; tz: string; from: string; to: string; daysInMonth: number; generatedAt: string;
  deepWork: {
    totalMinutes: number; totalHours: number;           // hours to 1 decimal
    sessions: number; avgSessionMinutes: number;
    activeDays: number; longestStreakDays: number;
    bestDay: { date: string; minutes: number } | null;
    byWeek: { weekStart: string; minutes: number; sessions: number }[];   // Monday-start weeks clipped to month
    byProject: { projectId: string | null; projectName: string; minutes: number }[];
    breakMinutes: number;
  };
  accomplishments: {
    tasksCompleted: number; byPriority: Record<TaskPriority, number>;
    byProject: { projectId: string | null; projectName: string;
                 tasks: { id; title; completedAt; estimatedMinutes; actualMinutes }[] }[];
    estimationAccuracy: { estimated: number; actual: number; ratio: number | null };
    tasksCreated: number; tasksStillOpen: number;
  };
  reflections: {
    journalDays: number; avgEnergy: number | null; avgFocus: number | null;
    ratingsByWeek: { weekStart: string; energy: number | null; focus: number | null }[];
    entries: { date: string; intentions: string[]; retro: string; energyRating; focusRating }[];
  };
  thoughts: { captured: number; converted: number; kept: number; discarded: number; pendingInbox: number };
  notes: { created: number; updated: number };
}
```
Rules: instants are bucketed with `tz` (§0.3); `DailyLog.date` is used as-is. Only `completed && type === 'focus'` sessions count as deep work. Empty month → zeros/nulls, never an error. Markdown rendering in `src/db/summary-markdown.ts` (server-side, so the same text is tested and served).

### 2.4 API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/summary/months?tz=` | `[{ month, frozen, generatedAt?, deepWorkMinutes, tasksCompleted }]` newest first — the archive index |
| GET | `/api/summary/monthly?month=YYYY-MM&tz=` | frozen snapshot when one exists, else live computation; default = current month in `tz`; 400 on bad format |
| GET | `/api/summary/monthly/:month.md` | `text/markdown; charset=utf-8`, `Content-Disposition: attachment; filename="heywork-book-of-work-YYYY-MM.md"` |
| POST | `/api/summary/monthly/:month/freeze` | (re)generate the snapshot for a closed month; 409 for the current month |

### 2.5 UI — `public/js/views/bookofwork.js` (nav "Book of Work" under *Reflect*, key **`7`**)
- Two panes like the Journal view: **left = the month page**, **right = Archive** (list of months with data, newest first, each with *View* and *⬇ .md*; current month marked "in progress").
- Month page: `‹ Month ›` navigator, stat boxes (Deep-work hours, Sessions, Active days, Tasks completed, Avg energy/focus), canvas chart (minutes per week via `CanvasCharts.drawBarChart`), sections *Accomplishments* (by project, est vs actual), *Deep work by project*, *Reflections* (retro excerpts by date), *Thoughts* funnel. Header button **⬇ Download .md** (links to the `.md` endpoint — plain browser download). Frozen months show "Frozen on ‹date›" with a *Regenerate* action; the live month shows "In progress".

### 2.6 Acceptance criteria
- Figures equal an independent computation over the same dataset and the committed golden snapshot for the generated dataset (tz = UTC), and shift correctly when `tz` changes.
- Empty month renders an honest empty state; invalid month → 400.
- `.md` endpoint is byte-deterministic for a given dataset+tz and downloads with the right filename.
- Archive lists exactly the months that have any data.

---

## 3. Tool: Deterministic Test-Data Generator

### 3.1 Goal
`npm run testdata -- seed` produces a realistic, **byte-for-byte reproducible** dataset across ~3 months; `… clean` removes exactly what was added and nothing else; `… report` prints the **validation report** with expected figures for pasting into a manual-test report.

### 3.2 Two modes — the safe one is the default (privacy, see §7)
- **`--fresh` (default):** writes a *standalone* store `data/test-database.json` containing only generated data and run the app against it with `npm run start:test` (= `HEYW_DATA_FILE=data/test-database.json npm start`). Your real `database.json` is never opened. `clean` just verifies and deletes that file (+ manifest).
- **`--into <file>`:** merges generated records into an existing store (for "test my real data + fixtures" scenarios). Backs up first, refuses on corrupt file or on `dailyLogs.date` collision with a user record (those days are skipped and listed). `clean --into` removes namespaced records, unlinks dangling references, verifies user records are byte-identical to the pre-seed snapshot, and deletes the backup only when verification passes.

### 3.3 Location & commands
- Source: `src/tools/testdata/` → `generator.ts` (pure), `cli.ts`, `content.ts` (word lists), `prng.ts`.
- Scripts: `testdata`, `testdata:seed`, `testdata:clean`, `testdata:status`, `testdata:report`, `start:test`.
- Options: `--seed <int>` (default `20240101`), `--anchor <YYYY-MM-DD|today>` (default fixed `2025-03-31`), `--tz <IANA>` (default system), `--profile small|standard|large`, `--json`, `--into <file>`, `--force`, `--yes`.

### 3.4 Determinism
- Seeded PRNG (`mulberry32`); no `Date.now()`, no `randomUUID()`.
- IDs: `7e57da7a-<sha256(seed:kind:index) sliced>` in valid UUID shape; the fixed first block is the **test-data namespace** used by cleanup and `status`.
- `generateDataset({ seed, anchor, profile }): { data: DatabaseSchema, manifest }` is pure; tests import it. Same inputs ⇒ identical JSON (hash pinned in `fixtures/dataset.sha256`).

### 3.5 Dataset content (`standard` profile, ≈ 90 days ending at anchor)
| Collection | Volume | Deliberate edge cases |
|---|---|---|
| projects | 4 (+1 archived) | a project with no tasks |
| tasks | ~60 | all statuses/priorities; completions spread over days with weekend gaps; no-project task; task over estimate; future due date; tags include `testdata` |
| focusSessions | ~180 | weekday-heavy; breaks; one `completed:false` (must not count); task-attached so `actualMinutes` sums reconcile; a few sessions placed at 23:30 UTC to exercise tz bucketing |
| dailyLogs | ~65 | ~70% of days; one with empty retro; ratings spread 1–5 |
| notes | 12 | 2 pinned; one updated long after creation |
| thoughts | ~30 | all four statuses; one converted with `taskId` linking to a generated task; captured in/out of focus |
| Months covered | anchor month, −1, −2 | month −3 has **zero** data (empty state) |

### 3.6 Validation report (stdout, Markdown; `--json` for machines)
```
# HeyWork test data — seed 20240101 · anchor 2025-03-31 · profile standard · tz Europe/Amsterdam
dataset-sha256: 3f1c…  (stable across runs)
| Collection | Count | …
## Expected figures (what the Book of Work must show)
| Month   | Deep-work h | Sessions | Active days | Tasks done | Journal days | Avg energy | Avg focus | Thoughts captured/converted/kept/discarded |
| 2025-03 | 24.6        | 59       | 21          | 23         | 20           | 3.6        | 3.8       | 12 / 4 / 3 / 2 |
…
## Dashboard on anchor day   focusTodayMinutes=75  completedToday=2  streak=6  inboxCount=7
## Spot checks   task "…" actualMinutes=125 · project "…" 4 open tasks · archive lists 3 months
```
Figures are produced by the same `getMonthlySummary()` the app uses **and** re-derived independently in the regression suite, so report, UI and tests cross-check each other.

---

## 4. End-to-End Regression Suite

### 4.1 Three layers, all zero runtime deps
| Layer | Runner | Dependency | Script |
|---|---|---|---|
| Unit (db, summary, time, generator) | `node:test` | none | `npm test` |
| API/E2E over HTTP (real compiled server, temp data file seeded by the generator) | `node:test` + `fetch` | none | `npm run test:e2e` |
| **UI in a real browser** (`chrome-headless-shell` via Playwright, against the same server) | `node:test` + `playwright` | **dev-only** `playwright@1.56.x` (matches the installed browser revision 1194); `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` | `npm run test:ui` |
`npm run test:all` runs all three. `test:ui` skips cleanly with a message if Playwright or the browser is absent, so the core suite never depends on it.

### 4.2 Layout
```
src/test/
  helpers/testServer.ts      boot server on port 0 with temp HEYW_DATA_FILE; fetch client; teardown
  helpers/expectations.ts    independent re-computation of monthly figures from a dataset (no app code)
  helpers/browser.ts         launch chrome-headless-shell, page factory, console/pageerror capture, screenshots on failure
  unit/   database, summary, time, thoughts, generator
  api/    api (existing, moved), thoughts.api, summary.api
  e2e/    regression.*.test.ts  (R01–R11)
  ui/     ui.*.test.ts          (U01–U06)
  fixtures/ monthly-summary.golden.json, monthly-summary.golden.md, dataset.sha256
```
`test:update-golden` regenerates fixtures deliberately; otherwise drift fails the run.

### 4.3 HTTP-level regression scenarios
| ID | Scenario | Checks |
|---|---|---|
| R01 | Boot & static | `/` serves `index.html`; every `<script src>` resolves 200 with JS MIME; unknown `/api/*` → 404 JSON; unknown page → SPA fallback; **no CORS wildcard header**; server bound to loopback only. |
| R02 | Fresh install | empty temp dir → welcome seed present; file created with mode 0600. |
| R03 | Persistence | create → close server → reopen same file → intact. Corrupt file → server refuses to start, file untouched. |
| R04 | Existing CRUD | projects, tasks (reorder, done → `completedAt`), focus credit, daily log upsert, notes search/pin; PUT ignores non-allow-listed fields. |
| R05 | Thought flow | capture with context → inbox order → convert (409 on repeat) → keep → discard → restore; never deleted; `inboxCount` tracks. |
| R06 | Monthly summary vs generator | each seeded month deep-equals independent expectations + golden JSON (tz=UTC); month −3 all-zero; bad month → 400; `.md` equals golden; `tz=Pacific/Auckland` moves the 23:30 UTC sessions to the next day. |
| R07 | Archive index | months listed = months with data, newest first, flags current month. |
| R08 | Generator determinism | two `generateDataset()` calls equal; sha256 matches fixture; two CLI `seed` runs byte-identical. |
| R09 | Seed → clean round-trip (`--into`) | user records byte-identical after clean; references unlinked; second clean no-op; refuses corrupt/collision without `--force`; fresh mode creates/deletes only `test-database.json`. |
| R10 | Isolation guard | whole suite leaves `data/database.json` hash unchanged. |
| R11 | Backward compatibility | file lacking `thoughts` loads and persists with the collection added. |

### 4.4 Browser UI scenarios (Playwright, seeded store, `tz` = browser zone)
| ID | Scenario |
|---|---|
| U01 | Smoke: every view renders via keys `1`–`7`, no console errors, light/dark toggle `T`. |
| U02 | Capture during focus: `Space` starts timer → type thought + Enter → timer still counting, toast shown, input cleared → `P` from the Board view opens the mini bar → Inbox badge increments. |
| U03 | Triage: Inbox shows newest first → *→ Task* pre-fills modal → task appears on Board → *Keep* → *Discard* → card disappears → *Discarded* filter shows it → *Restore*. |
| U04 | Book of Work: anchor month shows the report's figures (hours, sessions, tasks done) → navigator to an empty month shows the empty state → Archive lists 3 months → clicking *⬇ .md* downloads a file whose content equals the API `.md`. |
| U05 | Journal/Today regression: journal save round-trip, task checkbox completes, dashboard metrics update. |
| U06 | Time zone: with browser zone `Pacific/Auckland` (Playwright `timezoneId`), the 23:30 UTC sessions appear on the following day in Insights/Book of Work. |
Failures save a screenshot + console log under `test-results/`.

### 4.5 Manual checklist — `docs/manual-test-checklist.md`
Seed (fresh) → `start:test` → walk each view ticking figures from the validation report → capture/triage thoughts → download `.md` → `clean`. Written so it can be pasted into a validation report.

---

## 5. Phasing & deliverables

| Phase | Work | Exit criterion |
|---|---|---|
| **0 — Foundation & hardening** ✅ | `HEYW_DATA_FILE` + `createServer({ dataFile })`; tests isolated; `thoughts` / `monthlySummaries` / `settings` collections; `time.ts` + `tz` plumbing on dashboard; allow-listed PUTs; corrupt-file refusal (F4); **bind 127.0.0.1 + remove CORS wildcard (F7)**; **file mode 0600 (F8)**; codec seam; test folder restructure; Playwright dev-dep + `helpers/browser.ts` + U01 smoke; isolation guard runner. | **Met:** `npm run test:all` green (33 tests), guard confirms `data/database.json` untouched. |
| **0.5 — Durability & timer** ✅ | Rotating backups + restore (CLI & API); server-authoritative timer engine, background worker, mini countdown, pop-out window, zen dimming, `S` soundscape cycle. | **Met:** §9. |
| **1 — Thought capture** ✅ | DB methods, API, capture bar, `P` shortcut, Inbox view (+Discarded filter/restore), badge, CSS, `data-testid`s; unit + API + E2E + UI tests. | **Met:** §1.6 verified by 5 unit, 5 API, 2 E2E and 3 browser tests. |
| **2 — Book of Work + Archive** ✅ | `summary.ts`, `summary-markdown.ts`, `bookofwork.ts` (freeze, catch-up, scheduler), months index, `.md` endpoint, regenerate endpoint, view with archive pane, chart; 15 unit, 3 API, 2 browser tests incl. a real download. | **Met:** §2.6 verified; see §11. |
| **3 — Generator** ✅ | PRNG, content, pure generator, validation report, CLI (seed/clean/status/report; fresh + into), manifest, pre-seed backup, scripts. | **Met:** report prints; fresh and into round-trips verified by R08/R09; §12. |
| **4 — Regression suite & docs** ✅ | goldens (`dataset.sha256`, `monthly-summary.golden.json/.md`), R01–R11 across e2e/api/unit, U01–U06 in a real browser incl. report-vs-UI cross-check, manual checklist, README. | **Met:** `npm run test:all` green (112 tests); goldens committed. |

Order rationale: 0 unblocks safe testing and closes the privacy gaps first; 1–2 settle the schema the generator must produce; 3 enables manual testing and feeds 4.

---

## 6. Decisions log

| # | Question | Decision |
|---|---|---|
| Q1 | Discard semantics | Permanent soft-hide, never purged, restorable from a collapsed *Discarded* filter. |
| Q2 | On demand vs snapshots | Both: live current month; closed months frozen automatically at 00:00 UTC on the 1st or at server start-up (§2.2). |
| Q3 | Download all months | No. Per-month `.md` only, no merged file. |
| Q4 | Privacy | A (loopback), B (no CORS), C (0600) done in Phase 0. D (encryption at rest) parked; `StorageCodec` seam ready. |
| Q5 | Generator default | Standalone `data/test-database.json`; merge only with explicit `--into`. |
| Q6 | Playwright | devDependency `playwright@^1.56.1`; `test:ui` self-skips without a browser. |
| Time | UTC at rest; user zone on the client; server buckets with the client's `?tz=`. |

## 7. Privacy assessment of the single JSON data file

Your instinct is right to look at this, but the **file format is the smallest part of the risk**. Ranked by what actually exposes your data today:

| Rank | Exposure | Today | Fix | Cost |
|---|---|---|---|---|
| 1 | **Network**: server listens on all interfaces with no auth; CORS `*` lets any website you visit call `http://localhost:3000/api/*` from JavaScript. | Open | **A.** Bind `127.0.0.1` by default (`HOST` env to opt into LAN). **B.** Remove the CORS headers entirely (the SPA is same-origin; nothing needs them). Optionally require a `Sec-Fetch-Site: same-origin`/`Origin` check on mutating requests as belt-and-braces. | Tiny; Phase 0 |
| 2 | **Other accounts on the same machine**: file is `0644`. | Open | **C.** Write temp + final file with mode `0600`; create `data/` with `0700`. | Tiny; Phase 0 |
| 3 | **Synced/backup folders**: if `data/` sits in Dropbox/iCloud/OneDrive or a backup set, the plaintext leaves the machine. | Depends on where you run it | Document it; `HEYW_DATA_FILE` lets you point at a location of your choosing; generator backups live under `data/backups/` and are removed on `clean`. | Docs |
| 4 | **Plaintext at rest** (theft, malware, forensic access). | Open | **D.** Optional encryption: AES-256-GCM with a key derived from a passphrase via `scrypt` (both in `node:crypto`, zero deps). Passphrase from `HEYW_PASSPHRASE` env or a prompt at start. Costs: you must enter it each start; a lost passphrase = lost data; the file is no longer human-readable (so add an *Export plain JSON/Markdown* action). Full-disk encryption (FileVault/BitLocker/LUKS) gives most of this benefit for free. | Moderate; recommend parking (Q4) |
| 5 | **Derived copies**: monthly snapshots, caches, logs. | None today | Keep summaries computed on demand (§2.2); never log request bodies; test stores live in temp dirs. | Design choice |

**Verdict on the format:** a single local JSON file is a good fit for a personal, local-first tool — it is inspectable, trivially backed up, exported, diffed, and owned by you; the atomic temp-file+rename write already protects against corruption; and at personal scale (a few MB for years of use) the whole-file rewrite is a non-issue. What it is *not* is a security boundary — that comes from items 1–2 (closing now), 3 (your file placement), and 4 (optional). The alternatives (SQLite via `node:sqlite` — still experimental in Node 22 — or an external DB) would add a dependency without fixing any of 1–4.

---

## 8. Phase 0 log (done)

**Server / data layer**
- `src/db/time.ts` (new): zone-aware bucketing on `Intl.DateTimeFormat` only (`dateInZone`, `todayInZone`, `addDays`, `daysInMonth`, validators). Tested across DST and date-line cases.
- `src/db/database.ts`: schema gains `thoughts`, `monthlySummaries`, `settings` (older files load and are upgraded on next persist); `normaliseSchema()` rejects non-HeyWork shapes; `init()` distinguishes *missing* (seed) from *unreadable/corrupt* (throw `DatabaseFileError`, file untouched); `persist()` writes `0600` and cleans its temp file on failure; `StorageCodec` seam (`jsonCodec` default) for future encryption; `useFile()` for re-targeting the singleton; `rememberTimeZone()`; `getDashboardSummary(tz, now)` buckets in the caller's zone and exposes `timeZone` + `inboxCount`.
- `src/server/router.ts`: CORS wildcard removed; `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`; mutating requests with a foreign `Origin` or `Sec-Fetch-Site: cross-site` → 403.
- `src/server.ts`: `createServer({ dataFile })`, `HEYW_DATA_FILE`, `HOST` (default `127.0.0.1`), refuses to start on a corrupt store (exit 2) with a clear message; banner shows bind address and data file.
- `src/routes/api.ts`: `?tz=` on `/api/dashboard` (invalid zone → UTC + `X-HeyWork-Warning`; valid zone remembered in settings); PUT allow-lists for projects/tasks/notes with enum/type validation (400).

**Client**
- `api.js`: `API.timeZone` (browser IANA zone) sent with the dashboard request.
- `utils.js`: `localDateStr()`; `journal.js` defaults to the local date instead of UTC.
- `app.js`: the documented `T` theme shortcut was never bound — now it is.

**Tests & tooling**
- `src/test/helpers/testServer.ts` (isolated temp store per test), `helpers/browser.ts` (Playwright launcher with self-skip + failure artefacts).
- `unit/` (time, storage, database), `api/` (contract, hardening, privacy), `e2e/` (R01 boot & static, R02 fresh install, R03 persistence + corrupt refusal, R11 legacy upgrade), `ui/` (U01 smoke incl. tz propagation and local journal date).
- `scripts/test-all.mjs`: runs the pyramid and enforces the isolation guard (R10).
- `package.json`: `test`, `test:e2e`, `test:ui`, `test:all`, `start:test`; `playwright` devDependency. `.gitignore` adds `test-results/`.
- README: configuration table, privacy section, testing pyramid, updated structure.

**Not changed on purpose:** the welcome seed's `today` still uses UTC (no client zone is known on first run); the journal's seed log date therefore may be off by one for users far from UTC on the very first day only.

---

## 9. Phase 0.5 log — durability & the focus timer (done)

Raised during review: the store had no backups, and the timer lost work.

**Local backups** (`src/db/backup.ts`, `src/tools/backup-cli.ts`, `/api/backups`)
- Copies into `data/backups/` at start-up, every 30 minutes of activity, and on demand; skipped when the store is byte-identical to the newest copy; pruned to `keepPerDay × keepDays` with a global cap; written `0600`.
- `restore` validates the backup parses as a HeyWork store, snapshots the current file as `pre-restore` first, then swaps atomically — so a mistaken restore is itself reversible. Refuses corrupt or foreign files.
- CLI: `npm run backup -- list | create | restore <latest|name>`.

**Server-authoritative timer** (`src/db/timer.ts`, `src/server/jobs.ts`, `/api/timer/*`)
- The active block lives in the store (`activeTimer`), so reloads, navigation and crashes no longer lose it.
- Four recorded endings: `completed`, `stopped`, `switched` (the old silent reset now banks the elapsed minutes), `abandoned`.
- Background worker (unref'd, 5 s) completes blocks with no browser open and settles stale timers; `createServer()` runs a catch-up tick at start-up.
- Presence policy: blocks are credited only for time a client reported in for; `HEYW_TIMER_TRUST_SILENCE=1` relaxes this, and either way the silent tail is recorded as `integrity.unverifiedMs`.
- `FocusSession` gained `plannedMinutes`, `endReason`, `endedAt`, `integrity` (`awayMs`, `distractions`, `appInteractions`, `unverifiedMs`). Task time is now credited for partial blocks, and deep-work totals count real elapsed focus minutes rather than only finished blocks.
- Blocks under a minute are dropped rather than logged as noise.

**Client** — `public/js/timer.js` (shared by the app shell and the pop-out), mini countdown bottom-right on every view except Focus, `/timer.html` pop-out (Document PiP with a popup fallback) that heartbeats on its own, gentle zen dimming while focusing, `S` cycles soundscapes.

**On "deep focus is not deep focus if you are tinkering with the app"** — the app cannot know whether you are working, so it does not pretend to. Instead it (a) gets out of the way (zen dimming, pop-out so HeyWork can be closed, capture that never interrupts), and (b) records attention honestly: time away from the window, how often you left, how many clicks/keys you spent *inside HeyWork*, and unverified stretches. Those numbers feed the Book of Work in Phase 2 as "flow integrity" rather than a nagging score. Open to going further (e.g. a strict mode that ends a block after N interactions) if you want it.

**Bugs found and fixed while building** — the ticking timer re-rendered the Focus view over whatever page you had navigated to (caught by a screenshot check, now pinned by a test); a re-render could swallow a thought mid-typing (caught by a UI test; drafts and the caret now survive repaints); backups taken in the same second sorted by name, so dedupe compared against the wrong file.

## 10. Phase 1 log — thought capture (done)

- `Thought` model + store methods (`getThoughts`, `createThought`, `updateThought`, `convertThoughtToTask`, `countThoughts`); discarding is a status change and nothing is ever deleted through the UI.
- API: `GET/POST /api/thoughts`, `PUT /api/thoughts/:id`, `POST /api/thoughts/:id/convert` (409 when already converted), `DELETE` reserved for tooling. Context is sanitised server-side and the task title resolved from the live task.
- UI: always-present capture field in the focus card; global capture bar on `P` (Enter saves, Esc dismisses, click-away closes); Inbox view at key `6` with Inbox / Kept / Became tasks / Discarded tabs, restore, and a sidebar badge of waiting thoughts.
- `inboxCount` added to the dashboard.

## 11. Phase 2 log — Book of Work (done)

- `src/db/summary.ts`: pure `computeMonthlySummary(data, month, tz, { now })` — deep work (totals, completed blocks, best day, longest streak, Monday-start weeks clipped to the month, by project, by day, breaks), **flow integrity** (uninterrupted blocks, away time, departures, app interactions, unverified time, endings), accomplishments (by priority/project, estimate vs actual, created/still open), reflections (journal days, averages, ratings by week, entries), thoughts funnel, notes. Zero-minute sessions and breaks are excluded from deep work.
- `src/db/summary-markdown.ts`: deterministic Markdown renderer (no locale formatting).
- `src/db/bookofwork.ts`: live page for the current month; frozen snapshot for closed months; `freezeClosedMonths` catch-up; `nextFreezeInstant` = min(next 00:00 UTC on the 1st, next local month rollover in the remembered zone) so zones behind UTC are frozen correctly too. Freeze uses `settings.timeZone` (last client zone) and records it.
- Scheduler in `jobs.ts` (unref'd `setTimeout` chain, capped at 20 days per hop); `createServer()` runs the catch-up at start-up.
- API: `GET /api/summary/months`, `GET /api/summary/monthly?month=&tz=`, `GET /api/summary/monthly/:month.md` (attachment), `POST /api/summary/monthly/:month/freeze` (409 for the live month).
- UI: key `7`, month navigator, stat boxes, per-week canvas chart, sections, archive pane with per-month `⬇` download, *Regenerate* on frozen months. No merged "all months" file (decided).

**Timer follow-up (from review):** tab clicks are now a passive selection — the running block continues, the selected tab is "armed", the running tab shows a ● marker, and the button reads *Start ‹block›*; only that click records the running block (`switched`) and starts the new one.

## 12. Phase 3 & 4 log — generator, goldens, regression (done)

**Generator** (`src/tools/testdata/`)
- `prng.ts`: mulberry32; ids `7e57da7a-<sha256(seed:kind:index)>` in UUID shape — the namespace is what `clean` and `status` recognise.
- `content.ts`: fixed vocabulary (projects, task titles, thoughts, intentions, retros, notes).
- `generator.ts`: pure `generateDataset({ seed, anchor, profile, tz })` → `{ data, manifest }`. Standard profile: 90 days to `2025-03-31`, 5 projects (1 archived, no tasks), 50 tasks, ~300 sessions with a weekday rhythm and breaks, 63 journal days, 12 notes, 30 thoughts. Edge cases: over-estimate task, no-project task, future due date, stopped-early 12-minute block, two 23:30 UTC blocks, converted thought linked to a generated task, a note edited long after creation, an empty retro, legacy blocks without attention signals, and an empty month (2024-11). Task `actualMinutes` reconcile with the blocks logged against them.
- `report.ts`: validation report built with the app's own summary/dashboard code; Markdown and `--json`.
- `cli.ts`: `seed | clean | status | report`; **fresh mode** (default) writes `data/test-database.json` + manifest and never opens the real store; **`--into`** merges after a `pre-seed` backup, skips journal-day collisions, refuses corrupt stores and double seeding; `clean --into` strips by namespace, unlinks dangling references (tasks→project, sessions/thoughts/timer→task), drops Book-of-Work snapshots frozen while test data was present, and verifies the user's collections hash-identical (exit 3 when they differ).
- Backups are now named after their store (`test-database-…` vs `database-…`) so a test store sharing `data/backups/` can never touch the real store's retention; fresh `clean` removes its own backups.

**Goldens & regression**
- `scripts/update-goldens.mjs` (`npm run test:update-golden`) pins `dataset.sha256`, `monthly-summary.golden.json` (every month + the empty one, UTC) and `monthly-summary.golden.md`.
- Scenario coverage: R01 boot/static, R02 fresh install, R03 persistence/corrupt refusal, R04 CRUD + hardening (api), R05 thought journey, R06 summaries vs goldens + tz shift (unit/api), R07 archive index, R08 determinism, R09 seed→clean (fresh + into + unlink), R10 isolation guard (runner), R11 legacy upgrade; U01 smoke, U02 timer, U03 sounds, U04 capture/triage, U05 Book of Work incl. download and **report-vs-UI cross-check on the generated dataset**, U06 in-app dialogs.
- `docs/manual-test-checklist.md` walks the seeded app view by view with blanks for the report's figures.

**Review follow-ups folded in:** no marker dot — the focus card is a plain launcher (static 25:00/05:00/15:00), the running block lives in the corner countdown on every screen; `window.confirm()` replaced by the app modal everywhere (`showConfirm`, `Esc`/cancel/confirm, danger styling).

## 13. Optional follow-ups (not started)

- Encryption at rest via the `StorageCodec` seam (`HEYW_PASSPHRASE`, AES-256-GCM + scrypt) plus a plain export action.
- A strict focus mode (end a block after N in-app interactions) if the flow-integrity figures turn out to be useful.
- UI entry point for backups (list/restore) — currently CLI + API only.
- Mobile layout pass for the mini timer and capture bar.

## 14. Review round — timer card and date-centric data (done)

**Timer card.** The card now follows the *running* block by default and ticks; that tab shows **Pause/Resume · Stop · Reset** (never "Start Flow"). Any other tab shows its static length with an explicit **Start ‹block›** button — the only action that records the running block and switches. *Reset* restarts the same block (the elapsed part is recorded as `stopped`; `POST /api/timer/start` accepts `replaceReason`). The corner countdown stays on every view.

**Date-centric generator.** The dataset is "the world as of a date" (anchor = today by default): the three full months before the current month (profile `standard`; `small` = 0, `large` = 12) plus the current month from the 1st to the anchor day. Every day's records come from `hash(seed, date)`, so a past day's data never changes and running again tomorrow only adds tomorrow (pinned by a test generating "as of" 31 March, 15 April and 20 May and comparing the overlaps). Cross-day state is fixed at task creation (`doneOn`), with a 45-day warm-up before the range so the task pool at the start of the range does not depend on where the range starts; warm-up tasks are kept only when the range refers to them or they finish inside it. A subtle bug found while proving this — the completion time of day was only drawn when the task was already done by the anchor — is exactly the class of anchor-dependence the test guards against. Goldens are pinned to anchor `2025-03-31`; the CLI and report describe "as of today" and flag the month in progress.
