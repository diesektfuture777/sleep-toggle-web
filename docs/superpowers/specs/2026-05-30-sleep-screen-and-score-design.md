# Sleep Toggle v2 — Sleeping Screen + Sleep Score Design Spec

**Date:** 2026-05-30
**Status:** Approved (design), pending implementation plan
**Owner:** PJ
**Builds on:** `2026-05-30-sleep-toggle-design.md` (v1 MVP, vanilla, shipped)

## Goal

Add a Pillow-inspired sleeping screen (big live clock, countdown to a set wake time, liquid
wave animation) and a derived Sleep Score (0–100). Stay 100% vanilla JS. Keep `lib.js` as the
portable core for a future React+shadcn rebuild (separate, later — not a folder clone).

## Constraints

- Vanilla JS only — no frameworks, no TypeScript, no installed packages.
- Offline-first, no external services (no Google Fonts CDN, etc.).
- Additive: existing toggle / edit / export / PWA behavior unchanged.
- Dark mode always.

## Feature 1 — Set wake time on Start

- Tapping **Start Sleep** opens a time picker before the session is created.
- Default value: last-used wake time if present, else now + 8h rounded to nearest 5 min.
- On confirm: create the session with `targetTs` = today/tomorrow timestamp for that wall-clock
  time (if the chosen time is earlier than now, it means tomorrow morning → add a day).
- On cancel: no session is created.

## Feature 2 — Sleeping screen

While a session is running, the main view becomes a focused dark "night" view:

- **Big live clock** — current local time (e.g. `7:05 PM`), updating every second.
  Large, light weight (200–300), tabular numerals, system font stack (SF Pro Display on iOS).
- **Countdown** — `9 hours 39 min left` to `targetTs`, updating every second.
  - If past `targetTs`: show `Past wake time`.
- **Alarm target** — small line: `Alarm · 6:00 AM`.
- **Liquid animation** — `liquid.js`, a Canvas behind the clock with two offset sine waves
  (orange-tinted on dark). Fill fraction = clamp(elapsed ÷ plannedDuration, 0..1), where
  plannedDuration = `targetTs − startTs`. Rises through the night. Fluid ambient motion.
- The primary button remains: now labeled **I'm Awake**.

### No real alarm (explicit)

v2 provides a **visual** countdown only. A web app / iOS PWA cannot reliably ring an alarm in
the background. No sound, no notification. Documented in README so it's not a surprise.

## Feature 3 — Sleep Score (0–100)

Pure, derived (never stored), recomputes after edits. In `lib.js`:

```
plannedMin   = targetTs ? (targetTs - startTs)/60000 : DEFAULT_GOAL_MIN  // DEFAULT_GOAL_MIN = 480
actualMin    = (endTs - startTs)/60000
durationScore = clamp(actualMin / plannedMin, 0, 1) * 100   // 100 if met/exceeded goal
ratingScore   = rating != null ? (rating / 5) * 100 : null
score = ratingScore == null
          ? round(durationScore)
          : round(0.6 * durationScore + 0.4 * ratingScore)
```

- `scoreBand(n)`: `>=85 Great`, `>=70 Good`, `>=50 Fair`, else `Poor`.
- Only computed for completed sessions (`endTs != null`).

**Display:**
- Last-session card: big score number + band.
- History rows: small score next to the duration.

## Data model change

Session gains one field:

| field | type | notes |
|-------|------|-------|
| `targetTs` | number \| null | planned wake time (ms epoch); null for v1 sessions |

All other fields unchanged. Storage key stays `sleepToggle.sessions.v1` (additive field, backward
compatible — old sessions read fine, `targetTs` treated as null).

## Architecture / files

| file | change |
|------|--------|
| `lib.js` | + `formatTimeLeft(ms)`, `sleepScore(session)`, `scoreBand(n)`, `DEFAULT_GOAL_MIN` |
| `liquid.js` | NEW — self-contained Canvas wave animation: `start(canvas)`, `stop()`, `setProgress(0..1)` |
| `app.js` | wake-time picker on start; sleeping-screen rendering; score on card + history; wires liquid |
| `index.html` | sleeping-screen markup (clock, countdown, alarm, canvas), wake-time picker dialog, score elements |
| `style.css` | sleeping-screen + score styles; large modern clock treatment |
| `test/lib.test.mjs` | + tests for `formatTimeLeft`, `sleepScore`, `scoreBand` |
| `README.md` | document wake target, score formula, no-real-alarm caveat |

`lib.js` stays DOM/storage-free (portable core). `liquid.js` is isolated so `app.js` stays focused.

## Testing

- **Unit (`node --test`):** `formatTimeLeft` (hours+mins, mins-only, past), `sleepScore`
  (met goal, under goal, no rating, no target → default goal), `scoreBand` boundaries.
- **Browser (Playwright + screenshots):** start with wake-time picker → sleeping screen shows
  live clock + countdown + alarm + animated liquid; end → score appears on card + history;
  edit recomputes score; reload mid-sleep preserves the night view; 0 console errors.

## Out of scope (v2)

Real alarms / sound / notifications, multiple alarms, snooze, charts/graphs, sensor tracking,
React/shadcn (that's the later, separate rebuild seeded from `lib.js`).
