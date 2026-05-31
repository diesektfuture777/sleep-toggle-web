# v4 Trends + Goal/Streak Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Home⇄Trends view (range summary, duration bars, SVG bedtime/wake drift) plus a min-duration sleep goal and a streak counter, to the vanilla-JS Sleep Toggle PWA.

**Architecture:** All derivation lives in pure, unit-tested functions in `lib.js`; `app.js` only reads them and renders DOM. New settings (`goalMin`) live in a separate localStorage key. Night attribution is tz-aware via `Intl`.

**Tech Stack:** Vanilla ES modules, `node --test` for units, CSS flex bars + one inline SVG. No frameworks, no chart libs, no build step for the app.

Spec: `docs/superpowers/specs/2026-05-31-trends-goal-streak-design.md`

---

## File Structure

- `lib.js` — add 7 pure exports: `nightDate`, `timeOfDayMin`, `groupByNight`, `trendSeries`, `rangeSummary`, `currentStreak`, `sanitizeGoal` (+ internal `prevNightStr`).
- `test/lib.test.mjs` — add test cases for each.
- `index.html` — tab bar + Trends `<section>` + goal-edit dialog.
- `style.css` — tabs, range toggle, duration bars + goal line, SVG drift, goal/streak controls.
- `app.js` — view switching, settings load/save, Trends render, goal-edit + range-toggle handlers.

---

## Task 1: `nightDate(ts, tz)` — tz-aware night bucket

**Files:**
- Modify: `lib.js`
- Test: `test/lib.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
test('nightDate: after-noon start keeps same calendar date', () => {
  // 2026-05-31 22:00 in Singapore
  const ts = Date.UTC(2026, 4, 31, 14, 0); // 22:00 SGT (UTC+8)
  assert.equal(nightDate(ts, 'Asia/Singapore'), '2026-05-31');
});

test('nightDate: before-noon start shifts to previous day', () => {
  // 2026-06-01 01:00 SGT => night of 2026-05-31
  const ts = Date.UTC(2026, 4, 31, 17, 0); // 01:00 SGT next day
  assert.equal(nightDate(ts, 'Asia/Singapore'), '2026-05-31');
});

test('nightDate: boundary 11:59 shifts back, 12:00 stays', () => {
  const before = Date.UTC(2026, 4, 31, 3, 59); // 11:59 SGT
  const at = Date.UTC(2026, 4, 31, 4, 0);       // 12:00 SGT
  assert.equal(nightDate(before, 'Asia/Singapore'), '2026-05-30');
  assert.equal(nightDate(at, 'Asia/Singapore'), '2026-05-31');
});

test('nightDate: midnight 00:00 shifts to previous day', () => {
  const ts = Date.UTC(2026, 4, 31, 16, 0); // 00:00 SGT next day
  assert.equal(nightDate(ts, 'Asia/Singapore'), '2026-05-31');
});

test('nightDate: invalid tz falls back without throwing', () => {
  const ts = Date.UTC(2026, 4, 31, 14, 0);
  assert.doesNotThrow(() => nightDate(ts, 'UTC+08:00'));
  assert.match(nightDate(ts, 'UTC+08:00'), /^\d{4}-\d{2}-\d{2}$/);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test test/lib.test.mjs`
Expected: FAIL — `nightDate is not defined`.

- [ ] **Step 3: Implement in `lib.js`** (add near the other date helpers)

```js
// Calendar "night" a timestamp belongs to: the local date of the start time,
// but a start before noon counts as the PREVIOUS day (1am bedtime = night before).
// tz-aware via Intl; falls back to device-local for invalid tz strings.
export function nightDate(ts, tz) {
  let y, mo, d, h;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(ts);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    y = Number(get('year')); mo = Number(get('month')); d = Number(get('day'));
    h = Number(get('hour')) % 24;
  } catch {
    const dt = new Date(ts);
    y = dt.getFullYear(); mo = dt.getMonth() + 1; d = dt.getDate(); h = dt.getHours();
  }
  let base = Date.UTC(y, mo - 1, d);
  if (h < 12) base -= 24 * 60 * 60 * 1000;
  const x = new Date(base);
  const pad = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
}

function prevNightStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d) - 24 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
}
```

Add `nightDate` to the import list in `test/lib.test.mjs` and `app.js` when needed.

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/lib.test.mjs`
Expected: PASS (all nightDate cases).

- [ ] **Step 5: Commit**

```bash
git add lib.js test/lib.test.mjs
git commit -m "feat: tz-aware nightDate with <noon shift"
```

---

## Task 2: `timeOfDayMin(ts, tz)` — tz-aware minutes-of-day

**Files:** Modify `lib.js`; Test `test/lib.test.mjs`

- [ ] **Step 1: Failing test**

```js
test('timeOfDayMin: tz-aware minutes since local midnight', () => {
  const ts = Date.UTC(2026, 4, 31, 14, 30); // 22:30 SGT
  assert.equal(timeOfDayMin(ts, 'Asia/Singapore'), 22 * 60 + 30);
});

test('timeOfDayMin: invalid tz falls back without throwing', () => {
  const ts = Date.UTC(2026, 4, 31, 14, 30);
  assert.doesNotThrow(() => timeOfDayMin(ts, 'UTC+08:00'));
});
```

- [ ] **Step 2: Run — FAIL** (`timeOfDayMin is not defined`).

- [ ] **Step 3: Implement**

```js
// Minutes since local midnight in the session's tz (for the drift chart).
export function timeOfDayMin(ts, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(ts);
    const h = Number(parts.find((p) => p.type === 'hour')?.value) % 24;
    const m = Number(parts.find((p) => p.type === 'minute')?.value);
    return h * 60 + m;
  } catch {
    const d = new Date(ts);
    return d.getHours() * 60 + d.getMinutes();
  }
}
```

- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `git commit -am "feat: tz-aware timeOfDayMin"`

---

## Task 3: `groupByNight(sessions)` — one representative session per night

**Files:** Modify `lib.js`; Test `test/lib.test.mjs`

- [ ] **Step 1: Failing tests**

```js
const sess = (id, startUTC, endUTC, extra = {}) => ({
  id, startTs: startUTC, endTs: endUTC, tz: 'Asia/Singapore', awakeMin: null, ...extra,
});

test('groupByNight: excludes running sessions', () => {
  const list = [sess('a', Date.UTC(2026,4,31,14,0), null)];
  assert.equal(groupByNight(list).size, 0);
});

test('groupByNight: same night keeps the longer session', () => {
  const short = sess('s', Date.UTC(2026,4,31,14,0), Date.UTC(2026,4,31,15,0)); // 1h
  const long  = sess('l', Date.UTC(2026,4,31,15,0), Date.UTC(2026,4,31,21,0)); // 6h
  const m = groupByNight([short, long]);
  assert.equal(m.size, 1);
  assert.equal(m.get('2026-05-31').id, 'l');
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement**

```js
// Group COMPLETED sessions by their night date; representative = longest session.
export function groupByNight(sessions) {
  const map = new Map();
  for (const s of sessions) {
    if (s.endTs == null) continue;
    const night = nightDate(s.startTs, s.tz);
    const cur = map.get(night);
    if (!cur || timeInBedMin(s) > timeInBedMin(cur)) map.set(night, s);
  }
  return map;
}
```

- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `git commit -am "feat: groupByNight representative bucketing"`

---

## Task 4: `trendSeries` + `rangeSummary`

**Files:** Modify `lib.js`; Test `test/lib.test.mjs`

- [ ] **Step 1: Failing tests**

```js
const NOW = Date.UTC(2026, 5, 1, 4, 0); // 2026-06-01 12:00 SGT

test('trendSeries: chronological, gaps absent, efficiency null when awake unknown', () => {
  const list = [
    sess('n1', Date.UTC(2026,4,30,14,0), Date.UTC(2026,4,30,22,0)), // night 05-30, 8h
    sess('n2', Date.UTC(2026,4,31,14,0), Date.UTC(2026,4,31,20,0)), // night 05-31, 6h
  ];
  const s = trendSeries(list, 7, NOW);
  assert.equal(s.length, 2);
  assert.deepEqual(s.map((x) => x.night), ['2026-05-30', '2026-05-31']);
  assert.equal(s[0].efficiency, null);
  assert.equal(s[1].timeInBedMin, 360);
});

test('trendSeries: all-untracked range returns empty', () => {
  assert.deepEqual(trendSeries([], 7, NOW), []);
});

test('rangeSummary: efficiency only over real-awake nights + count', () => {
  const list = [
    sess('n1', Date.UTC(2026,4,30,14,0), Date.UTC(2026,4,30,22,0), { awakeMin: 60 }), // eff known
    sess('n2', Date.UTC(2026,4,31,14,0), Date.UTC(2026,4,31,20,0)),                   // eff null
  ];
  const r = rangeSummary(list, 7, NOW);
  assert.equal(r.nightsTracked, 2);
  assert.equal(r.efficiencyNights, 1);
  assert.notEqual(r.avgEfficiency, null);
  assert.equal(r.best.timeInBedMin, 480);
  assert.equal(r.worst.timeInBedMin, 360);
});

test('rangeSummary: empty range => zeros and null efficiency', () => {
  const r = rangeSummary([], 7, NOW);
  assert.equal(r.nightsTracked, 0);
  assert.equal(r.avgEfficiency, null);
  assert.equal(r.best, null);
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement**

```js
export function trendSeries(sessions, rangeDays, now = Date.now()) {
  const cutoff = now - rangeDays * 24 * 60 * 60 * 1000;
  const inRange = sessions.filter((s) => s.endTs != null && s.startTs >= cutoff);
  const out = [];
  for (const [night, s] of groupByNight(inRange)) {
    out.push({
      night,
      timeInBedMin: timeInBedMin(s),
      totalSleepMin: totalSleepMin(s),
      efficiency: sleepEfficiency(s),
      score: sleepScore(s),
      bedtimeMin: timeOfDayMin(s.startTs, s.tz),
      wakeMin: timeOfDayMin(s.endTs, s.tz),
    });
  }
  out.sort((a, b) => (a.night < b.night ? -1 : a.night > b.night ? 1 : 0));
  return out;
}

export function rangeSummary(sessions, rangeDays, now = Date.now()) {
  const series = trendSeries(sessions, rangeDays, now);
  const nightsTracked = series.length;
  if (nightsTracked === 0) {
    return { avgTimeInBed: 0, avgEfficiency: null, efficiencyNights: 0, best: null, worst: null, nightsTracked: 0 };
  }
  const totalTib = series.reduce((a, s) => a + s.timeInBedMin, 0);
  const effNights = series.filter((s) => s.efficiency != null);
  const avgEfficiency = effNights.length === 0 ? null
    : Math.round(effNights.reduce((a, s) => a + s.efficiency, 0) / effNights.length);
  let best = series[0], worst = series[0];
  for (const s of series) {
    if (s.timeInBedMin > best.timeInBedMin) best = s;
    if (s.timeInBedMin < worst.timeInBedMin) worst = s;
  }
  return { avgTimeInBed: Math.round(totalTib / nightsTracked), avgEfficiency, efficiencyNights: effNights.length, best, worst, nightsTracked };
}
```

- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `git commit -am "feat: trendSeries + rangeSummary (honest efficiency)"`

---

## Task 5: `currentStreak` + `sanitizeGoal`

**Files:** Modify `lib.js`; Test `test/lib.test.mjs`

- [ ] **Step 1: Failing tests**

```js
test('currentStreak: counts consecutive qualifying nights ending at last tracked night', () => {
  const list = [
    sess('a', Date.UTC(2026,4,29,14,0), Date.UTC(2026,4,29,23,0)), // 05-29, 9h ok
    sess('b', Date.UTC(2026,4,30,14,0), Date.UTC(2026,4,30,23,0)), // 05-30, 9h ok
  ];
  // NOW = 06-01 12:00 SGT; tonight (05-31) untracked => start from 05-31's prev = 05-31? anchor=06-01
  assert.equal(currentStreak(list, 480, NOW), 0); // gap on 05-31 breaks immediately
});

test('currentStreak: unlogged tonight does not reset prior run', () => {
  const list = [
    sess('a', Date.UTC(2026,4,30,14,0), Date.UTC(2026,4,30,23,0)), // 05-31? no: night 05-30, 9h
    sess('b', Date.UTC(2026,4,31,14,0), Date.UTC(2026,4,31,23,0)), // night 05-31, 9h
  ];
  const now = Date.UTC(2026, 5, 1, 14, 0); // 06-01 22:00 SGT, tonight (06-01) not logged
  assert.equal(currentStreak(list, 480, now), 2); // 05-31 + 05-30
});

test('currentStreak: below-goal night breaks', () => {
  const list = [
    sess('a', Date.UTC(2026,4,30,14,0), Date.UTC(2026,4,30,23,0)), // 9h ok (05-30)
    sess('b', Date.UTC(2026,4,31,14,0), Date.UTC(2026,4,31,18,0)), // 4h below (05-31)
  ];
  const now = Date.UTC(2026, 5, 1, 14, 0);
  assert.equal(currentStreak(list, 480, now), 0); // most recent night 05-31 below goal
});

test('currentStreak: goal exactly met is inclusive', () => {
  const list = [sess('a', Date.UTC(2026,4,31,14,0), Date.UTC(2026,4,31,22,0))]; // exactly 8h, night 05-31
  const now = Date.UTC(2026, 5, 1, 14, 0);
  assert.equal(currentStreak(list, 480, now), 1);
});

test('currentStreak: excludes running session', () => {
  const list = [sess('a', Date.UTC(2026,4,31,14,0), null)];
  assert.equal(currentStreak(list, 480, NOW), 0);
});

test('sanitizeGoal: clamps, rounds to 5, invalid -> default', () => {
  assert.equal(sanitizeGoal(420), 420);
  assert.equal(sanitizeGoal(7.3 * 60), 440); // 438 -> 440
  assert.equal(sanitizeGoal(5), 60);          // below min -> clamp 60
  assert.equal(sanitizeGoal(2000), 960);      // above max -> 960
  assert.equal(sanitizeGoal('nope'), DEFAULT_GOAL_MIN);
  assert.equal(sanitizeGoal(-10), DEFAULT_GOAL_MIN);
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement**

```js
export function currentStreak(sessions, goalMin, now = Date.now()) {
  const byNight = groupByNight(sessions);
  const qualifies = (night) => {
    const s = byNight.get(night);
    return s != null && timeInBedMin(s) >= goalMin;
  };
  let cursor = nightDate(now); // device-local anchor for "now"
  if (!qualifies(cursor)) cursor = prevNightStr(cursor); // tonight not done yet: don't penalize
  let count = 0;
  while (qualifies(cursor)) { count++; cursor = prevNightStr(cursor); }
  return count;
}

export function sanitizeGoal(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_GOAL_MIN;
  return Math.round(clamp(n, 60, 960) / 5) * 5;
}
```

(`nightDate(now)` is called with `tz` undefined → Intl uses the runtime zone, no throw.)

- [ ] **Step 4: Run — PASS (expect 27 + new ~20 cases all green).**
- [ ] **Step 5: Commit** `git commit -am "feat: currentStreak (anchor=last tracked night) + sanitizeGoal"`

---

## Task 6: HTML — tabs, Trends section, goal dialog

**Files:** Modify `index.html`

- [ ] **Step 1: Add a tab bar** right after `<h1 class="title">`:

```html
    <nav class="tabs" id="tabs">
      <button class="tab active" data-view="home" type="button">Home</button>
      <button class="tab" data-view="trends" type="button">Trends</button>
    </nav>
```

- [ ] **Step 2: Wrap the current Home content.** Put the existing `status`, `night`, `primaryBtn`, `lastCard`, `Last 7 days` card, and `.actions` inside:

```html
    <div class="view" id="homeView"> ... existing home content ... </div>
```

- [ ] **Step 3: Add the Trends view** after the Home view div:

```html
    <div class="view" id="trendsView" hidden>
      <div class="range-toggle" id="rangeToggle">
        <button class="range active" data-range="7" type="button">7d</button>
        <button class="range" data-range="30" type="button">30d</button>
      </div>

      <section class="card">
        <div class="goal-row">
          <span>Goal: <strong id="goalLabel">8h</strong></span>
          <button class="link" id="goalEdit" type="button">✎</button>
        </div>
        <p class="streak" id="streak">🔥 0 nights</p>
      </section>

      <section class="card">
        <h2>Summary</h2>
        <p class="summary" id="trendSummary">No nights tracked yet.</p>
      </section>

      <section class="card">
        <h2>Time in bed</h2>
        <div class="bars" id="durationBars"></div>
      </section>

      <section class="card">
        <h2>Bedtime & wake</h2>
        <div class="drift" id="driftChart"></div>
      </section>
    </div>

    <dialog id="goalDialog">
      <form method="dialog" class="dialog-form">
        <h2>Sleep goal</h2>
        <label>Target hours<input type="number" id="goalHours" min="1" max="16" step="0.5" /></label>
        <menu class="dialog-actions">
          <button value="cancel" type="button" id="goalCancel">Cancel</button>
          <button value="save" id="goalSave">Save</button>
        </menu>
      </form>
    </dialog>
```

- [ ] **Step 4: Sanity-load** — serve and confirm no console errors, tabs visible.

Run: `python3 -m http.server 8765` then open `http://localhost:8765/`.

- [ ] **Step 5: Commit** `git commit -am "feat: trends view markup + tabs + goal dialog"`

---

## Task 7: CSS — tabs, range toggle, bars, drift, goal/streak

**Files:** Modify `style.css` (append; reuse existing `--accent` / card vars)

- [ ] **Step 1: Add styles**

```css
.tabs { display: flex; gap: 8px; justify-content: center; margin: 4px 0 14px; }
.tab { flex: 1; padding: 10px; border-radius: 10px; background: #15151c; color: #aaa; border: none; font: inherit; }
.tab.active { background: var(--accent, #7c5cff); color: #fff; }
.view[hidden] { display: none; }

.range-toggle { display: flex; gap: 6px; justify-content: flex-end; margin-bottom: 10px; }
.range { padding: 6px 12px; border-radius: 8px; background: #15151c; color: #aaa; border: none; }
.range.active { background: var(--accent, #7c5cff); color: #fff; }

.goal-row { display: flex; justify-content: space-between; align-items: center; }
.link { background: none; border: none; color: var(--accent, #7c5cff); font-size: 1.1rem; cursor: pointer; }
.streak { margin: 8px 0 0; font-size: 1.1rem; }

.bars { display: flex; align-items: flex-end; gap: 4px; height: 120px; position: relative; }
.bars .bar { flex: 1; background: var(--accent, #7c5cff); border-radius: 4px 4px 0 0; min-height: 2px; opacity: 0.45; }
.bars .bar.hit { opacity: 1; }
.bars .goal-line { position: absolute; left: 0; right: 0; border-top: 1px dashed #888; }

.drift { display: flex; gap: 2px; }
.drift svg { width: 100%; height: 140px; display: block; }
.drift .dot-bed { fill: #b9a8ff; }
.drift .dot-wake { fill: var(--accent, #7c5cff); }
.drift .link-seg { stroke: #444; stroke-width: 1; }
.summary { line-height: 1.5; }
```

- [ ] **Step 2: Reload, confirm Trends tab styled.**
- [ ] **Step 3: Commit** `git commit -am "feat: trends styles (tabs, bars, drift, goal/streak)"`

---

## Task 8: app.js — wiring, settings, render

**Files:** Modify `app.js`

- [ ] **Step 1: Extend imports** (top of file):

```js
import {
  formatDuration, durationMinutes, getRunningSession, canStart,
  validateEnd, sessionsToCsv, recentStats, formatTimeLeft, sleepScore, scoreBand,
  totalSleepMin, timeInBedMin, sleepEfficiency, bedtimeConsistency, sanitizeAwake,
  DEFAULT_GOAL_MIN, trendSeries, rangeSummary, currentStreak, sanitizeGoal,
} from './lib.js';
```

- [ ] **Step 2: Settings storage** (after the `KEY` const):

```js
const SETTINGS_KEY = 'sleepToggle.settings.v1';
function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { goalMin: sanitizeGoal(raw.goalMin ?? DEFAULT_GOAL_MIN) };
  } catch { return { goalMin: DEFAULT_GOAL_MIN }; }
}
function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }
```

Add state: `let settings = loadSettings();` and `let currentRange = 7;` near the other `let` state.

- [ ] **Step 3: Add element refs** to the `els` object:

```js
  tabs: $('tabs'), homeView: $('homeView'), trendsView: $('trendsView'),
  rangeToggle: $('rangeToggle'), goalLabel: $('goalLabel'), goalEdit: $('goalEdit'),
  streak: $('streak'), trendSummary: $('trendSummary'),
  durationBars: $('durationBars'), driftChart: $('driftChart'),
  goalDialog: $('goalDialog'), goalHours: $('goalHours'),
  goalCancel: $('goalCancel'), goalSave: $('goalSave'),
```

- [ ] **Step 4: View switching + render hook**

```js
function setView(view) {
  els.homeView.hidden = view !== 'home';
  els.trendsView.hidden = view !== 'trends';
  els.tabs.querySelectorAll('.tab').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === view));
  if (view === 'trends') renderTrends();
}
els.tabs.addEventListener('click', (e) => {
  const b = e.target.closest('.tab'); if (b) setView(b.dataset.view);
});
els.rangeToggle.addEventListener('click', (e) => {
  const b = e.target.closest('.range'); if (!b) return;
  currentRange = Number(b.dataset.range);
  els.rangeToggle.querySelectorAll('.range').forEach((x) =>
    x.classList.toggle('active', x === b));
  renderTrends();
});
```

- [ ] **Step 5: renderTrends()**

```js
function hm(min) { return `${Math.floor(min / 60)}:${String(Math.round(min) % 60).padStart(2, '0')}`; }

function renderTrends() {
  const goalMin = settings.goalMin;
  els.goalLabel.textContent = formatDuration(goalMin).replace(' 0m', '');
  const n = currentStreak(sessions, goalMin, Date.now());
  els.streak.textContent = `🔥 ${n} night${n === 1 ? '' : 's'} ≥${(goalMin / 60).toString().replace(/\.0$/, '')}h`;

  const series = trendSeries(sessions, currentRange, Date.now());
  const sum = rangeSummary(sessions, currentRange, Date.now());

  els.trendSummary.textContent = sum.nightsTracked === 0
    ? 'No nights tracked yet.'
    : `${sum.nightsTracked} night${sum.nightsTracked === 1 ? '' : 's'} · avg ${formatDuration(sum.avgTimeInBed)}` +
      ` · best ${formatDuration(sum.best.timeInBedMin)} · worst ${formatDuration(sum.worst.timeInBedMin)}` +
      (sum.avgEfficiency == null ? '' : ` · eff ${sum.avgEfficiency}% (${sum.efficiencyNights} night${sum.efficiencyNights === 1 ? '' : 's'})`);

  // duration bars
  els.durationBars.innerHTML = '';
  const maxMin = Math.max(goalMin, ...series.map((s) => s.timeInBedMin), 1);
  for (const s of series) {
    const bar = document.createElement('div');
    bar.className = 'bar' + (s.timeInBedMin >= goalMin ? ' hit' : '');
    bar.style.height = `${(s.timeInBedMin / maxMin) * 100}%`;
    bar.title = `${s.night}: ${formatDuration(s.timeInBedMin)}`;
    els.durationBars.appendChild(bar);
  }
  const line = document.createElement('div');
  line.className = 'goal-line';
  line.style.bottom = `${(goalMin / maxMin) * 100}%`;
  els.durationBars.appendChild(line);

  renderDrift(series);
}
```

- [ ] **Step 6: renderDrift() — inline SVG** (clock window 18:00 → next-day noon = 1080..2160 min)

```js
function renderDrift(series) {
  els.driftChart.innerHTML = '';
  if (series.length === 0) { els.driftChart.textContent = 'No nights tracked yet.'; return; }
  const W = Math.max(series.length * 28, 60), H = 140, AX0 = 1080, AX1 = 2160; // 18:00..36:00
  const yOf = (min) => {
    let m = min < 12 * 60 ? min + 24 * 60 : min;           // before noon => next day
    m = Math.max(AX0, Math.min(AX1, m));
    return ((m - AX0) / (AX1 - AX0)) * (H - 16) + 8;
  };
  const colW = W / series.length;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  series.forEach((s, i) => {
    const x = colW * (i + 0.5);
    const yb = yOf(s.bedtimeMin), yw = yOf(s.wakeMin);
    const seg = document.createElementNS(svgNS, 'line');
    seg.setAttribute('class', 'link-seg');
    seg.setAttribute('x1', x); seg.setAttribute('x2', x);
    seg.setAttribute('y1', yb); seg.setAttribute('y2', yw);
    svg.appendChild(seg);
    for (const [y, cls] of [[yb, 'dot-bed'], [yw, 'dot-wake']]) {
      const c = document.createElementNS(svgNS, 'circle');
      c.setAttribute('class', cls);
      c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', 4);
      svg.appendChild(c);
    }
  });
  els.driftChart.appendChild(svg);
}
```

- [ ] **Step 7: Goal-edit handlers**

```js
els.goalEdit.addEventListener('click', () => {
  els.goalHours.value = (settings.goalMin / 60).toString();
  els.goalDialog.showModal();
});
els.goalCancel.addEventListener('click', () => els.goalDialog.close());
els.goalSave.addEventListener('click', (e) => {
  e.preventDefault();
  settings = { goalMin: sanitizeGoal(Number(els.goalHours.value) * 60) };
  saveSettings(settings);
  els.goalDialog.close();
  renderTrends();
});
```

- [ ] **Step 8: Run unit tests, then serve & verify**

Run: `node --test test/lib.test.mjs` → all green.
Serve `python3 -m http.server 8765`, open `/`, switch to Trends, toggle 7d/30d, edit goal, confirm bars + drift render and persist after reload.

- [ ] **Step 9: Commit** `git commit -am "feat: trends rendering, goal/streak, view switching"`

---

## Task 9: Build dist + finish branch

- [ ] **Step 1:** `bash tools/build-dist.sh` (regenerates SW cache version).
- [ ] **Step 2:** `node --test test/lib.test.mjs` final green check.
- [ ] **Step 3:** Merge `v3-purple-report` → `main` (via finishing-a-development-branch skill).
- [ ] **Step 4:** Report dist ready for PJ to re-drag to Netlify.

---

## Self-Review

**Spec coverage:** tabs (T6) ✓, range toggle (T6/T8) ✓, range summary w/ honest efficiency (T4) ✓, duration bars + goal line (T7/T8) ✓, SVG drift (T6/T7/T8) ✓, goal control + settings key (T6/T8) ✓, streak (T5/T8) ✓, tz-aware nights + boundaries (T1) ✓, all 7 pure fns ✓, tests enumerated (T1–T5) ✓. CSV untouched ✓.

**Placeholder scan:** none — every code step has full code.

**Type consistency:** `trendSeries` fields (`night, timeInBedMin, totalSleepMin, efficiency, score, bedtimeMin, wakeMin`) match `rangeSummary`/`renderTrends`/`renderDrift` usage. `currentStreak(sessions, goalMin, now)` / `sanitizeGoal(value)` signatures consistent across lib + app. `settings.goalMin` consistent throughout.
