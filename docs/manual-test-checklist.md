# HeyWork — Manual test checklist

Use this with the deterministic test data so every figure you see can be checked
against the validation report. Paste the filled-in table into your own validation
report.

## 0. Prepare

```bash
npm run build
npm run testdata:report -- --tz UTC     # the expected figures (or your own zone: --tz Europe/Amsterdam)
npm run testdata:seed  -- --tz UTC      # writes data/test-database.json — your real store is never opened
npm run start:test                      # serves the test store on http://127.0.0.1:3000
```

Record: seed `20240101`, as of `today = __________`, profile `standard`, dataset sha256 from the report: `__________`.

> The data is date-centric: it covers the three full months before this month plus this month up to today, and the records for any past day are identical whichever day you generate them. Re-run the report on the day you test — it only ever *adds* today.
>
> The browser buckets days in *its* zone. Run the report with the same `--tz` as the machine you test on, or set the browser to UTC, otherwise late-night blocks (23:30 UTC) legitimately shift by a day.

## 1. Start-up & privacy

| # | Step | Expect | ✓ |
|---|---|---|---|
| 1.1 | Start the server | Banner shows `Running at http://127.0.0.1:3000`, `Data file data/test-database.json`, `Loopback only` | |
| 1.2 | Server log | `📘 Book of Work: froze …` listing the three previous months | |
| 1.3 | `ls -la data/` | `test-database.json` is `-rw-------`; `data/backups/test-database-…-startup.json` exists | |
| 1.4 | From another device on the LAN, open `http://<your-ip>:3000` | Connection refused | |

## 2. Book of Work (key `7`)

Fill in from the report's *Expected figures* table and tick when the page agrees.

| Month | Deep work (h) | Blocks | Active days | Tasks done | Journal days | Avg ⚡ / 🎯 | UI matches ✓ |
|---|---|---|---|---|---|---|---|
| this month (in progress) | | | | | | | |
| last month | | | | | | | |
| two months ago | | | | | | | |
| three months ago | | | | | | | |

| # | Step | Expect | ✓ |
|---|---|---|---|
| 2.1 | Archive pane | Current month "in progress", then the three previous months marked ❄ frozen | |
| 2.2 | Click ‹ past the oldest month | The month before: only task creations from the warm-up (if any), no deep work; keep going to the report's "(empty)" month: all zeros | |
| 2.3 | Open last month → *⬇ Download .md* | File `heywork-book-of-work-YYYY-MM.md`; its *At a glance* row equals the report | |
| 2.4 | *Regenerate* on last month | Toast "… regenerated"; figures unchanged (nothing was edited) | |
| 2.5 | Flow integrity section | Present on months with signal-bearing blocks | |

## 3. Dashboard & Focus (key `1`)

| # | Step | Expect | ✓ |
|---|---|---|---|
| 3.1 | Focus & Today | Focused Today = report's **Focused today**; streak = report's streak; Thought Inbox badge = report's **thought inbox** | |
| 3.2 | Task Board (key `2`) column counts | backlog / to do / in progress / done equal the report's *Board* line | |
| 3.3 | Find the **over-estimate task** named in *Spot checks* | Actual minutes > estimate as stated | |
| 3.4 | Find the **future-due task** | Due date as stated | |

## 4. Timer (launcher + corner countdown)

| # | Step | Expect | ✓ |
|---|---|---|---|
| 4.1 | Click *Start Flow* | The card ticks and shows **Pause · Stop · Reset**; a countdown appears bottom-right on **every** view; sidebar dims | |
| 4.2 | Press `2`, then reload the page | Countdown still running in the corner | |
| 4.3 | Back on `1`, click *Short Break (5m)* | Card shows a static `05:00` and a **Start Short Break** button; the corner still counts Deep Focus down | |
| 4.4 | Click *Start Short Break* | Toast "…m of Deep Focus recorded before switching"; the card now ticks the break | |
| 4.4b | *Reset* | The break restarts from `05:00`; the part already done is recorded (if ≥ 1 min) | |
| 4.5 | Corner ⏸ then ▶ | Pauses/resumes; paused time is not counted | |
| 4.6 | *⧉ Pop out* | Small window with the countdown; close the main tab; the block keeps running (pop-out heartbeats) | |
| 4.7 | Pop-out *Stop* | Block recorded; Insights → Recent Focus Sessions shows it | |
| 4.8 | Close every HeyWork window for 2 minutes with a block running | Block ends as *abandoned*, credited only up to the last heartbeat | |
| 4.9 | Press `S` four times | Rain → Brown → White → Off, with toasts and the button row following | |

## 5. Thought capture & triage

| # | Step | Expect | ✓ |
|---|---|---|---|
| 5.1 | Start a block, type in "Park a thought…" + Enter | Toast "Parked"; field clears; countdown untouched; badge +1 | |
| 5.2 | On the Board, press `P`, type, Enter | Saved; bar closes; `Esc` on a new draft discards it | |
| 5.3 | Inbox (key `6`) → *→ Task* | Modal pre-filled with the text; task appears on the Board; thought moves to *Became tasks* | |
| 5.4 | *Keep for later* / *Discard* | Moves between tabs; *Discarded* tab offers *Restore*; nothing is deleted | |
| 5.5 | A card captured during a block | Meta line: "captured … during Deep Focus on “‹task›”" | |

## 6. Dialogs & data safety

| # | Step | Expect | ✓ |
|---|---|---|---|
| 6.1 | Board → ✕ on a task | In-app modal (red *Delete*), not a browser dialog; *Cancel* and `Esc` keep it | |
| 6.2 | Notes → 🗑 Delete | Same modal | |
| 6.3 | `npm run backup -- list` (with `HEYW_DATA_FILE=data/test-database.json`) | Start-up backup listed | |
| 6.4 | Stop the server, corrupt `data/test-database.json` by hand, start again | Refuses to start (exit 2), file untouched; `npm run backup -- restore latest` repairs it | |

## 7. Clean up

```bash
npm run testdata:clean          # removes data/test-database.json, its manifest and its backups
npm run testdata:status         # "not present"
```

If you merged into your real store instead (`--into data/database.json`):

```bash
npm run testdata:clean -- --into data/database.json
# expect: "Verified: your own records are byte-identical to before seeding."
# exit code 3 means you edited your own records while seeded — check the pre-seed backup it names.
```
