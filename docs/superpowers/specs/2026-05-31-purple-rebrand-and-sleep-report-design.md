# Sleep Toggle v3 — Purple Rebrand + Honest Sleep Report Design Spec

**Date:** 2026-05-31
**Status:** Approved (design), pending implementation plan
**Owner:** PJ
**Builds on:** v1 MVP + v2 sleep screen/score (both shipped, deployed to Netlify)
**Informed by:** independent agent review (2026-05-31) — cut fake stages, gate efficiency, fix dismiss bug, auto-version SW cache.

## Goal

Rebrand the app to a cohesive purple/Pillow palette and replace the single score line with an
**honest** sleep report — real metrics only, no sensor-faked stages. Stay 100% vanilla JS;
keep `lib.js` the pure, tested, portable core.

## Constraints

- Vanilla JS only, no frameworks, no new runtime dependencies, offline-first.
- Manual tracking only — never present modeled numbers as measured data.
- Additive, backward-compatible data model.

## Feature 1 — Full purple rebrand

- `--accent` becomes violet `#7c5cff` (was orange `#ff6a00`). This single token drives the
  Start Sleep button, score number, selected rating, and history score, so one change covers most.
- Regenerate the app icon as a purple crescent (update colors in `tools/make-icons.py`, rerun).
- Add `<link rel="icon" href="icons/icon-192.png">` to `index.html` (kills the favicon 404).
- Remove now-dead `--accent-dim` and `.elapsed` CSS.
- The night screen / liquid are already purple; result is one palette across all states.

## Feature 2 — Honest sleep report (replaces the simple score line)

The "Last session" card becomes a report. All values are derived (never stored), so they
recompute after edits. Shown for the most recent completed session:

- **Sleep Score** (0–100) + band — big, purple.
- **Total Sleep Time** — `timeInBed − awakeMin` (= time in bed when `awakeMin` is unknown).
- **Efficiency** — `totalSleep / timeInBed` as %. **Shown only when `awakeMin` is provided**;
  otherwise rendered as `—` with a small "add minutes awake to see efficiency" hint.
- **Asleep vs Awake** bar — a real two-segment bar from `awakeMin`. Shown only when `awakeMin`
  is provided.
- **Bedtime consistency** — `± N min` (std dev of bedtime over the last 7 days). Shown when
  there are ≥ 2 completed sessions in the window; else `—`.

**Explicitly NOT included:** Light/Deep/REM stage bar. Stages cannot be measured with a manual
toggle; a fixed-ratio estimate carries no per-night information and reads as measured data. Cut
per the review.

## Feature 3 — Wake check-in changes

- Add an optional **"Minutes awake"** number input to the wake dialog, next to rating + note.
- **Fix the dismiss bug:** the dialog currently commits rating/note on ANY close (Esc / backdrop).
  Change so it only saves on an explicit **Save** button; Esc / backdrop / a **Skip** path closes
  without writing rating, note, or awakeMin. (Mirror the edit dialog's `returnValue` gating.)

## Score formula (gated to avoid inflation)

Let `TIB = timeInBedMin`, `awake = sanitized awakeMin` (null when unknown),
`TST = TIB − (awake ?? 0)`, `plannedMin = targetTs ? (targetTs−startTs)/60000 : 480`.

```
durationScore   = clamp(TST / max(plannedMin, 1), 0, 1) * 100
efficiencyScore = awake == null ? null : clamp(TST / max(TIB,1), 0, 1) * 100
ratingScore     = rating == null ? null : (rating/5) * 100

effKnown = efficiencyScore != null
ratKnown = ratingScore != null

score =
  effKnown && ratKnown  -> round(0.5*durationScore + 0.3*efficiencyScore + 0.2*ratingScore)
  effKnown && !ratKnown -> round(0.6*durationScore + 0.4*efficiencyScore)
  !effKnown && ratKnown -> round(0.6*durationScore + 0.4*ratingScore)   // v2 behavior
  !effKnown && !ratKnown-> round(durationScore)
```

Bands unchanged: `≥85 Great, ≥70 Good, ≥50 Fair, else Poor`.

### Math guards (all in `lib.js`, unit-tested)

- `awakeMin`: coerce to number; if not finite or `< 0` → treat as `null` (unknown). If
  `awake > TIB` → clamp to `TIB` (TST=0, efficiency=0).
- `TIB <= 0` → guard divisions (use `max(TIB,1)`); TST clamped ≥ 0.
- `efficiencyScore` clamped to `[0,100]`.

## Data model change

| field | type | notes |
|-------|------|-------|
| `awakeMin` | number \| null | minutes awake during the night; null = not provided. Backward compatible (old sessions = null). |

Storage key unchanged (`sleepToggle.sessions.v1`).

## New / changed `lib.js` functions (pure, tested)

- `timeInBedMin(session)` → minutes between start and end.
- `sanitizeAwake(awakeMin, tibMin)` → null | clamped number.
- `totalSleepMin(session)` → `TIB − (sanitized awake ?? 0)`.
- `sleepEfficiency(session)` → null | rounded % (null when awake unknown).
- `bedtimeConsistency(sessions, now)` → null | `± minutes` (std dev). Uses last-7-day completed
  sessions; bedtimes before noon shifted +24h to avoid midnight wrap; requires ≥ 2 sessions.
- `sleepScore(session)` → updated per the gated formula above.
- `scoreBand(n)` unchanged.

## Feature 4 — Auto-versioned service worker cache

- Root `sw.js` keeps a dev placeholder: `const CACHE = 'sleep-toggle-dev';`.
- `tools/build-dist.sh` computes a short content hash of the runtime assets (everything except
  `sw.js`) and rewrites the `CACHE` line in `dist/sw.js` to `sleep-toggle-<hash>`. So every deploy
  whose content changed gets a fresh cache name automatically — no manual bump, no silent stale ship.
- `liquid.js` stays in the precache list.

## Architecture / files

| file | change |
|------|--------|
| `lib.js` | new metric functions + gated `sleepScore`; stays DOM/storage-free |
| `app.js` | purple wiring unaffected; render report card; awakeMin in wake dialog; dismiss-no-save fix; remove unused `wakeSave` ref |
| `index.html` | favicon link; report card markup (TST, efficiency, asleep/awake bar, consistency); minutes-awake input + Save/Skip in wake dialog |
| `style.css` | `--accent` → violet; report + asleep/awake bar styles; remove dead `.elapsed`/`--accent-dim` |
| `tools/make-icons.py` | purple icon colors; regenerate `icons/*.png` |
| `tools/build-dist.sh` | auto content-hash → `dist/sw.js` cache name |
| `test/lib.test.mjs` | tests for all new functions + every score branch + guards |
| `README.md` | document report metrics, the honesty stance (no stages), efficiency-needs-awakeMin |

## Testing

- **Unit (`node --test`):** `timeInBedMin`, `totalSleepMin`, `sleepEfficiency` (known/unknown),
  `bedtimeConsistency` (≥2 sessions, wrap-around, <2 → null), `sleepScore` all four branches,
  and every guard (awake>TIB, negative, non-numeric, TIB≤0).
- **Browser (Playwright MCP + screenshots, interactive):** purple rebrand across idle/sleep/result;
  wake check-in with minutes-awake; Skip/Esc does not save; report shows TST + efficiency +
  asleep/awake bar when awake given, and `—` when not; consistency after 2+ sessions; edit
  recomputes; 0 console errors. (No committed Playwright suite — avoids adding a heavy test dep;
  `lib.js` math is covered by unit tests.)

## Out of scope (v3)

Real stage detection, latency/HRV/timing metrics (need sensors), history charts, network-first SW
strategy (auto-versioned cache-first is sufficient), React/shadcn rebuild (later, seeded from `lib.js`).
