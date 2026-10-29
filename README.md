# 🌿 HeyWork (`heyw`)

> A calm, local-first personal work, focus & journaling OS built with TypeScript. Zero external runtime dependencies, 100% offline, privacy-first.

---

## 🍃 Philosophy

Modern productivity tools are often noisy, bloated, and cloud-dependent. **HeyWork** is designed around a different set of principles:

- **Calm, Human Aesthetic:** Warm editorial typography and soothing stone/slate palettes. No blinding neon, no cyberpunk glare, no distracting clutter.
- **Zero Runtime Dependencies:** Powered entirely by Node.js built-in modules (`node:http`, `node:fs`, `node:crypto`, `node:path`). No external server framework, no database service required.
- **Local-First & Offline:** Your data belongs to you, persisted safely in local JSON storage (`data/database.json`).
- **Zero-Asset Web Audio Synthesizer:** Built-in ambient focus sounds (Gentle Rain, Brown Noise, White Noise, and Solfeggio 528Hz Meditation Chime) generated live via the Web Audio API—no external MP3/WAV files needed.
- **Fully Testable Out of the Box:** Comprehensive unit and integration test suite runnable in under a second using Node.js's native test runner (`node:test`).

---

## ✨ Features

### ⏳ Flow & Focus Engine
- **Server-Owned Timer:** the countdown lives in the store, not the tab. Reload, navigate, or close the window — the block keeps running and is always recorded.
- **Nothing Is Lost:** every ending is written down — `completed`, `stopped`, `switched` (changing Deep Focus → Break banks the minutes already done) and `abandoned` (no client heartbeat; credited only up to the last sign of life).
- **Background Worker:** finishes a block at its planned end even with no browser open, and settles timers left behind by a crash or a sleeping laptop at start-up.
- **Mini Countdown & Pop-out:** a small timer follows you across views, and `⧉ Pop out` opens a tiny always-visible window (Document Picture-in-Picture when available) that keeps the block alive on its own — so you can close HeyWork and actually work.
- **Gentle Zen Mode:** a running focus block dims the navigation until you hover it.
- **Customizable Sessions:** 25-minute Deep Focus, 5-minute Short Breaks, and 15-minute Rest periods.
- **Task Association:** Attach focus blocks directly to active tasks to automatically track actual vs. estimated minutes — partial blocks count too.
- **Procedural Soundscape Generator:** Live Web Audio ambient noise generators (Rain, Brown noise, White noise) with gentle filtering and harmonic completion chimes. Tap `S` to cycle through them.
- **Keyboard-Controlled:** Tap `Space` to start/pause focus flow instantly.

### 🧠 Thought Inbox (capture without breaking flow)
- **One Keystroke:** park a stray thought from the Focus view, or press `P` anywhere — type, hit Enter, carry on. No modal, no navigation, the timer never pauses.
- **Context Kept:** each thought remembers when it was captured, which block was running and which task you were on.
- **Three Decisions:** turn it into a task (pre-filled and linked), keep it for later, or discard it.
- **Discard ≠ Delete:** discarded thoughts simply leave your sight; they stay in the store and can be restored any time.

### 📋 Task & Sprint Kanban
- **Four-Stage Workflow:** Backlog, To Do, In Progress, and Completed.
- **Priority Badging:** Urgent (amber/red), High (orange), Medium (blue), and Low (slate).
- **Time Auditing:** Automatic tracking of estimated vs actual minutes spent in focus mode.
- **Frictionless Quick-Add:** Create, update, transition, and delete tasks in seconds.

### 📖 Mindful Daily Journal & Retrospectives
- **Morning Intentions:** Define your Top 3 non-negotiable missions each morning.
- **Evening Retrospective:** Reflect on what went well, key lessons learned, and friction points.
- **Energy & Focus Ratings:** Track daily energy (1–5 ⚡) and focus (1–5 🎯) to discover your natural productivity rhythm.
- **Historical Timeline:** Review past daily entries with date-based navigation.

### 📝 Scratchpad & Notes
- **Instant Thought Capture:** Markdown-friendly notes for scratchpad ideas, meeting minutes, and guidelines.
- **Instant Search:** Type-ahead search across note titles and content.
- **Pinning:** Keep critical reference docs pinned to the top.

### ◎ Connected Thinking (notes ⇄ tasks ⇄ thoughts)
- **`[[wiki]]` mentions:** type `[[` in a note, a task description or a thought and pick from the popover — `[[task:Send invoice]]`, `[[note:Pricing]]`, `[[thought:Ask Dana about…]]` (or just `[[Title]]`, resolved note → task → thought; `\[[` escapes). Mentions are *derived from the text* every time — nothing is duplicated on disk, the text is the link.
- **"Link to…":** an explicit link when there is no prose to put it in. Links remember both titles, so they outlive the deletion of either end (shown struck through, never silently dropped).
- **Rename-safe:** renaming a note or task rewrites the `[[mentions]]` that pointed at it and tells you how many.
- **Connections panel:** on every note, task and thought — what it mentions, what mentions it, what it is linked to, which thought it *became* and what was being worked on when a thought was captured. Unresolved mentions offer to create the note.
- **Local graph (`8`):** the item in the centre, what it touches around it, and what those touch in turn — **one month at a time** by design, so the graph stays light. Only items active in the month are drawn (edited, completed, focused on, captured, or linked that month); direct connections that were quiet are counted and one click away (*Show N quiet*). With no item chosen (sidebar, `8`), the view lands on the most connected item active in that month and keeps re-suggesting as you step months; an item you arrived at through a chip, a card's ◎ or a click is **pinned** (it says so, and stays in the centre across months) until you *release* it or navigate to Connections afresh. Deterministic rings, no physics, nothing animates in the background. Click to re-centre, double-click to open.
- **Deep links:** `#notes/<id>`, `#board/<taskId>`, `#inbox/<thoughtId>`, `#connections/<type>/<id>`.

### 📘 Book of Work (monthly summaries)
- **Auto-generated, one page per month:** deep-work hours (by week and by project, best day, longest streak), flow integrity, accomplishments grouped by project with estimate vs. actual, journal reflections with energy/focus averages, and the thought-capture funnel.
- **Live this month, frozen afterwards:** the month in progress is computed on the fly; at **00:00 UTC on the 1st** (or when the server next starts) the month that closed is frozen into the archive. Frozen pages never change silently — *Regenerate* re-freezes on demand after back-filling.
- **Archive & download:** every month is listed on the right and downloadable as a Markdown file (`heywork-book-of-work-YYYY-MM.md`).
- **Bucketed in your time zone:** the browser's zone is used for the live page, and the last-seen zone for automatic freezing.

### 📊 Canvas Visual Analytics
- **Zero-Library Canvas Charts:** Custom HTML5 Canvas bar charts rendering weekly focus time (minutes per day).
- **Consistency Streaks:** Automatic tracking of consecutive active days.
- **Session Audit Table:** Detailed log of completed sessions, timestamps, durations, and attached tasks.

### 🎨 Calm Design System
- **Dual Themes:** Clean, warm paper-toned Light Mode and soothing graphite/slate Dark Mode (toggle with `T`).
- **Responsive Layout:** Works smoothly on desktop workstations and mobile screens.

---

## 🏗 Architecture

```
┌─────────────────────────────────┐       ┌─────────────────────────────────┐       ┌──────────────────────┐
│  Browser Single Page App (SPA)  │──────>│     Node.js Native HTTP Server  │──────>│   Local JSON Storage │
│  Vanilla JS + Web Audio + Canvas│<──────│     Custom Pattern Router       │<──────│   data/database.json │
└─────────────────────────────────┘       └─────────────────────────────────┘       └──────────────────────┘
       │                                                 │
       ├─ public/js/sound.js (Web Audio Synth)           ├─ src/server/router.ts (HTTP Router)
       ├─ public/js/utils.js (Canvas Charts & Toasts)    ├─ src/routes/api.ts (REST Endpoints)
       ├─ public/js/views/today.js (Focus Mode)          └─ src/db/database.ts (Local Engine)
       ├─ public/js/views/board.js (Kanban Board)
       ├─ public/js/views/journal.js (Daily Retro)
       ├─ public/js/views/notes.js (Scratchpad)          ├─ src/db/links.ts (wiki mentions, pure)
       ├─ public/js/links.js ([[ autocomplete, panel)      └─ src/db/graph.ts (local graph, pure)
       └─ public/js/views/connections.js (SVG graph)
```

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** >= 18.0.0 (tested on v24)
- **npm** >= 9.0.0

### Backup & restore

```bash
npm run backup -- list              # what is available
npm run backup -- create            # take one now
npm run backup -- restore latest    # recover after a bad edit
```

### Installation & Run

```bash
# Clone or navigate to the directory
cd heyw

# Install dev dependencies (just TypeScript compiler and Node types)
npm install

# Compile TypeScript backend
npm run build

# Start the application
npm start
```

Open your browser at **http://localhost:3000** to start your first focus session.

### Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address. The default is **loopback only** so nothing on your network can reach your data. Set `0.0.0.0` deliberately if you want LAN access. |
| `HEYW_DATA_FILE` | `./data/database.json` | Location of the JSON store. Point it anywhere you like (e.g. outside a cloud-synced folder). |
| `HEYW_BACKUP_DIR` | `<data dir>/backups` | Where rotating backups are written. |
| `HEYW_BACKUP_DISABLE` | – | Set to `1` to turn backups off entirely. |
| `HEYW_BACKUP_INTERVAL_MS` | `1800000` | Minimum gap between automatic backups. |
| `HEYW_BACKUP_KEEP_PER_DAY` / `HEYW_BACKUP_KEEP_DAYS` / `HEYW_BACKUP_MAX` | `3` / `7` / `40` | Retention policy. |
| `HEYW_TIMER_TRUST_SILENCE` | – | Set to `1` to let a block finish even when no window is open (the unverified stretch is still recorded on the session). |
| `HEYW_TIMER_STALE_MS` | `90000` | How long a block may go without a heartbeat before it is considered abandoned. |

---

## 🔒 Privacy & Data Safety

- **Your data is one file:** `data/database.json` (or `HEYW_DATA_FILE`). Plain JSON — inspectable, backup-able, yours. It is written atomically (temp file + rename) and created **owner-only (`0600`)** so other accounts on a shared machine cannot read it.
- **Connections live in the same file:** explicit links are a `links` array next to your notes and tasks; `[[mentions]]` are nothing but your own text, resolved on the fly. A store from before this feature loads unchanged (no migration); note that an *older* HeyWork opening a newer file would drop the `links` array when it next saves.
- **Loopback only:** the server listens on `127.0.0.1` unless you set `HOST`. No CORS headers are emitted, so a website open in another tab cannot read the API; cross-origin writes are refused outright (`403`).
- **Never overwrites on error:** if the data file exists but cannot be parsed, HeyWork refuses to start (exit code 2) and leaves the file untouched instead of re-seeding over it.
- **Rotating local backups:** a copy of the store is taken at every start-up and every 30 minutes of activity into `data/backups/` (0600, de-duplicated, pruned to the last few per day for a week). Recover from a bad manual edit with `npm run backup -- restore latest`; the restore itself is backed up first, so it can be undone.
- **Time zones:** instants are stored in UTC; the browser sends its IANA zone (`?tz=`) and the server buckets days/weeks/months in *your* calendar.
- **Keep `data/` out of synced folders** (Dropbox, iCloud, OneDrive) unless you want the plaintext to leave the machine. Encryption at rest is a planned option; the storage layer already has the codec seam for it.

---

## 🧪 Testing

Four layers, all on Node's built-in `node:test`. Every test boots against a **temporary data file** — your own `data/database.json` is never touched, and `test:all` verifies that with a before/after hash (the *isolation guard*).

```bash
npm run build
npm test            # unit + API tests (zero dependencies)
npm run test:e2e    # real server over HTTP, static shell included
npm run test:ui     # real browser via Playwright (dev dependency) — skips itself if no browser is found
npm run test:all    # build, then all of the above + isolation guard
npm run test:quiet  # the same, one summary line per module (see below)
npm run test:update-golden   # regenerate the pinned dataset hash / monthly-summary goldens after an intentional change
```

**Quiet mode** (`npm run test:quiet`, or `node scripts/test-all.mjs --quiet [unit|api|e2e|ui]`) prints one line per test module and a total, and only shows the runner output of modules that fail:

```
unit/links                   Tests Passed 9, Failed 0, Skipped 0
api/links.api                Tests Passed 5, Failed 0, Skipped 0
ui/links.ui                  Tests Passed 4, Failed 0, Skipped 0
…
total                        Tests Passed 138, Failed 0, Skipped 0
isolation guard              untouched (data/database.json)
```

Add `--json` for the same figures as a machine-readable object (`{ modules, total, isolationGuard, ok }`). The exit code is non-zero when any module fails or the isolation guard trips. UI modules report *Skipped* when no browser is available.

| Layer | Folder | What it covers |
|---|---|---|
| unit | `src/test/unit` | storage safety (corrupt-file refusal, file modes, backward compatibility, codec seam), time-zone bucketing, database logic, `[[mention]]` grammar / resolution / rename rewrite, local-graph rules (month activity, stale neighbours, node cap) |
| api | `src/test/api` | REST contract, PUT allow-lists, privacy headers / cross-origin refusal, links / preview / search / graph endpoints |
| e2e | `src/test/e2e` | boot & static shell, fresh install, persistence across restart, legacy store upgrade, thought journey, test-data CLI round-trips (including links) |
| ui | `src/test/ui` | keyboard navigation, theme, timer persistence across reload, mini timer, pop-out window, soundscape cycling, thought capture & triage, `[[` autocomplete, link strip, task detail modal, "Link to…" picker and the Connections graph in a headless Chromium |

### Test data for manual testing

A deterministic, **date-centric** generator produces realistic data "as of today": the three full months before the current month, plus the current month from the 1st up to today. Every day's records are derived from the date itself, so a past day never changes and running again tomorrow only adds tomorrow. It prints the figures the UI must show, so you can paste them into a validation report:

```bash
npm run testdata:report                 # expected figures (add --json for machines, --tz <zone> to match your browser)
npm run testdata:seed                   # standalone store: data/test-database.json (your real store is never opened)
npm run start:test                      # run the app against it
npm run testdata:clean                  # remove it, its manifest and its backups
```

The dataset is connected too: a note on roughly one weekday in four, each mentioning one to three tasks open that day (`[[task:…]]`) and often an earlier note; a third of task descriptions point at a note (`[[note:…]]`); a quarter of parked thoughts mention a note; and on one weekday in five a note is explicitly linked to a task or another note. Every generated mention resolves (the generator keeps whatever a kept record points at) and everything stays date-centric — a day's mentions never depend on when you ran the generator. The report's **Connected thinking** section gives the figures to check against the UI — number of explicit links, resolving mentions, and the *most connected note* with its Connections-panel count. Press `8` with nothing selected and the graph lands on the most connected item of the current month; step back a month and it re-suggests.

To test against your own data as well, merge instead: `npm run testdata:seed -- --into data/database.json`. A backup is taken first, journal days you already have are skipped, and `clean --into` removes exactly the generated records (they all carry the `7e57da7a-…` id namespace), unlinks anything pointing at them — a task of yours in a generated project, a block logged on a generated task, an explicit link you made to a generated note — drops Book-of-Work pages frozen while they were present, and verifies your own records are byte-identical. `[[mentions]]` you typed yourself are text and are never edited; they simply stop resolving once the generated record is gone. Options: `--seed`, `--anchor YYYY-MM-DD|today` (the "as of" day), `--profile small|standard|large` (0 / 3 / 12 months of history before the current month), `--tz`, `--force`.

The step-by-step script is in [`docs/manual-test-checklist.md`](docs/manual-test-checklist.md).

**Browser for `test:ui`:** Playwright looks in `PLAYWRIGHT_BROWSERS_PATH` (falls back to `/opt/pw-browsers` when present). Install one with `npx playwright install chromium-headless-shell`; to skip browser downloads on `npm install`, set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. Failure screenshots/logs land in `test-results/`.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Space` | Start / Pause active focus timer (when in Focus view) |
| `P` | Park a thought from anywhere (`Esc` to dismiss) |
| `S` | Cycle soundscape: off → rain → brown → white → off |
| `1` | Switch to **Focus & Today** view |
| `2` | Switch to **Task Board** view |
| `3` | Switch to **Daily Journal** view |
| `4` | Switch to **Notes & Ideas** view |
| `5` | Switch to **Insights & Analytics** view |
| `6` | Switch to **Thought Inbox** |
| `7` | Switch to **Book of Work** |
| `8` | Switch to **Connections** (local graph of the last-edited note, or of the item you came from) |
| `[[` | In a note, task description or thought: mention a note / task / thought (↑↓ choose, `Enter` insert, `Esc` close; prefix `task:` `note:` `thought:` to narrow) |
| `T` | Toggle Light / Dark theme |

---

## 📁 Project Structure

```
heyw/
├── src/
│   ├── db/
│   │   ├── database.ts       # Local-first JSON database engine (codec seam, 0600 writes)
│   │   ├── backup.ts         # Rotating local backups & restore
│   │   ├── summary.ts        # Monthly summary computation (pure)
│   │   ├── summary-markdown.ts # Markdown rendering of a month
│   │   ├── links.ts          # [[mention]] grammar, resolver, index, rename rewrite, search (pure)
│   │   ├── graph.ts          # Local connection graph & backlinks (pure)
│   │   ├── bookofwork.ts     # Archive, freezing, scheduling
│   │   ├── timer.ts          # Server-authoritative focus timer engine
│   │   └── time.ts           # UTC ⇄ user-zone bucketing (Intl only)
│   ├── routes/
│   │   └── api.ts            # REST API endpoints (allow-listed updates)
│   ├── server/
│   │   ├── router.ts         # HTTP router & static file server (same-origin guard)
│   │   ├── context.ts        # Shared singletons (backups, timer engine)
│   │   └── jobs.ts           # Background workers (timer, backups, monthly freeze)
│   ├── tools/
│   │   ├── backup-cli.ts     # npm run backup -- list|create|restore
│   │   └── testdata/         # deterministic generator, validation report, seed/clean CLI
│   ├── test/
│   │   ├── helpers/          # isolated test server, browser launcher
│   │   ├── fixtures/         # pinned dataset hash and monthly-summary goldens
│   │   └── unit/ api/ e2e/ ui/
│   └── server.ts             # Application entrypoint (loopback bind)
├── public/
│   ├── css/
│   │   └── style.css         # Warm editorial design system (light & dark)
│   ├── js/
│   │   ├── views/
│   │   │   ├── today.js      # Focus timer & today's agenda
│   │   │   ├── inbox.js      # Thought capture & triage
│   │   │   ├── bookofwork.js # Monthly summaries & archive
│   │   │   ├── board.js      # Kanban task board
│   │   │   ├── journal.js    # Morning intentions & evening retros
│   │   │   ├── notes.js      # Scratchpad & markdown notes ([[ mentions, connections panel)
│   │   │   ├── connections.js # Local graph view (static SVG rings, month stepper)
│   │   │   └── insights.js   # Canvas charts & analytics
│   │   ├── api.js            # HTTP client
│   │   ├── links.js          # [[ autocomplete, link strip, "Link to…" picker, connections panel
│   │   ├── app.js            # Router (view + entity deep links) & keyboard shortcuts
│   │   ├── sound.js          # Web Audio ambient sound synthesizer
│   │   ├── timer.js          # Client view of the server-owned timer
│   │   ├── popout.js         # Pop-out countdown window
│   │   └── utils.js          # Canvas renderer, modal & toast utilities
│   ├── timer.html            # Pop-out countdown window
│   └── index.html            # Application shell
├── scripts/
│   ├── test-all.mjs          # Test pyramid runner + isolation guard (--quiet for per-module lines)
│   └── update-goldens.mjs    # Regenerates the pinned dataset hash and summary goldens
├── docs/
│   └── WORKBOOK.md           # Development plan & decisions
├── data/                     # Created at runtime (database.json, 0600)
├── dist/                     # Compiled JavaScript output
├── package.json
├── tsconfig.json
└── README.md
```

---

## 📄 License

MIT — Free to use, modify, and distribute.
