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
- **Customizable Sessions:** 25-minute Deep Focus, 5-minute Short Breaks, and 15-minute Rest periods.
- **Task Association:** Attach focus blocks directly to active tasks to automatically track actual vs. estimated minutes.
- **Procedural Soundscape Generator:** Live Web Audio ambient noise generators (Rain, Brown noise, White noise) with gentle filtering and harmonic completion chimes.
- **Keyboard-Controlled:** Tap `Space` to start/pause focus flow instantly.

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
       └─ public/js/views/notes.js (Scratchpad)
```

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** >= 18.0.0 (tested on v24)
- **npm** >= 9.0.0

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

---

## 🧪 Testing

HeyWork comes with a comprehensive, zero-dependency automated test suite using Node.js built-in `node:test` and `node:assert`:

```bash
# Run unit and integration tests
npm test
```

### Test Coverage Highlights
- ✅ Database initialization and initial seed data verification
- ✅ Task CRUD operations, state transitions, and automatic timestamps
- ✅ Focus session recording and task time credit tracking
- ✅ REST API endpoints (Dashboard, Projects, Tasks, Focus, Logs, Notes)

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Space` | Start / Pause active focus timer (when in Focus view) |
| `1` | Switch to **Focus & Today** view |
| `2` | Switch to **Task Board** view |
| `3` | Switch to **Daily Journal** view |
| `4` | Switch to **Notes & Ideas** view |
| `5` | Switch to **Insights & Analytics** view |
| `T` | Toggle Light / Dark theme |

---

## 📁 Project Structure

```
heyw/
├── src/
│   ├── db/
│   │   └── database.ts       # Local-first JSON database engine
│   ├── routes/
│   │   └── api.ts            # REST API endpoints
│   ├── server/
│   │   └── router.ts         # Fast HTTP router & static file server
│   ├── test/
│   │   ├── api.test.ts       # Integration tests
│   │   └── database.test.ts  # Database unit tests
│   └── server.ts             # Application entrypoint
├── public/
│   ├── css/
│   │   └── style.css         # Warm editorial design system (light & dark)
│   ├── js/
│   │   ├── views/
│   │   │   ├── today.js      # Focus timer & today's agenda
│   │   │   ├── board.js      # Kanban task board
│   │   │   ├── journal.js    # Morning intentions & evening retros
│   │   │   ├── notes.js      # Scratchpad & markdown notes
│   │   │   └── insights.js   # Canvas charts & analytics
│   │   ├── api.js            # HTTP client
│   │   ├── app.js            # Router & keyboard shortcuts
│   │   ├── sound.js          # Web Audio ambient sound synthesizer
│   │   └── utils.js          # Canvas renderer, modal & toast utilities
│   └── index.html            # Application shell
├── data/                     # Created at runtime (database.json)
├── dist/                     # Compiled JavaScript output
├── package.json
├── tsconfig.json
└── README.md
```

---

## 📄 License

MIT — Free to use, modify, and distribute.
