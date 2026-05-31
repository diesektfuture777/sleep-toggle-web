# v5 Richer Logging (Theme 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rating-as-words, sleep debt, data-driven badges (per-night tags + collectible shelf), and a hidden-until-morning Brain Dump to the vanilla-JS Sleep Toggle PWA.

**Architecture:** All derivation is pure and unit-tested in `lib.js`; `app.js` only renders. Ratings stay stored as 1–5 (display-only word change, no migration). Brain dump is a single localStorage record revealed by a pure date-compare.

**Tech Stack:** Vanilla ES modules, `node --test`, CSS, `<dialog>`. No frameworks, no libs, no build step for the app.

Spec: `docs/superpowers/specs/2026-05-31-richer-logging-design.md`

---

## File Structure

- `lib.js` — add: `RATING_LABELS`, `ratingLabel`, `BADGES`, `badgesFor`, `earnedBadges`, `sleepDebt`, `brainDumpVisible`.
- `test/lib.test.mjs` — cases for each.
- `index.html` — rating word labels; sleep-debt line; last-session badge tags; Trends badge shelf; 🧠 button + brain-dump dialog + reveal card.
- `style.css` — badges, shelf, brain-dump.
- `app.js` — render badges/debt/shelf/brain-dump + wiring.

---

## Task 1: `ratingLabel` + `RATING_LABELS`

**Files:** Modify `lib.js`; Test `test/lib.test.mjs`

- [ ] **Step 1: Failing tests** (append to test file)

```js
test('ratingLabel: 1..5 map to words, out-of-range -> dash', () => {
  assert.equal(ratingLabel(5), 'Excellent');
  assert.equal(ratingLabel(4), 'Good');
  assert.equal(ratingLabel(3), 'Fair');
  assert.equal(ratingLabel(2), 'Poor');
  assert.equal(ratingLabel(1), 'Very Poor');
  assert.equal(ratingLabel(0), '—');
  assert.equal(ratingLabel(6), '—');
  assert.equal(ratingLabel(null), '—');
});
```

- [ ] **Step 2: Run — FAIL** (`ratingLabel is not defined`). Add `RATING_LABELS, ratingLabel` to the test import block.

- [ ] **Step 3: Implement** (append to `lib.js`)

```js
export const RATING_LABELS = [null, 'Very Poor', 'Poor', 'Fair', 'Good', 'Excellent'];
export function ratingLabel(n) {
  return RATING_LABELS[n] ?? '—';
}
```

- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `git commit -am "feat: ratingLabel words"`

---

## Task 2: `BADGES` + `badgesFor`

**Files:** Modify `lib.js`; Test `test/lib.test.mjs`

Reuses the existing `sess()` helper and tz `'Asia/Singapore'` already defined in the v4 test block.

- [ ] **Step 1: Failing tests**

```js
test('badgesFor: rock at 8h with low awake', () => {
  const s = sess('r', Date.UTC(2026,4,31,15,0), Date.UTC(2026,4,31,23,0), { awakeMin: 10 }); // 23:00->07:00 SGT, 8h
  assert.ok(badgesFor(s).some((b) => b.key === 'rock'));
});

test('badgesFor: rock via Excellent rating when awake unknown', () => {
  const s = sess('r', Date.UTC(2026,4,31,15,0), Date.UTC(2026,4,31,23,0), { rating: 5 });
  assert.ok(badgesFor(s).some((b) => b.key === 'rock'));
});

test('badgesFor: no rock at 8h with high awake', () => {
  const s = sess('r', Date.UTC(2026,4,31,15,0), Date.UTC(2026,4,31,23,0), { awakeMin: 90 });
  assert.ok(!badgesFor(s).some((b) => b.key === 'rock'));
});

test('badgesFor: owl on 01:30 bedtime, not on 22:00', () => {
  const owl = sess('o', Date.UTC(2026,4,31,17,30), Date.UTC(2026,5,1,1,0)); // 01:30 SGT bedtime
  const notOwl = sess('n', Date.UTC(2026,4,31,14,0), Date.UTC(2026,4,31,22,0)); // 22:00 SGT bedtime
  assert.ok(badgesFor(owl).some((b) => b.key === 'owl'));
  assert.ok(!badgesFor(notOwl).some((b) => b.key === 'owl'));
});

test('badgesFor: zombie on rating 1 and on <5h', () => {
  const bad = sess('z', Date.UTC(2026,4,31,14,0), Date.UTC(2026,4,31,22,0), { rating: 1 });
  const short = sess('s', Date.UTC(2026,4,31,14,0), Date.UTC(2026,4,31,17,0)); // 3h
  assert.ok(badgesFor(bad).some((b) => b.key === 'zombie'));
  assert.ok(badgesFor(short).some((b) => b.key === 'zombie'));
});

test('badgesFor: earlybird on 05:30 wake, not on 12:00 wake', () => {
  const early = sess('e', Date.UTC(2026,4,31,15,0), Date.UTC(2026,4,31,21,30)); // wake 05:30 SGT
  const noon = sess('m', Date.UTC(2026,4,31,18,0), Date.UTC(2026,5,1,4,0));     // wake 12:00 SGT
  assert.ok(badgesFor(early).some((b) => b.key === 'earlybird'));
  assert.ok(!badgesFor(noon).some((b) => b.key === 'earlybird'));
});

test('badgesFor: running session -> none', () => {
  assert.deepEqual(badgesFor(sess('x', Date.UTC(2026,4,31,15,0), null)), []);
});
```

- [ ] **Step 2: Run — FAIL.** Add `BADGES, badgesFor` to test import.

- [ ] **Step 3: Implement** (append to `lib.js`)

```js
export const BADGES = {
  rock: { emoji: '🪨', name: 'The Rock', phrase: 'Slept like a rock!' },
  owl: { emoji: '🦉', name: 'The Owl', phrase: 'Night owl mode active' },
  zombie: { emoji: '🧟', name: 'The Zombie', phrase: 'Running on empty today' },
  earlybird: { emoji: '🌅', name: 'The Early Bird', phrase: 'Up with the sun!' },
};

export function badgesFor(session) {
  if (session.endTs == null) return [];
  const tib = timeInBedMin(session);
  const awake = sanitizeAwake(session.awakeMin, tib); // null when unknown
  const bed = timeOfDayMin(session.startTs, session.tz);
  const wake = timeOfDayMin(session.endTs, session.tz);
  const keys = [];
  if (tib >= 480 && (awake == null ? session.rating === 5 : awake <= 15)) keys.push('rock');
  if (bed >= 60 && bed < 12 * 60) keys.push('owl');           // 01:00..11:59 = past-midnight bedtime
  if (session.rating === 1 || tib < 300) keys.push('zombie'); // very poor or <5h
  if (wake >= 240 && wake < 360) keys.push('earlybird');      // woke 04:00..05:59
  return keys.map((key) => ({ key, ...BADGES[key] }));
}
```

- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `git commit -am "feat: BADGES + badgesFor (data-driven, tz-aware)"`

---

## Task 3: `earnedBadges`

**Files:** Modify `lib.js`; Test `test/lib.test.mjs`

- [ ] **Step 1: Failing tests**

```js
test('earnedBadges: union of keys across sessions; running ignored', () => {
  const list = [
    sess('a', Date.UTC(2026,4,31,15,0), Date.UTC(2026,4,31,23,0), { awakeMin: 5 }),   // rock
    sess('b', Date.UTC(2026,4,30,14,0), Date.UTC(2026,4,30,17,0)),                     // zombie (<5h)
    sess('c', Date.UTC(2026,4,29,15,0), null),                                         // running -> none
  ];
  const set = earnedBadges(list);
  assert.ok(set.has('rock'));
  assert.ok(set.has('zombie'));
  assert.equal(earnedBadges([]).size, 0);
});
```

- [ ] **Step 2: Run — FAIL.** Add `earnedBadges` to import.

- [ ] **Step 3: Implement**

```js
export function earnedBadges(sessions) {
  const set = new Set();
  for (const s of sessions) for (const b of badgesFor(s)) set.add(b.key);
  return set;
}
```

- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `git commit -am "feat: earnedBadges set"`

---

## Task 4: `sleepDebt`

**Files:** Modify `lib.js`; Test `test/lib.test.mjs`

- [ ] **Step 1: Failing tests**

```js
test('sleepDebt: sums only below-goal nights, tracked only', () => {
  const list = [
    sess('a', Date.UTC(2026,4,30,14,0), Date.UTC(2026,4,30,20,0)), // 05-30, 6h -> 2h debt vs 8h
    sess('b', Date.UTC(2026,4,31,14,0), Date.UTC(2026,4,31,23,0)), // 05-31, 9h -> 0 debt
  ];
  const r = sleepDebt(list, 480, 7, NOW);
  assert.equal(r.debtMin, 120);
  assert.equal(r.nightsCounted, 2);
});

test('sleepDebt: empty range -> zero', () => {
  assert.deepEqual(sleepDebt([], 480, 7, NOW), { debtMin: 0, nightsCounted: 0 });
});

test('sleepDebt: recomputes with goal', () => {
  const list = [sess('a', Date.UTC(2026,4,31,14,0), Date.UTC(2026,4,31,20,0))]; // 6h, 05-31
  assert.equal(sleepDebt(list, 420, 7, NOW).debtMin, 60);  // vs 7h -> 1h
  assert.equal(sleepDebt(list, 480, 7, NOW).debtMin, 120); // vs 8h -> 2h
});
```

(`NOW` and `sess` already exist in the v4 test block.)

- [ ] **Step 2: Run — FAIL.** Add `sleepDebt` to import.

- [ ] **Step 3: Implement**

```js
export function sleepDebt(sessions, goalMin, rangeDays, now = Date.now()) {
  const series = trendSeries(sessions, rangeDays, now);
  let debtMin = 0;
  for (const s of series) debtMin += Math.max(0, goalMin - s.timeInBedMin);
  return { debtMin, nightsCounted: series.length };
}
```

- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `git commit -am "feat: sleepDebt (deficit-only)"`

---

## Task 5: `brainDumpVisible`

**Files:** Modify `lib.js`; Test `test/lib.test.mjs`

- [ ] **Step 1: Failing tests**

```js
test('brainDumpVisible: same local day hidden, next day shown', () => {
  const created = new Date('2026-05-31T23:00:00').getTime();
  const sameDay = new Date('2026-05-31T23:30:00').getTime();
  const nextDay = new Date('2026-06-01T07:00:00').getTime();
  assert.equal(brainDumpVisible({ text: 'x', createdAt: created }, sameDay), false);
  assert.equal(brainDumpVisible({ text: 'x', createdAt: created }, nextDay), true);
});

test('brainDumpVisible: empty/null hidden', () => {
  const now = Date.now();
  assert.equal(brainDumpVisible({ text: '   ', createdAt: 0 }, now), false);
  assert.equal(brainDumpVisible(null, now), false);
});
```

- [ ] **Step 2: Run — FAIL.** Add `brainDumpVisible` to import.

- [ ] **Step 3: Implement**

```js
export function brainDumpVisible(dump, now = Date.now()) {
  if (!dump || !dump.text || !dump.text.trim()) return false;
  const localDate = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };
  return localDate(dump.createdAt) !== localDate(now);
}
```

- [ ] **Step 4: Run — PASS (expect 46 + ~18 new all green).**
- [ ] **Step 5: Commit** `git commit -am "feat: brainDumpVisible (reveal next local day)"`

---

## Task 6: HTML

**Files:** Modify `index.html`

- [ ] **Step 1: Rating buttons → words.** Replace the five rating buttons in `#ratingRow`:

```html
      <div class="rating" id="ratingRow">
        <button type="button" data-rating="5">Excellent</button>
        <button type="button" data-rating="4">Good</button>
        <button type="button" data-rating="3">Fair</button>
        <button type="button" data-rating="2">Poor</button>
        <button type="button" data-rating="1">Very Poor</button>
      </div>
```

- [ ] **Step 2: Badge tags on last-session card.** Add inside `#lastCard`, right after the `.awake-legend` paragraph:

```html
        <div class="badges" id="lastBadges"></div>
```

- [ ] **Step 3: Brain Dump button on Home.** Add directly after the `#primaryBtn` button:

```html
      <button class="secondary brain-btn" id="brainDumpBtn" type="button">🧠 Clear Your Mind</button>
      <section class="card brain-card" id="brainDumpCard" hidden>
        <h2>🧠 From before bed</h2>
        <p class="brain-reveal" id="brainDumpReveal"></p>
        <button class="secondary" id="brainDumpClear" type="button">Clear</button>
      </section>
```

- [ ] **Step 4: Sleep-debt line + badge shelf on Trends.** In the Trends goal/streak card, add after `#streak`:

```html
        <p class="debt" id="sleepDebt">Sleep debt: —</p>
```

  And add a new card at the end of `#trendsView` (after the drift card):

```html
      <section class="card">
        <h2>Badges</h2>
        <ul class="shelf" id="badgeShelf"></ul>
      </section>
```

- [ ] **Step 5: Brain Dump dialog.** Add next to the other `<dialog>`s (before the toast):

```html
  <dialog id="brainDumpDialog">
    <form method="dialog" class="dialog-form">
      <h2>Clear your mind</h2>
      <textarea id="brainDumpText" rows="5" placeholder="Tomorrow's to-dos, racing thoughts… hidden until morning."></textarea>
      <menu class="dialog-actions">
        <button value="cancel" type="button" id="brainDumpCancel">Cancel</button>
        <button value="save" id="brainDumpSave">Save</button>
      </menu>
    </form>
  </dialog>
```

- [ ] **Step 6: Serve & sanity-check** no console errors.

Run: `python3 -m http.server 8765` → open `/`.

- [ ] **Step 7: Commit** `git commit -am "feat: v5 markup (rating words, badges, debt, brain dump)"`

---

## Task 7: CSS

**Files:** Modify `style.css` (append)

- [ ] **Step 1: Add styles**

```css
/* ---------- v5: badges, shelf, brain dump ---------- */
.rating { flex-wrap: wrap; }
.rating button { flex: 1 1 30%; }

.badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.badge-tag { display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px; border-radius: 999px; background: #221c3a; color: var(--text); font-size: 13px; }

.shelf { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
.shelf li { display: flex; align-items: center; gap: 10px; font-size: 15px; color: var(--muted); }
.shelf li.earned { color: var(--text); }
.shelf li .mark { margin-left: auto; }
.shelf li.earned .mark { color: var(--accent); }

.debt { margin: 8px 0 0; color: var(--muted); }
.brain-btn { width: 100%; margin-top: 10px; }
.brain-reveal { white-space: pre-wrap; line-height: 1.5; margin: 0 0 12px; }
```

- [ ] **Step 2: Reload, confirm rating words wrap and look right.**
- [ ] **Step 3: Commit** `git commit -am "feat: v5 styles"`

---

## Task 8: app.js

**Files:** Modify `app.js`

- [ ] **Step 1: Extend imports**

```js
import {
  formatDuration, durationMinutes, getRunningSession, canStart,
  validateEnd, sessionsToCsv, recentStats, formatTimeLeft, sleepScore, scoreBand,
  totalSleepMin, timeInBedMin, sleepEfficiency, bedtimeConsistency, sanitizeAwake,
  DEFAULT_GOAL_MIN, trendSeries, rangeSummary, currentStreak, sanitizeGoal,
  ratingLabel, BADGES, badgesFor, earnedBadges, sleepDebt, brainDumpVisible,
} from './lib.js';
```

- [ ] **Step 2: Brain-dump storage** (after `saveSettings`)

```js
const BRAIN_KEY = 'sleepToggle.brainDump.v1';
function loadBrainDump() {
  try { return JSON.parse(localStorage.getItem(BRAIN_KEY) || 'null'); } catch { return null; }
}
function saveBrainDump(text) {
  localStorage.setItem(BRAIN_KEY, JSON.stringify({ text, createdAt: Date.now() }));
}
function clearBrainDump() { localStorage.removeItem(BRAIN_KEY); }
```

- [ ] **Step 3: Element refs** (add to `els`)

```js
  lastBadges: $('lastBadges'), sleepDebt: $('sleepDebt'), badgeShelf: $('badgeShelf'),
  brainDumpBtn: $('brainDumpBtn'), brainDumpCard: $('brainDumpCard'),
  brainDumpReveal: $('brainDumpReveal'), brainDumpClear: $('brainDumpClear'),
  brainDumpDialog: $('brainDumpDialog'), brainDumpText: $('brainDumpText'),
  brainDumpCancel: $('brainDumpCancel'), brainDumpSave: $('brainDumpSave'),
```

- [ ] **Step 4: Render per-night badges on last-session card.** In `render()`, inside the `if (last) {` block, after the awake-bar logic, add:

```js
    els.lastBadges.innerHTML = '';
    for (const b of badgesFor(last)) {
      const tag = document.createElement('span');
      tag.className = 'badge-tag';
      tag.textContent = `${b.emoji} ${b.phrase}`;
      els.lastBadges.appendChild(tag);
    }
```

- [ ] **Step 5: Badge emoji in history rows.** In `render()`'s history loop, after building `sc` (the score-mini span) and before `right.append(...)`, add a badges span and include it:

Replace:
```js
    const right = document.createElement('span');
    right.append(dur, sc);
```
with:
```js
    const bs = document.createElement('span');
    bs.className = 'hist-badges';
    bs.textContent = badgesFor(s).map((b) => b.emoji).join('');
    const right = document.createElement('span');
    right.append(dur, sc, bs);
```

- [ ] **Step 6: Render brain-dump reveal card.** Add a helper and call it from `render()`:

```js
function renderBrainDump() {
  const dump = loadBrainDump();
  if (brainDumpVisible(dump, Date.now())) {
    els.brainDumpReveal.textContent = dump.text;
    els.brainDumpCard.hidden = false;
  } else {
    els.brainDumpCard.hidden = true;
  }
}
```

At the end of `render()` add: `renderBrainDump();`

- [ ] **Step 7: Sleep-debt line + shelf in `renderTrends()`.** Append inside `renderTrends()` after the streak line:

```js
  const debt = sleepDebt(sessions, goalMin, currentRange, Date.now());
  els.sleepDebt.textContent = debt.nightsCounted === 0
    ? 'Sleep debt: —'
    : debt.debtMin === 0
      ? 'Sleep debt: on track'
      : `Sleep debt: ${formatDuration(debt.debtMin)} · ${debt.nightsCounted} night${debt.nightsCounted === 1 ? '' : 's'}`;

  const earned = earnedBadges(sessions);
  els.badgeShelf.innerHTML = '';
  for (const [key, b] of Object.entries(BADGES)) {
    const li = document.createElement('li');
    if (earned.has(key)) li.className = 'earned';
    const label = document.createElement('span');
    label.textContent = `${b.emoji} ${b.name}`;
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = earned.has(key) ? '✓' : '—';
    li.append(label, mark);
    els.badgeShelf.appendChild(li);
  }
```

- [ ] **Step 8: Brain-dump wiring.** In the `// ---------- wiring ----------` section add:

```js
els.brainDumpBtn.addEventListener('click', () => {
  const dump = loadBrainDump();
  els.brainDumpText.value = (dump && dump.text) || '';
  els.brainDumpDialog.showModal();
});
els.brainDumpCancel.addEventListener('click', () => els.brainDumpDialog.close());
els.brainDumpSave.addEventListener('click', (e) => {
  e.preventDefault();
  const text = els.brainDumpText.value.trim();
  if (text) saveBrainDump(text); else clearBrainDump();
  els.brainDumpDialog.close();
  render();
});
els.brainDumpClear.addEventListener('click', () => { clearBrainDump(); render(); });
```

- [ ] **Step 9: Verify.** `node --test test/lib.test.mjs` green; serve and click through: rating words save; badges on last session + history; Trends shows debt + shelf; brain dump saves/hides, reveals when you temporarily set its `createdAt` to yesterday via console, Clear works.

- [ ] **Step 10: Commit** `git commit -am "feat: v5 wiring — badges, debt, shelf, brain dump"`

---

## Task 9: Build dist + finish

- [ ] **Step 1:** `bash tools/build-dist.sh`.
- [ ] **Step 2:** `node --test test/lib.test.mjs` final green.
- [ ] **Step 3:** Merge `v5-richer-logging` → `main` (finishing-a-development-branch skill); rebuild dist on main.
- [ ] **Step 4:** Report `dist/` ready for PJ to drag to the existing Netlify project; PJ final-QAs before pointing `sleep.pjjuplo.art`.

---

## Self-Review

**Spec coverage:** rating words (T1, T6 buttons + ratingLabel) ✓; sleep debt (T4, T7 line) ✓; badges per-night (T2, T6 container, T8 last-card + history) ✓; badge shelf (T3, T6 shelf, T7 css, T8 render) ✓; brain dump button+dialog+card+reveal (T5, T6, T8 storage/wiring) ✓; all 5 pure fns + tests ✓; no migration (ratings stay numeric) ✓.

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `badgesFor` returns `[{key, emoji, name, phrase}]` (spread of `BADGES[key]` which has emoji/name/phrase) — render uses `.emoji`/`.phrase` (tags) and `.emoji` (history); shelf iterates `BADGES` entries using `.emoji`/`.name` and `earnedBadges` Set `.has(key)`. `sleepDebt` → `{debtMin, nightsCounted}` matches T7 usage. `brainDumpVisible(dump, now)` + `{text, createdAt}` shape consistent across `saveBrainDump`/`loadBrainDump`/render. `ratingLabel` exported and imported (used defensively; current UI sets numeric rating via `data-rating`, unchanged).
