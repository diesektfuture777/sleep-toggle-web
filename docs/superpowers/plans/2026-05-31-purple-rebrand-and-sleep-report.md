# Purple Rebrand + Honest Sleep Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand Sleep Toggle to a purple palette and replace the score line with an honest sleep report (real metrics only — no faked stages), while fixing efficiency-inflation, the wake-dialog dismiss bug, and the manual SW cache bump.

**Architecture:** All new metric math lands in the pure, tested `lib.js`. `app.js` renders a report card and adds a "minutes awake" field with an explicit Save/Skip wake dialog. One CSS token flips orange→purple. `build-dist.sh` auto-versions the SW cache from a content hash.

**Tech Stack:** Vanilla JS (ES modules), HTML, CSS, Canvas. Tests: `node --test`. Build: `tools/build-dist.sh`. Deploy: Netlify (Drop).

---

## File Structure

```
lib.js          — + timeInBedMin, sanitizeAwake, totalSleepMin, sleepEfficiency,
                    bedtimeConsistency; gated sleepScore  (pure, tested)
app.js          — report rendering, awakeMin field, Save/Skip wake dialog, remove dead ref
index.html      — favicon link, report card markup, minutes-awake input + Save/Skip
style.css       — --accent violet, report + asleep/awake bar styles, remove dead rules
tools/make-icons.py  — purple icon colors
tools/build-dist.sh  — content-hash → dist/sw.js cache name
sw.js           — dev placeholder cache name
test/lib.test.mjs    — tests for new metrics + all score branches + guards
README.md       — report metrics + honesty stance
```

---

### Task 1: New pure metrics in `lib.js` (TDD)

**Files:**
- Modify: `lib.js`
- Test: `test/lib.test.mjs`

- [ ] **Step 1: Append failing tests** to `test/lib.test.mjs`:

```js
import {
  timeInBedMin, sanitizeAwake, totalSleepMin, sleepEfficiency, bedtimeConsistency,
} from '../lib.js';

const H = 60 * 60 * 1000;

test('timeInBedMin = minutes between start and end', () => {
  assert.equal(timeInBedMin({ startTs: 0, endTs: 8 * H }), 480);
});

test('sanitizeAwake: null/invalid/negative -> null; clamps to TIB', () => {
  assert.equal(sanitizeAwake(null, 480), null);
  assert.equal(sanitizeAwake('x', 480), null);
  assert.equal(sanitizeAwake(-5, 480), null);
  assert.equal(sanitizeAwake(30, 480), 30);
  assert.equal(sanitizeAwake(600, 480), 480); // clamp to time in bed
  assert.equal(sanitizeAwake(0, 480), 0);      // 0 is a real value, not null
});

test('totalSleepMin subtracts awake; equals TIB when unknown', () => {
  assert.equal(totalSleepMin({ startTs: 0, endTs: 8 * H, awakeMin: 60 }), 420);
  assert.equal(totalSleepMin({ startTs: 0, endTs: 8 * H, awakeMin: null }), 480);
  assert.equal(totalSleepMin({ startTs: 0, endTs: 8 * H }), 480); // missing field
});

test('sleepEfficiency: null when awake unknown, else rounded %', () => {
  assert.equal(sleepEfficiency({ startTs: 0, endTs: 8 * H, awakeMin: null }), null);
  assert.equal(sleepEfficiency({ startTs: 0, endTs: 8 * H, awakeMin: 0 }), 100);
  assert.equal(sleepEfficiency({ startTs: 0, endTs: 8 * H, awakeMin: 60 }), 88); // 420/480
  assert.equal(sleepEfficiency({ startTs: 0, endTs: 8 * H, awakeMin: 600 }), 0); // clamped
});

test('bedtimeConsistency: null with <2 sessions', () => {
  assert.equal(bedtimeConsistency([], Date.now()), null);
  assert.equal(bedtimeConsistency([{ startTs: Date.now(), endTs: Date.now() + H }], Date.now()), null);
});

test('bedtimeConsistency: std dev of bedtimes in minutes (handles past-midnight)', () => {
  // Two bedtimes: 23:00 and 01:00 -> 120 min apart -> stddev 60 (population)
  const day = 24 * H;
  const now = new Date('2026-05-31T12:00:00').getTime();
  const b1 = new Date('2026-05-30T23:00:00').getTime();
  const b2 = new Date('2026-05-31T01:00:00').getTime();
  const sessions = [
    { startTs: b1, endTs: b1 + 7 * H },
    { startTs: b2, endTs: b2 + 7 * H },
  ];
  assert.equal(bedtimeConsistency(sessions, now), 60);
  // sessions older than 7 days are ignored
  const old = { startTs: now - 9 * day, endTs: now - 9 * day + 7 * H };
  assert.equal(bedtimeConsistency([...sessions, old], now), 60);
});
```

- [ ] **Step 2: Run tests, verify new ones fail**

Run: `cd ~/Documents/claude-projects/sleep-toggle-web && node --test`
Expected: FAIL — new functions are not exported.

- [ ] **Step 3: Implement in `lib.js`** — append (note: `durationMinutes` and `clamp` already exist in this file):

```js
export function timeInBedMin(session) {
  return durationMinutes(session.startTs, session.endTs);
}

export function sanitizeAwake(awakeMin, tibMin) {
  const n = Number(awakeMin);
  if (awakeMin === null || awakeMin === undefined || !Number.isFinite(n) || n < 0) return null;
  return Math.min(n, Math.max(tibMin, 0));
}

export function totalSleepMin(session) {
  const tib = timeInBedMin(session);
  const awake = sanitizeAwake(session.awakeMin, tib);
  return Math.max(0, tib - (awake ?? 0));
}

export function sleepEfficiency(session) {
  const tib = timeInBedMin(session);
  const awake = sanitizeAwake(session.awakeMin, tib);
  if (awake === null) return null;
  const tst = Math.max(0, tib - awake);
  return Math.round(clamp(tst / Math.max(tib, 1), 0, 1) * 100);
}

// Std dev (population) of bedtime-of-day over the last 7 days, in minutes.
// Bedtimes before noon are shifted +24h so evening/early-morning cluster correctly.
export function bedtimeConsistency(sessions, now = Date.now(), windowDays = 7) {
  const cutoff = now - windowDays * 24 * 60 * 60 * 1000;
  const recent = sessions.filter((s) => s.endTs != null && s.startTs >= cutoff);
  if (recent.length < 2) return null;
  const mins = recent.map((s) => {
    const d = new Date(s.startTs);
    let m = d.getHours() * 60 + d.getMinutes();
    if (m < 12 * 60) m += 24 * 60;
    return m;
  });
  const mean = mins.reduce((a, b) => a + b, 0) / mins.length;
  const variance = mins.reduce((a, b) => a + (b - mean) ** 2, 0) / mins.length;
  return Math.round(Math.sqrt(variance));
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `node --test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib.js test/lib.test.mjs
git commit -m "feat: honest sleep metrics (TST, efficiency, bedtime consistency)"
```

---

### Task 2: Gated `sleepScore` rewrite (TDD)

**Files:**
- Modify: `lib.js`
- Test: `test/lib.test.mjs`

- [ ] **Step 1: Replace the existing `sleepScore` tests.** In `test/lib.test.mjs`, delete the
five existing `sleepScore: ...` tests (the block from `test('sleepScore: met goal + top rating = 100'`
through `test('sleepScore: oversleep caps duration at 100', ...)`) and replace with:

```js
// score branches: durationScore uses TST vs planned (targetTs-startTs, else 480)
test('sleepScore: eff+rating branch (0.5 dur + 0.3 eff + 0.2 rating)', () => {
  const startTs = 0, targetTs = 8 * H, endTs = 8 * H; // planned 8h, TIB 8h
  // awakeMin 0 -> TST 8h -> dur 100, eff 100; rating 5 -> 100 => 100
  assert.equal(sleepScore({ startTs, endTs, targetTs, awakeMin: 0, rating: 5 }), 100);
  // awakeMin 240 -> TST 4h -> dur 50, eff 50; rating 5 -> 100 => 0.5*50+0.3*50+0.2*100=60
  assert.equal(sleepScore({ startTs, endTs, targetTs, awakeMin: 240, rating: 5 }), 60);
});

test('sleepScore: eff, no rating (0.6 dur + 0.4 eff)', () => {
  const startTs = 0, targetTs = 8 * H, endTs = 8 * H;
  // awakeMin 240 -> dur 50, eff 50 => 50
  assert.equal(sleepScore({ startTs, endTs, targetTs, awakeMin: 240, rating: null }), 50);
});

test('sleepScore: no awake, rating -> v2 formula (0.6 dur + 0.4 rating)', () => {
  const startTs = 0, targetTs = 8 * H, endTs = 4 * H; // dur 50
  // rating 5 -> 100 => 0.6*50 + 0.4*100 = 70
  assert.equal(sleepScore({ startTs, endTs, targetTs, awakeMin: null, rating: 5 }), 70);
});

test('sleepScore: no awake, no rating -> duration only', () => {
  const startTs = 0, targetTs = 8 * H, endTs = 4 * H; // dur 50
  assert.equal(sleepScore({ startTs, endTs, targetTs, awakeMin: null, rating: null }), 50);
});

test('sleepScore: no target falls back to 8h default goal', () => {
  const startTs = 0, endTs = 4 * H; // 4h of default 8h -> dur 50
  assert.equal(sleepScore({ startTs, endTs, targetTs: null, awakeMin: null, rating: null }), 50);
});

test('sleepScore: oversleep + awake>TIB are clamped', () => {
  // planned 6h, slept 9h -> dur capped 100; awake 999>TIB -> TST 0 -> eff 0
  const startTs = 0, targetTs = 6 * H, endTs = 9 * H;
  // dur 100, eff 0, no rating => 0.6*100 + 0.4*0 = 60
  assert.equal(sleepScore({ startTs, endTs, targetTs, awakeMin: 999, rating: null }), 60);
});

test('sleepScore: null for running session', () => {
  assert.equal(sleepScore({ startTs: 0, endTs: null, targetTs: 8 * H }), null);
});
```

- [ ] **Step 2: Run tests, verify the new score tests fail**

Run: `node --test`
Expected: FAIL — current `sleepScore` ignores `awakeMin`/efficiency, so the new expected values differ.

- [ ] **Step 3: Replace `sleepScore` in `lib.js`.** Find the existing function:

```js
export function sleepScore(session) {
  if (session.endTs == null) return null;
  const plannedMin = session.targetTs != null
    ? (session.targetTs - session.startTs) / 60000
    : DEFAULT_GOAL_MIN;
  const safePlanned = plannedMin > 0 ? plannedMin : DEFAULT_GOAL_MIN;
  const actualMin = (session.endTs - session.startTs) / 60000;
  const durationScore = clamp(actualMin / safePlanned, 0, 1) * 100;
  if (session.rating == null) return Math.round(durationScore);
  const ratingScore = (session.rating / 5) * 100;
  return Math.round(0.6 * durationScore + 0.4 * ratingScore);
}
```

Replace with:

```js
export function sleepScore(session) {
  if (session.endTs == null) return null;
  const plannedMin = session.targetTs != null
    ? (session.targetTs - session.startTs) / 60000
    : DEFAULT_GOAL_MIN;
  const safePlanned = plannedMin > 0 ? plannedMin : DEFAULT_GOAL_MIN;

  const tst = totalSleepMin(session);
  const durationScore = clamp(tst / safePlanned, 0, 1) * 100;

  const eff = sleepEfficiency(session);                 // null when awake unknown
  const ratingScore = session.rating == null ? null : (session.rating / 5) * 100;

  if (eff != null && ratingScore != null) {
    return Math.round(0.5 * durationScore + 0.3 * eff + 0.2 * ratingScore);
  }
  if (eff != null) {
    return Math.round(0.6 * durationScore + 0.4 * eff);
  }
  if (ratingScore != null) {
    return Math.round(0.6 * durationScore + 0.4 * ratingScore);
  }
  return Math.round(durationScore);
}
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `node --test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib.js test/lib.test.mjs
git commit -m "feat: gated sleep score (efficiency only when minutes-awake known)"
```

---

### Task 3: Purple rebrand — CSS token + dead-code removal

**Files:**
- Modify: `style.css`

- [ ] **Step 1: Flip the accent + remove dead rules.** In `style.css`, change:

```css
  --accent: #ff6a00;
  --accent-dim: #7a3300;
```

to:

```css
  --accent: #7c5cff;
```

(Deletes the now-unused `--accent-dim`.) Then find and delete the dead `.elapsed` rule:

```css
.elapsed { font-size: 34px; font-weight: 700; margin: 6px 0 0; font-variant-numeric: tabular-nums; }
```

- [ ] **Step 2: Verify no remaining references to the removed tokens**

Run: `cd ~/Documents/claude-projects/sleep-toggle-web && grep -n "accent-dim\|\.elapsed\b" style.css app.js index.html || echo "none"`
Expected: `none`.

- [ ] **Step 3: Commit**

```bash
git add style.css
git commit -m "feat: purple accent rebrand, remove dead CSS"
```

---

### Task 4: Purple app icon

**Files:**
- Modify: `tools/make-icons.py`
- Regenerate: `icons/icon-192.png`, `icons/icon-512.png`

- [ ] **Step 1: Change the icon colors.** In `tools/make-icons.py`, find:

```python
    bg = (10, 10, 15)
    accent = (255, 106, 0)
```

Replace with:

```python
    bg = (10, 10, 15)
    accent = (124, 92, 255)
```

- [ ] **Step 2: Regenerate the icons**

Run: `cd ~/Documents/claude-projects/sleep-toggle-web && python3 tools/make-icons.py && file icons/icon-192.png`
Expected: `wrote ...icon-192.png` / `...icon-512.png`; file reports a 192x192 PNG. Open `icons/icon-192.png` to confirm a violet crescent on dark.

- [ ] **Step 3: Commit**

```bash
git add tools/make-icons.py icons/icon-192.png icons/icon-512.png
git commit -m "feat: purple app icon"
```

---

### Task 5: Report card markup + favicon + wake-dialog field (`index.html`)

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add the favicon link.** Find:

```html
  <link rel="apple-touch-icon" href="icons/icon-192.png" />
```

Insert after it:

```html
  <link rel="icon" href="icons/icon-192.png" />
```

- [ ] **Step 2: Expand the last-session card into a report.** Find the current card:

```html
    <section class="card" id="lastCard" hidden>
      <h2>Last session</h2>
      <div class="last-row">
        <div>
          <p class="last-duration" id="lastDuration">—</p>
          <p class="last-times" id="lastTimes">—</p>
        </div>
        <div class="score" id="scoreBox">
          <span class="score-num" id="scoreNum">—</span>
          <span class="score-band" id="scoreBand">—</span>
        </div>
      </div>
    </section>
```

Replace with:

```html
    <section class="card" id="lastCard" hidden>
      <h2>Last session</h2>
      <div class="last-row">
        <div>
          <p class="last-duration" id="lastDuration">—</p>
          <p class="last-times" id="lastTimes">—</p>
        </div>
        <div class="score" id="scoreBox">
          <span class="score-num" id="scoreNum">—</span>
          <span class="score-band" id="scoreBand">—</span>
        </div>
      </div>
      <dl class="report">
        <div class="report-item">
          <dt>Total sleep</dt><dd id="repTst">—</dd>
        </div>
        <div class="report-item">
          <dt>Efficiency</dt><dd id="repEff">—</dd>
        </div>
        <div class="report-item">
          <dt>Bedtime consistency</dt><dd id="repConsistency">—</dd>
        </div>
      </dl>
      <div class="awake-bar" id="awakeBar" hidden>
        <div class="awake-bar-asleep" id="awakeBarAsleep"></div>
        <div class="awake-bar-awake" id="awakeBarAwake"></div>
      </div>
      <p class="awake-legend" id="awakeLegend" hidden>Asleep vs awake</p>
    </section>
```

- [ ] **Step 3: Add the minutes-awake field + Save/Skip to the wake dialog.** Find:

```html
  <!-- Wake check-in dialog -->
  <dialog id="wakeDialog">
    <form method="dialog" class="dialog-form">
      <h2>How did you sleep?</h2>
      <div class="rating" id="ratingRow">
        <button type="button" data-rating="1">1</button>
        <button type="button" data-rating="2">2</button>
        <button type="button" data-rating="3">3</button>
        <button type="button" data-rating="4">4</button>
        <button type="button" data-rating="5">5</button>
      </div>
      <textarea id="wakeNote" placeholder="Optional note…" rows="3"></textarea>
      <menu class="dialog-actions">
        <button value="save" id="wakeSave">Save</button>
      </menu>
    </form>
  </dialog>
```

Replace with:

```html
  <!-- Wake check-in dialog -->
  <dialog id="wakeDialog">
    <form method="dialog" class="dialog-form">
      <h2>How did you sleep?</h2>
      <div class="rating" id="ratingRow">
        <button type="button" data-rating="1">1</button>
        <button type="button" data-rating="2">2</button>
        <button type="button" data-rating="3">3</button>
        <button type="button" data-rating="4">4</button>
        <button type="button" data-rating="5">5</button>
      </div>
      <label>Minutes awake (optional)<input type="number" id="wakeAwake" min="0" inputmode="numeric" placeholder="e.g. 20" /></label>
      <textarea id="wakeNote" placeholder="Optional note…" rows="3"></textarea>
      <menu class="dialog-actions">
        <button value="skip" type="button" id="wakeSkip">Skip</button>
        <button value="save" id="wakeSave">Save</button>
      </menu>
    </form>
  </dialog>
```

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: sleep report markup, favicon, minutes-awake + Save/Skip"
```

---

### Task 6: Report + asleep/awake bar styles (`style.css`)

**Files:**
- Modify: `style.css`

- [ ] **Step 1: Append report styles** to `style.css`:

```css
/* ---- Sleep report ---- */
.report { display: flex; gap: 10px; margin: 14px 0 0; padding: 0; }
.report-item { flex: 1; }
.report dt { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.report dd { margin: 4px 0 0; font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; }

.awake-bar { display: flex; height: 10px; border-radius: 6px; overflow: hidden; margin-top: 14px; background: #2a2a36; }
.awake-bar-asleep { background: var(--accent); }
.awake-bar-awake { background: #3a3a48; }
.awake-legend { font-size: 11px; color: var(--muted); margin: 6px 0 0; text-transform: uppercase; letter-spacing: 0.06em; }
```

- [ ] **Step 2: Commit**

```bash
git add style.css
git commit -m "feat: sleep report + asleep/awake bar styles"
```

---

### Task 7: Wire report + awakeMin + Save/Skip in `app.js`

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Update imports.** Find the `lib.js` import block and replace:

```js
import {
  formatDuration, durationMinutes, getRunningSession, canStart,
  validateEnd, sessionsToCsv, recentStats, formatTimeLeft, sleepScore, scoreBand,
} from './lib.js';
```

with:

```js
import {
  formatDuration, durationMinutes, getRunningSession, canStart,
  validateEnd, sessionsToCsv, recentStats, formatTimeLeft, sleepScore, scoreBand,
  totalSleepMin, timeInBedMin, sleepEfficiency, bedtimeConsistency, sanitizeAwake,
} from './lib.js';
```

- [ ] **Step 2: Update element refs.** In the `els` object, replace this line:

```js
  scoreBox: $('scoreBox'), scoreNum: $('scoreNum'), scoreBand: $('scoreBand'),
```

with:

```js
  scoreBox: $('scoreBox'), scoreNum: $('scoreNum'), scoreBand: $('scoreBand'),
  repTst: $('repTst'), repEff: $('repEff'), repConsistency: $('repConsistency'),
  awakeBar: $('awakeBar'), awakeBarAsleep: $('awakeBarAsleep'),
  awakeBarAwake: $('awakeBarAwake'), awakeLegend: $('awakeLegend'),
  wakeAwake: $('wakeAwake'), wakeSkip: $('wakeSkip'),
```

And in the same `els` object, remove the now-unused `wakeSave: $('wakeSave'),` entry (the Save
button is handled via the form's `returnValue`, not a direct ref).

- [ ] **Step 3: Render the report.** Find the last-session block in `render()`:

```js
  const last = lastCompleted();
  if (last) {
    els.lastCard.hidden = false;
    els.lastDuration.textContent = formatDuration(durationMinutes(last.startTs, last.endTs));
    els.lastTimes.textContent = `${fmtTime(last.startTs)} → ${fmtTime(last.endTs)} · ${last.tz}`;
    const score = sleepScore(last);
    els.scoreNum.textContent = score;
    els.scoreBand.textContent = scoreBand(score);
  } else {
    els.lastCard.hidden = true;
  }
```

Replace with:

```js
  const last = lastCompleted();
  if (last) {
    els.lastCard.hidden = false;
    els.lastDuration.textContent = formatDuration(durationMinutes(last.startTs, last.endTs));
    els.lastTimes.textContent = `${fmtTime(last.startTs)} → ${fmtTime(last.endTs)} · ${last.tz}`;
    const score = sleepScore(last);
    els.scoreNum.textContent = score;
    els.scoreBand.textContent = scoreBand(score);

    els.repTst.textContent = formatDuration(totalSleepMin(last));

    const eff = sleepEfficiency(last);
    els.repEff.textContent = eff == null ? '—' : `${eff}%`;

    const consistency = bedtimeConsistency(sessions, Date.now());
    els.repConsistency.textContent = consistency == null ? '—' : `±${consistency} min`;

    const tib = timeInBedMin(last);
    const awake = sanitizeAwake(last.awakeMin, tib);
    if (awake != null && tib > 0) {
      const asleepPct = Math.max(0, Math.min(100, ((tib - awake) / tib) * 100));
      els.awakeBarAsleep.style.width = `${asleepPct}%`;
      els.awakeBarAwake.style.width = `${100 - asleepPct}%`;
      els.awakeBar.hidden = false;
      els.awakeLegend.hidden = false;
    } else {
      els.awakeBar.hidden = true;
      els.awakeLegend.hidden = true;
    }
  } else {
    els.lastCard.hidden = true;
  }
```

- [ ] **Step 4: Reset the awake field when opening the wake dialog.** Find `openWakeDialog`:

```js
function openWakeDialog(session) {
  pendingRating = null;
  els.wakeNote.value = '';
  els.ratingRow.querySelectorAll('button').forEach((b) => b.classList.remove('selected'));
  els.wakeDialog._session = session;
  els.wakeDialog.showModal();
}
```

Replace with:

```js
function openWakeDialog(session) {
  pendingRating = null;
  els.wakeNote.value = '';
  els.wakeAwake.value = '';
  els.ratingRow.querySelectorAll('button').forEach((b) => b.classList.remove('selected'));
  els.wakeDialog._session = session;
  els.wakeDialog.showModal();
}
```

- [ ] **Step 5: Gate the wake dialog save on explicit Save (fix dismiss bug).** Find the close
listener:

```js
els.wakeDialog.addEventListener('close', () => {
  const session = els.wakeDialog._session;
  if (!session) return;
  session.rating = pendingRating;
  session.note = els.wakeNote.value.trim();
  session.updatedAt = Date.now();
  els.wakeDialog._session = null;
  save(sessions);
  render();
});
```

Replace with:

```js
els.wakeSkip.addEventListener('click', () => els.wakeDialog.close('skip'));
els.wakeDialog.addEventListener('close', () => {
  const session = els.wakeDialog._session;
  els.wakeDialog._session = null;
  if (!session) return;
  if (els.wakeDialog.returnValue !== 'save') { render(); return; } // Esc/backdrop/Skip: don't write
  session.rating = pendingRating;
  session.note = els.wakeNote.value.trim();
  const tib = timeInBedMin(session);
  session.awakeMin = sanitizeAwake(els.wakeAwake.value === '' ? null : els.wakeAwake.value, tib);
  session.updatedAt = Date.now();
  save(sessions);
  render();
});
```

- [ ] **Step 6: Run unit tests (guard against breakage)**

Run: `node --test`
Expected: all PASS (app.js edits don't touch lib logic).

- [ ] **Step 7: Commit**

```bash
git add app.js
git commit -m "feat: render sleep report, awakeMin capture, save-only wake dialog"
```

---

### Task 8: Auto-versioned SW cache

**Files:**
- Modify: `sw.js`
- Modify: `tools/build-dist.sh`

- [ ] **Step 1: Set the dev placeholder in `sw.js`.** Change:

```js
const CACHE = 'sleep-toggle-v4';
```

to:

```js
const CACHE = 'sleep-toggle-dev';
```

- [ ] **Step 2: Hash assets into the dist SW cache name.** In `tools/build-dist.sh`, find:

```bash
echo "dist/ ready:"
find dist -type f | sort
```

Replace with:

```bash
# Auto-version the service worker cache from a content hash of the runtime assets
# (everything except sw.js, to avoid a circular hash).
HASH=$(cat dist/index.html dist/app.js dist/lib.js dist/liquid.js dist/style.css \
  dist/manifest.json dist/icons/icon-192.png dist/icons/icon-512.png \
  | shasum | cut -c1-10)
# Portable in-place sed (works on macOS BSD sed).
sed -i '' "s/sleep-toggle-dev/sleep-toggle-${HASH}/" dist/sw.js

echo "dist/ ready (cache: sleep-toggle-${HASH}):"
find dist -type f | sort
```

- [ ] **Step 3: Rebuild and verify the cache name is injected**

Run: `cd ~/Documents/claude-projects/sleep-toggle-web && ./tools/build-dist.sh && grep CACHE dist/sw.js`
Expected: output shows `const CACHE = 'sleep-toggle-<10-hex-chars>';` (NOT `-dev`).

- [ ] **Step 4: Commit**

```bash
git add sw.js tools/build-dist.sh
git commit -m "feat: auto-version SW cache from content hash in build-dist"
```

---

### Task 9: README + browser verification + deploy build

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the "Sleep screen & score" section.** In `README.md`, find the line:

```
Bands: 85+ Great · 70+ Good · 50+ Fair · else Poor.
```

Insert after it:

```markdown

### Sleep report (v3)

After waking you see an honest report — real metrics only:

- **Total Sleep Time** = time in bed − minutes awake.
- **Efficiency** = total sleep ÷ time in bed, shown only when you enter "minutes awake" at the
  wake check-in (otherwise `—`).
- **Asleep vs Awake** bar — shown when minutes awake is provided.
- **Bedtime consistency** = ±std-dev of your bedtime over the last 7 days (needs ≥2 sessions).

**No sleep stages.** Light/Deep/REM can't be measured with a manual toggle, so they are
deliberately omitted rather than faked.

Score weights: with minutes-awake + rating → `0.5×duration + 0.3×efficiency + 0.2×rating`;
with minutes-awake only → `0.6×duration + 0.4×efficiency`; without minutes-awake →
`0.6×duration + 0.4×rating` (or duration only if unrated).
```

Then add `awakeMin` to the data-model table — find:

```
| `targetTs` | number \| null | planned wake time (ms epoch); null for v1 sessions |
```

and insert after it:

```
| `awakeMin` | number \| null | minutes awake during the night; null = not provided |
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document v3 sleep report and no-stages stance"
```

- [ ] **Step 3: Full unit run**

Run: `node --test`
Expected: all PASS.

- [ ] **Step 4: Browser verification (Playwright MCP + screenshots, interactive)**

Serve and drive `http://localhost:8123` (clear SW/caches between reloads to bypass cache-first):
1. Idle screen: **Start Sleep** button is **purple**; score/stats purple. Screenshot.
2. Start → night view (already purple) → reload mid-sleep persists.
3. End → wake dialog: enter rating 4, **Minutes awake = 60**, Save → report shows Total sleep,
   **Efficiency** (e.g. ~88%), the **asleep/awake bar**, and (after a 2nd session) consistency.
4. End a second session with **Skip** (or Esc) → confirm rating/note/awakeMin are NOT written
   (score reflects duration-only); report Efficiency shows `—`, no asleep/awake bar.
5. Edit a session → report + score recompute.
6. Console: 0 errors (favicon 404 gone).

Expected: all behaviors as described; screenshots confirm purple + report.

- [ ] **Step 5: Build the deploy folder**

Run: `./tools/build-dist.sh && grep CACHE dist/sw.js`
Expected: `dist/` rebuilt with a fresh `sleep-toggle-<hash>` cache name. (User re-drags `dist/`
to Netlify Drop to deploy.)

---

## Self-Review

**Spec coverage:**
- Purple rebrand (token, icon, favicon, dead-code) → Tasks 3,4,5(Step1). ✓
- Honest report (Score, TST, Efficiency-when-known, asleep/awake bar, consistency; NO stages) → Tasks 1 (metrics), 5 (markup), 6 (styles), 7 (render). ✓
- Wake check-in: minutes-awake field + Save/Skip no-save-on-dismiss → Tasks 5 (markup), 7 (Steps 4,5). ✓
- Gated score formula (4 branches) → Task 2. ✓
- Math guards (awake>TIB, negative, non-numeric, TIB≤0) → Task 1 `sanitizeAwake`/`sleepEfficiency` + tests. ✓
- Data model `awakeMin` backward compatible → Task 7 (writes), Task 1 (reads tolerate null/missing). ✓
- Auto-versioned SW cache → Task 8. ✓
- README + honesty stance → Task 9. ✓
- `lib.js` stays pure → Tasks 1,2 add only pure functions. ✓

**Placeholder scan:** No TBD/TODO; all code/commands concrete. ✓

**Type consistency:** New exports (`timeInBedMin`, `sanitizeAwake`, `totalSleepMin`, `sleepEfficiency`, `bedtimeConsistency`) defined in Task 1, imported in Task 7. `sleepScore` signature unchanged (takes session) — Task 2 rewrite, callers in Task 7 unchanged. Element ids in Task 5 markup (`repTst`, `repEff`, `repConsistency`, `awakeBar`, `awakeBarAsleep`, `awakeBarAwake`, `awakeLegend`, `wakeAwake`, `wakeSkip`) all match `els` refs in Task 7 Step 2. Removed `wakeSave` ref (Task 7) — the Save button still exists in markup and works via form `returnValue`. `sanitizeAwake` used consistently in lib + app. ✓

No gaps found.
