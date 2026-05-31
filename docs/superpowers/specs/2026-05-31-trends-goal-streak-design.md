# v4 — Trends screen + Goal/Streak — Design Spec

Date: 2026-05-31
Branch: `v3-purple-report` (continuing; this is the v4 feature set)
Status: Approved for planning

## Summary

Add two features to the Sleep Toggle PWA in a single patch:

1. **Trends screen** — a new Home ⇄ Trends view showing per-night patterns over a 7- or 30-day range (range summary, duration bars, bedtime/wake drift chart).
2. **Goal + streak** — a user-set minimum sleep-duration goal and a current streak of consecutive nights that meet it.

Constraints (unchanged project rules): vanilla JS, no frameworks, no chart libraries, no build step for the app, localStorage only, offline PWA, dark theme with `#7c5cff` accent. `lib.js` stays a pure, unit-tested core. **Honest tracker** — never fabricate or imply data the user did not enter.

Out of scope (explicitly deferred): CSV import/restore, add/delete arbitrary sessions, goal types other than min-duration, score sparkline + trend arrow. The existing CSV **export** button is unchanged.

## Navigation

- A two-tab toggle at the top of the app: **Home** and **Trends**.
- Implemented as two `<section>`s in `index.html`; switching flips `hidden` and toggles an `.active` class on the tab button. No router, no new dependency.
- Home is the current screen, unchanged. Trends is new.
- Default view on load = Home.

## Trends screen

A range toggle `[7d] [30d]` controls all content on the screen. Default range = 7d. (Persisting the last-selected range is out of scope.)

### 1. Range summary (text)
Headline numbers for the selected range:
- Average **time in bed** (`durationMinutes`).
- Average **efficiency** — computed **only** over nights that have a real `awakeMin` value (`sleepEfficiency !== null`). If zero such nights, show `—`. Always show the count it is based on, e.g. `78% (based on 3 nights)`. Never average an implied 100% across nights with unknown awake time.
- **Best / worst** night by time in bed.
- **Nights tracked** in the range.

### 2. Duration bars
- One bar per tracked night in the range, height proportional to time in bed.
- CSS flex `<div>` bars (same technique as the existing asleep/awake bar). No SVG, no chart lib.
- A horizontal **goal line** marks `goalMin` so hit/miss is visible at a glance. Bars at or above the goal use the accent color; below-goal bars are dimmed.
- Untracked nights are gaps (no bar), never zero-height fabrications.

### 3. Bedtime / wake drift (inline SVG)
- Per-night dots plotted on a vertical clock axis (e.g. 6pm → noon next day), one column per night across the range.
- Two dot series: **bedtime** (from `startTs`) and **wake** (from `endTs`), connected per night by a faint vertical segment.
- Rendered as inline **SVG** (the one place SVG is justified — positioned points on a continuous axis). Themed via CSS `fill`/`stroke` with `#7c5cff`. No library.
- Robustness: the time-of-day computation is tz-aware (see `nightDate`), wrapped in `try/catch` so a legacy/invalid `tz` value falls back to device-local rather than crashing the screen.

### 4. Per-night data
The drift chart surfaces bedtime/wake; the existing 7-day list (date · duration · score) remains the textual record. No new sparkline.

## Goal + streak

### Goal
- Goal = **minimum sleep duration** (time in bed), stored in a new localStorage key `sleepToggle.settings.v1` = `{ goalMin }`. Kept separate from `sleepToggle.sessions.v1`.
- Set via a small tappable control on the Trends screen: `Goal: 8h ✎`. Editing opens a small dialog with a single numeric **hours** input (`step="0.5"`, min 1, max 16); the value is converted to minutes and run through `sanitizeGoal` on save.
- Default `goalMin` = `DEFAULT_GOAL_MIN` (480 / 8h, already exported from lib.js).
- `loadSettings()` / `saveSettings()` live in `app.js`, mirroring the existing `load()/save()` pattern; `loadSettings()` always returns a sanitized goal so a corrupt key cannot crash the app.

### Streak
Displayed on Trends as `🔥 N nights ≥8h` (the hours label is derived from `goalMin`, so it stays truthful when the goal changes; non-round goals render as e.g. `≥7.5h`).

**Measure:** time in bed (`durationMinutes`) — the same measure as the goal line, so a bar above the goal line always corresponds to a night that extends the streak.

**Algorithm (`currentStreak(sessions, goalMin, now)`):**
1. Exclude any running session (no `endTs`, no duration yet).
2. Group completed sessions by `nightDate`; the representative for a night is the **longest** session that night (tie → longest).
3. `anchor = nightDate(now, deviceTz)`. If the anchor night has no completed qualifying session yet, **do not reset** — begin the backward walk from the **previous** night. (You have not failed tonight; you simply have not slept yet. Resetting every evening would make the streak useless.)
4. Walk backward one calendar night at a time from the start night:
   - night qualifies (representative time-in-bed ≥ `goalMin`) → `count++`, continue
   - night exists but below goal → stop
   - night missing (untracked) → stop
5. Return `count`.

`now` is injectable for tests.

## Night attribution

A session's "night" is the local calendar date of its **start** time, except a session that starts between **midnight and noon** is attributed to the **previous** day (a 1 am bedtime counts as the night before). This matches the existing `bedtimeConsistency` <noon shift.

- **tz-aware:** `nightDate(ts, tz)` computes the calendar date in the session's stored `tz` via `Intl.DateTimeFormat('en-CA', { timeZone: tz })`, plus a tz-aware hour lookup for the <noon test. This prevents travel/DST from silently re-bucketing history.
- **Fallback:** legacy `tz` values like `UTC+08:00` are not valid IANA names and throw in `Intl`; `nightDate` catches this and falls back to device-local date/hours.
- Boundary at exactly **12:00** (noon) and exactly **00:00** (midnight) is defined and tested: `< 12:00` shifts to previous day; `>= 12:00` stays; `00:00` shifts (it is `< 12:00`).
- One main sleep per night is assumed. A 2 pm nap creates its own night-bucket for that calendar date; for the streak/representative logic the longest session of a night wins.

## Pure core additions (`lib.js`, TDD)

All pure, no DOM, no localStorage — tested via `node --test`.

- `nightDate(ts, tz)` → `'YYYY-MM-DD'` string with the tz-aware <noon shift and device-local fallback.
- `groupByNight(sessions)` → `Map`/object keyed by night date → representative (longest) completed session. Shared by the three consumers below so the bucketing logic exists once. Exported and tested directly.
- `trendSeries(sessions, rangeDays, now)` → array of per **tracked** night `{ night, timeInBedMin, totalSleepMin, efficiency|null, score|null, bedtimeMin, wakeMin }`, ordered chronologically, gaps simply absent. The renderer is "dumb" — all bucketing/derivation lives here.
- `rangeSummary(sessions, rangeDays, now)` → `{ avgTimeInBed, avgEfficiency|null, efficiencyNights, best, worst, nightsTracked }`.
- `currentStreak(sessions, goalMin, now)` → integer (algorithm above).
- `sanitizeGoal(value)` → minutes: coerce to number; reject non-finite/≤0; clamp to 60–960 (1–16h); round to nearest 5; return `DEFAULT_GOAL_MIN` on invalid. Mirrors `sanitizeAwake` discipline.

`bedtimeMin`/`wakeMin` are tz-aware minutes-of-day for the drift chart; a tiny pure helper for tz-aware time-of-day may be factored out and tested.

## Files touched

- `index.html` — Home/Trends tabs, Trends `<section>` (range toggle, summary, bars, SVG drift, goal control + streak).
- `app.js` — view switching, settings load/save, render Trends from `trendSeries`/`rangeSummary`/`currentStreak`, goal-edit handler, SVG/markup building.
- `style.css` — tab bar, range toggle, duration bars + goal line, SVG drift styles, goal/streak control.
- `lib.js` — the new pure functions above.
- `test/lib.test.mjs` — new cases (below).
- `sw.js` — no manual change; cache version is regenerated by `tools/build-dist.sh` when building `dist/`.

## Testing

Unit tests (pure core) must cover:
- `nightDate`: tz-aware bucketing; boundaries at 11:59 / 12:00 / 00:00; invalid-tz fallback to device-local.
- `groupByNight`: tie-break (two sessions same night → longest wins); running session excluded.
- `trendSeries`: ordering, gaps absent, efficiency null when awake unknown, single tracked night, all-untracked range → empty array.
- `rangeSummary`: efficiency averaged only over real-awake nights, `efficiencyNights` count, `—`/null when none; best/worst; nightsTracked.
- `currentStreak`: anchor = last completed night; tonight in-progress/absent does not reset; gap breaks; below-goal breaks; goal exactly met is inclusive (`≥`); DST/tz-travel night via `tz`; running session excluded.
- `sanitizeGoal`: clamps, 5-min rounding, invalid → default.

Interactive verification (browser, after merge of unit work): tab switching, range toggle, goal edit persists, bars + goal line render, drift SVG renders and survives a legacy `tz` value, streak updates correctly across a tracked night. PJ will nap-test at ~2pm Asia/Singapore.

## Risks / notes

- localStorage remains the only store — no backup. CSV import/restore was offered and deferred; data-loss risk is accepted for now.
- `bedtimeConsistency` (existing) is device-local, not tz-aware; left unchanged in this patch to avoid scope creep. New code is tz-aware. Noted as a known minor inconsistency.
