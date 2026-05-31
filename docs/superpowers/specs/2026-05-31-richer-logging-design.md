# v5 — Richer Logging (Theme 1) — Design Spec

Date: 2026-05-31
Branch: `v5-richer-logging`
Status: Approved for planning

## Summary

Four engagement/polish features for the Sleep Toggle PWA, all vanilla-JS, localStorage-only, offline, honest (no fabricated data):

1. **Rating as words** — show Excellent/Good/Fair/Poor/Very Poor instead of 1–5.
2. **Sleep debt** — cumulative deficit vs goal over the Trends range (deficit-only).
3. **Badges** — per-night tags + a collectible shelf, derived purely from logged data.
4. **Brain Dump** — a standalone "Clear Your Mind" note, hidden until the next day.

Constraints unchanged: no frameworks, no chart libs, no build step for the app, dark theme `#7c5cff`, `lib.js` stays a pure unit-tested core. Project framing: **portfolio project** (not a monetization bet) — so no wasted work; the PWA ships as-is and `lib.js` ports forward if ever wrapped native.

Out of scope: lifestyle correlation engine, ambient noise, audio aids, alarms (reserved Themes 2/3).

## 1. Rating as words

- The wake check-in dialog's five buttons keep their numeric `data-rating` values (1–5) but display word labels.
- **No data migration:** ratings are still stored as the integer 1–5. Only the *display* changes.
- Mapping: 5→Excellent, 4→Good, 3→Fair, 2→Poor, 1→Very Poor.
- Anywhere a rating is shown to the user (currently none in history; future-proof), use `ratingLabel(n)`. CSV export is unchanged (still numeric — data fidelity).

## 2. Sleep debt

- Deficit-only: for each **tracked** night in the selected range, `max(0, goalMin − timeInBedMin)`; sum them.
- Measure = time in bed (`durationMinutes`), consistent with the goal line + streak.
- Untracked nights are skipped (no fabrication); show the count it is based on.
- Display: a new line on the Trends goal/streak card, under the streak: `Sleep debt: 3h 0m · 5 nights`. When `debtMin === 0` → `Sleep debt: on track`. When `nightsCounted === 0` → `Sleep debt: —`.
- Built on the existing `trendSeries` so bucketing/tz logic is not duplicated.

## 3. Badges

Computed purely from a session's existing fields; honest by construction (data-driven, no randomness). A night can earn multiple badges. tz-aware times via `timeOfDayMin`.

| Key | Emoji | Phrase | Rule |
|-----|-------|--------|------|
| `rock` | 🪨 | Slept like a rock! | `timeInBedMin ≥ 480` AND (`awakeMin` known → `awakeMin ≤ 15`; else `rating === 5`) |
| `owl` | 🦉 | Night owl mode active | bedtime `timeOfDayMin(startTs) ≥ 60` (01:00) and `< 12*60` (i.e. a genuine late-night/early-morning bedtime, not an afternoon nap) |
| `zombie` | 🧟 | Running on empty today | `rating === 1` OR `timeInBedMin < 300` (<5h) |
| `earlybird` | 🌅 | Up with the sun! | wake `timeOfDayMin(endTs)` between `240` (04:00) and `360` (06:00) — early but not a midnight false-positive |

- **Per-night tags:** `badgesFor(session)` returns the array; rendered on the **last-session card** (emoji + phrase) and as compact emoji in the **history** rows.
- **Collectible shelf:** `earnedBadges(sessions)` returns the set of keys ever earned across all completed sessions; rendered on Trends as a 4-row shelf with `✓` (earned) / `—` (locked), each showing emoji + name.
- Badge definitions live in one exported constant `BADGES` (key→{emoji, name, phrase}) so `badgesFor`, the shelf, and rendering share a single source.

## 4. Brain Dump

- A `🧠 Clear Your Mind` button on Home (under Start Sleep) opens a dialog with a textarea.
- Saved to its own key `sleepToggle.brainDump.v1` = `{ text, createdAt }` (a single current dump; saving overwrites). Empty text on save clears the dump.
- **Hidden until the next day:** `brainDumpVisible(dump, now)` returns `true` only when the **local calendar date** of `now` differs from the local calendar date of `dump.createdAt` (and `dump.text` is non-empty). This deliberately uses the plain local date (NOT `nightDate`) so a note written at 11pm reveals the next morning.
- When visible, a `🧠 From before bed` card shows on Home with the text and a **Clear** button (removes the key, hides the card).
- While hidden (same day), the button still lets you overwrite/append your note before sleep.
- Storage read/write (`loadBrainDump`/`saveBrainDump`/`clearBrainDump`) lives in `app.js` (mirrors `load`/`save`); only `brainDumpVisible` is pure.

## Pure core additions (`lib.js`, TDD)

- `RATING_LABELS` (array index 1..5) + `ratingLabel(n)` → word (out-of-range → `'—'`).
- `BADGES` constant + `badgesFor(session)` → `[{key, emoji, phrase}]` for a completed session (running/`endTs == null` → `[]`).
- `earnedBadges(sessions)` → `Set` of keys earned across completed sessions.
- `sleepDebt(sessions, goalMin, rangeDays, now)` → `{ debtMin, nightsCounted }`.
- `brainDumpVisible(dump, now)` → boolean.

## Files touched

- `lib.js` — the 5 pure additions above.
- `test/lib.test.mjs` — new cases (below).
- `index.html` — word labels on rating buttons; sleep-debt line; badge tag container on last-session card; badge shelf on Trends; `🧠 Clear Your Mind` button + brain-dump dialog + reveal card.
- `style.css` — badge tags, shelf rows, brain-dump button/card.
- `app.js` — render rating words, sleep-debt line, per-night badges + shelf, brain-dump load/save/clear + visibility + dialog wiring.
- `sw.js` — unchanged source; `tools/build-dist.sh` regenerates the cache version.

## Testing

Unit (pure core):
- `ratingLabel`: 1→'Very Poor' … 5→'Excellent'; 0/6/null → '—'.
- `badgesFor`: rock granted at exactly 8h + low awake; rock via Excellent when awake unknown; rock NOT granted on 8h + high awake; owl on 01:30 bedtime, not on 22:00; zombie on rating 1 and on <5h; earlybird on 05:30 wake, not on 12:00 wake; multiple badges in one night; running session → `[]`.
- `earnedBadges`: union across sessions; empty list → empty set; running sessions ignored.
- `sleepDebt`: sums only below-goal nights; at/above goal contributes 0; empty range → `{debtMin:0, nightsCounted:0}`; goal change recomputes; uses tracked nights only.
- `brainDumpVisible`: same-day → false; next-day → true; empty text → false; null dump → false.

Interactive (browser, after merge): rating shows words and still saves; sleep-debt line correct vs bars; per-night badges appear on last session + history; shelf reflects history; brain-dump saves, hides same day, reveals next day (simulate by editing `createdAt`), Clear works. Deploy to Netlify; PJ final-QAs before pointing `sleep.pjjuplo.art`.

## Risks / notes

- Badge thresholds are heuristic; chosen to avoid false positives (e.g. early-bird windowed 04:00–06:00 so a midnight wake doesn't trigger it; owl bounded to before noon so afternoon naps don't count). Easy to tune later.
- Brain-dump reveal uses plain local date; a post-midnight (after 00:00) dump reveals only after the next date change — acceptable edge for v1.
- localStorage still unbacked (CSV import/restore remains a future patch).
