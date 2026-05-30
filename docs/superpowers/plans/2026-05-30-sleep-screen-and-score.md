# Sleep Screen + Sleep Score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Pillow-inspired sleeping screen (big live clock, countdown to a chosen wake time, liquid wave animation) and a derived Sleep Score (0–100), staying 100% vanilla JS.

**Architecture:** Extend the pure core `lib.js` with countdown/score functions (unit-tested). Add a self-contained Canvas animation module `liquid.js`. Wire a wake-time picker + night view into `app.js`/`index.html`/`style.css`. New `targetTs` field on sessions, backward compatible.

**Tech Stack:** Vanilla JS (ES modules), HTML, CSS, Canvas 2D. Tests: `node --test`. Local: `python3 -m http.server`.

---

## File Structure

```
lib.js          — + formatTimeLeft, sleepScore, scoreBand, DEFAULT_GOAL_MIN  (pure, tested)
liquid.js       — NEW: Canvas wave animation (start/stop/setProgress)
app.js          — wake-time picker, night view, score rendering, liquid wiring
index.html      — night-view markup, wake-time dialog, score elements
style.css       — night view + score styles, large clock treatment
test/lib.test.mjs — + tests for the 3 new pure functions
README.md       — wake target, score formula, no-real-alarm caveat
```

---

### Task 1: Pure logic — `formatTimeLeft`, `sleepScore`, `scoreBand` (TDD)

**Files:**
- Modify: `lib.js`
- Test: `test/lib.test.mjs`

- [ ] **Step 1: Add failing tests** — append to `test/lib.test.mjs`:

```js
import {
  formatTimeLeft, sleepScore, scoreBand, DEFAULT_GOAL_MIN,
} from '../lib.js';

test('DEFAULT_GOAL_MIN is 8 hours', () => {
  assert.equal(DEFAULT_GOAL_MIN, 480);
});

test('formatTimeLeft: hours + minutes', () => {
  assert.equal(formatTimeLeft((9 * 60 + 39) * 60 * 1000), '9 hours 39 min left');
});

test('formatTimeLeft: singular hour, minutes only, and past', () => {
  assert.equal(formatTimeLeft((1 * 60 + 1) * 60 * 1000), '1 hour 1 min left');
  assert.equal(formatTimeLeft(39 * 60 * 1000), '39 min left');
  assert.equal(formatTimeLeft(0), 'Past wake time');
  assert.equal(formatTimeLeft(-5000), 'Past wake time');
});

test('sleepScore: met goal + top rating = 100', () => {
  const startTs = 0;
  const targetTs = 8 * 60 * 60 * 1000;     // 8h planned
  const endTs = 8 * 60 * 60 * 1000;        // slept exactly 8h
  assert.equal(sleepScore({ startTs, endTs, targetTs, rating: 5 }), 100);
});

test('sleepScore: under goal blends duration + rating', () => {
  const startTs = 0;
  const targetTs = 8 * 60 * 60 * 1000;     // planned 8h
  const endTs = 4 * 60 * 60 * 1000;        // slept 4h -> durationScore 50
  // rating 5 -> ratingScore 100; 0.6*50 + 0.4*100 = 70
  assert.equal(sleepScore({ startTs, endTs, targetTs, rating: 5 }), 70);
});

test('sleepScore: no rating uses duration only', () => {
  const startTs = 0;
  const targetTs = 10 * 60 * 60 * 1000;    // planned 10h
  const endTs = 5 * 60 * 60 * 1000;        // slept 5h -> 50
  assert.equal(sleepScore({ startTs, endTs, targetTs, rating: null }), 50);
});

test('sleepScore: no target falls back to 8h default goal', () => {
  const startTs = 0;
  const endTs = 4 * 60 * 60 * 1000;        // 4h of 8h default -> 50, no rating
  assert.equal(sleepScore({ startTs, endTs, targetTs: null, rating: null }), 50);
});

test('sleepScore: oversleep caps duration at 100', () => {
  const startTs = 0;
  const targetTs = 6 * 60 * 60 * 1000;     // planned 6h
  const endTs = 9 * 60 * 60 * 1000;        // slept 9h -> capped 100
  assert.equal(sleepScore({ startTs, endTs, targetTs, rating: null }), 100);
});

test('scoreBand boundaries', () => {
  assert.equal(scoreBand(85), 'Great');
  assert.equal(scoreBand(84), 'Good');
  assert.equal(scoreBand(70), 'Good');
  assert.equal(scoreBand(69), 'Fair');
  assert.equal(scoreBand(50), 'Fair');
  assert.equal(scoreBand(49), 'Poor');
});
```

- [ ] **Step 2: Run tests, verify new ones fail**

Run: `cd ~/Documents/claude-projects/sleep-toggle-web && node --test`
Expected: FAIL — `formatTimeLeft`/`sleepScore`/`scoreBand`/`DEFAULT_GOAL_MIN` are not exported.

- [ ] **Step 3: Implement in `lib.js`** — append:

```js
export const DEFAULT_GOAL_MIN = 480; // 8 hours

export function formatTimeLeft(ms) {
  if (ms <= 0) return 'Past wake time';
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min left`;
  const hourWord = h === 1 ? 'hour' : 'hours';
  return `${h} ${hourWord} ${m} min left`;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

export function sleepScore(session) {
  if (session.endTs == null) return null;
  const plannedMin = session.targetTs != null
    ? (session.targetTs - session.startTs) / 60000
    : DEFAULT_GOAL_MIN;
  const actualMin = (session.endTs - session.startTs) / 60000;
  const safePlanned = plannedMin > 0 ? plannedMin : DEFAULT_GOAL_MIN;
  const durationScore = clamp(actualMin / safePlanned, 0, 1) * 100;
  if (session.rating == null) return Math.round(durationScore);
  const ratingScore = (session.rating / 5) * 100;
  return Math.round(0.6 * durationScore + 0.4 * ratingScore);
}

export function scoreBand(n) {
  if (n >= 85) return 'Great';
  if (n >= 70) return 'Good';
  if (n >= 50) return 'Fair';
  return 'Poor';
}
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `node --test`
Expected: all PASS (9 original + new).

- [ ] **Step 5: Commit**

```bash
git add lib.js test/lib.test.mjs
git commit -m "feat: countdown formatting + sleep score in lib.js"
```

---

### Task 2: Liquid wave animation module (`liquid.js`)

**Files:**
- Create: `liquid.js`

This is a Canvas visual; correctness is verified in-browser (Task 5), not unit-tested. Keep it
self-contained with a tiny interface: `start(canvas)`, `stop()`, `setProgress(0..1)`.

- [ ] **Step 1: Write `liquid.js`**

```js
// Self-contained liquid wave animation on a <canvas>.
// Interface: start(canvas), setProgress(fraction 0..1), stop().

let raf = null;
let ctx = null;
let canvasEl = null;
let progress = 0;     // 0..1 target fill
let shown = 0;        // eased fill actually drawn
let t = 0;

function resize() {
  if (!canvasEl) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvasEl.clientWidth || 320;
  const h = canvasEl.clientHeight || 320;
  canvasEl.width = Math.round(w * dpr);
  canvasEl.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function draw() {
  const w = canvasEl.clientWidth || 320;
  const h = canvasEl.clientHeight || 320;
  ctx.clearRect(0, 0, w, h);

  shown += (progress - shown) * 0.05;            // ease toward target
  const level = h * (1 - shown);                 // y of the waterline
  t += 0.03;

  const layers = [
    { amp: 10, len: 1.2, speed: 1.0, alpha: 0.85, color: '255,106,0' },
    { amp: 14, len: 0.8, speed: -0.7, alpha: 0.45, color: '255,140,60' },
  ];

  for (const L of layers) {
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 6) {
      const y = level + Math.sin(x * 0.01 * L.len + t * L.speed) * L.amp;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = `rgba(${L.color},${L.alpha})`;
    ctx.fill();
  }

  raf = requestAnimationFrame(draw);
}

export function start(canvas) {
  stop();
  canvasEl = canvas;
  ctx = canvas.getContext('2d');
  window.addEventListener('resize', resize);
  resize();
  raf = requestAnimationFrame(draw);
}

export function setProgress(fraction) {
  progress = Math.min(1, Math.max(0, fraction || 0));
}

export function stop() {
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  window.removeEventListener('resize', resize);
}
```

- [ ] **Step 2: Commit**

```bash
git add liquid.js
git commit -m "feat: self-contained liquid wave canvas animation"
```

---

### Task 3: Night-view markup + wake-time dialog + score elements (`index.html`)

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Replace the `<section class="status">` + primary button block**

Find in `index.html`:

```html
    <section class="status" id="status">
      <p class="status-line" id="statusLine">Not sleeping</p>
      <p class="elapsed" id="elapsed" hidden></p>
    </section>

    <button class="primary" id="primaryBtn" type="button">Start Sleep</button>
```

Replace with:

```html
    <section class="status" id="status">
      <p class="status-line" id="statusLine">Not sleeping</p>
    </section>

    <section class="night" id="night" hidden>
      <canvas class="liquid" id="liquid"></canvas>
      <div class="night-readout">
        <p class="clock" id="clock">—</p>
        <p class="countdown" id="countdown">—</p>
        <p class="alarm" id="alarm">—</p>
      </div>
    </section>

    <button class="primary" id="primaryBtn" type="button">Start Sleep</button>
```

- [ ] **Step 2: Add a score element to the last-session card**

Find:

```html
    <section class="card" id="lastCard" hidden>
      <h2>Last session</h2>
      <p class="last-duration" id="lastDuration">—</p>
      <p class="last-times" id="lastTimes">—</p>
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
    </section>
```

- [ ] **Step 3: Add the wake-time picker dialog** — insert just before `<!-- Wake check-in dialog -->`:

```html
  <!-- Wake-time picker (shown on Start Sleep) -->
  <dialog id="wakeTimeDialog">
    <form method="dialog" class="dialog-form">
      <h2>Set wake-up time</h2>
      <label>Wake at<input type="time" id="wakeTime" /></label>
      <menu class="dialog-actions">
        <button value="cancel" type="button" id="wakeTimeCancel">Cancel</button>
        <button value="start" id="wakeTimeStart">Start Sleep</button>
      </menu>
    </form>
  </dialog>
```

- [ ] **Step 4: Add the `liquid.js` import** — find:

```html
  <script type="module" src="app.js"></script>
```

Leave it as-is (app.js imports liquid.js itself). No change needed here; this step is a no-op
confirmation that `app.js` is the single entry module.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: night-view markup, wake-time picker, score elements"
```

---

### Task 4: Night-view + score styling (`style.css`)

**Files:**
- Modify: `style.css`

- [ ] **Step 1: Append night-view, clock, score styles**

```css
/* ---- Night view ---- */
.night {
  position: relative;
  height: 300px;
  border-radius: var(--radius);
  overflow: hidden;
  background: #07070c;
  display: flex;
  align-items: center;
  justify-content: center;
}
.night .liquid {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.night-readout { position: relative; text-align: center; z-index: 1; }
.clock {
  font-size: 64px;
  font-weight: 200;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  margin: 0;
  text-shadow: 0 2px 24px rgba(0,0,0,0.6);
}
.countdown {
  font-size: 18px;
  font-weight: 600;
  margin: 6px 0 0;
  color: var(--text);
  text-shadow: 0 1px 12px rgba(0,0,0,0.6);
}
.alarm {
  font-size: 13px;
  color: var(--muted);
  margin: 8px 0 0;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

/* ---- Sleep score ---- */
.last-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.score { display: flex; flex-direction: column; align-items: center; min-width: 72px; }
.score-num { font-size: 34px; font-weight: 700; line-height: 1; color: var(--accent); font-variant-numeric: tabular-nums; }
.score-band { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-top: 2px; }
.history li .score-mini { color: var(--accent); font-weight: 600; margin-left: 10px; }
```

- [ ] **Step 2: Commit**

```bash
git add style.css
git commit -m "feat: night view + sleep score styles"
```

---

### Task 5: Wire it up in `app.js`

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Update imports** — replace the import block at the top of `app.js`:

```js
import {
  formatDuration, durationMinutes, getRunningSession, canStart,
  validateEnd, sessionsToCsv, recentStats,
} from './lib.js';
```

with:

```js
import {
  formatDuration, durationMinutes, getRunningSession, canStart,
  validateEnd, sessionsToCsv, recentStats, formatTimeLeft, sleepScore, scoreBand,
} from './lib.js';
import * as liquid from './liquid.js';
```

- [ ] **Step 2: Add new element refs** — in the `const els = { ... }` object, add these entries
(append inside the object, before the closing `};`):

```js
  night: $('night'), liquid: $('liquid'), clock: $('clock'),
  countdown: $('countdown'), alarm: $('alarm'),
  scoreBox: $('scoreBox'), scoreNum: $('scoreNum'), scoreBand: $('scoreBand'),
  wakeTimeDialog: $('wakeTimeDialog'), wakeTime: $('wakeTime'),
  wakeTimeCancel: $('wakeTimeCancel'), wakeTimeStart: $('wakeTimeStart'),
```

- [ ] **Step 3: Add wake-time helpers** — add after the existing `fromLocalInput` function:

```js
// Default wake time = last used, else now + 8h, rounded to nearest 5 min.
function defaultWakeValue() {
  const last = [...sessions].reverse().find((s) => s.targetTs != null);
  if (last) {
    const d = new Date(last.targetTs);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  d.setMinutes(Math.round(d.getMinutes() / 5) * 5, 0, 0);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Turn a "HH:MM" wall-clock string into the next future timestamp for that time.
function wakeStringToTs(value, fromTs) {
  const [h, m] = value.split(':').map(Number);
  const d = new Date(fromTs);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= fromTs) d.setDate(d.getDate() + 1); // earlier than now => tomorrow
  return d.getTime();
}
```

- [ ] **Step 4: Replace `startSleep` and the night rendering**

Replace the existing `startSleep` function:

```js
function startSleep() {
  if (!canStart(sessions)) { toast('A sleep session is already running.'); return; }
  const now = Date.now();
  sessions.push({
    id: newId(), startTs: now, endTs: null, tz: tzLabel(),
    rating: null, note: '', createdAt: now, updatedAt: now,
  });
  save(sessions);
  render();
}
```

with a version that opens the wake-time picker first, plus a committed-start helper:

```js
function startSleep() {
  if (!canStart(sessions)) { toast('A sleep session is already running.'); return; }
  els.wakeTime.value = defaultWakeValue();
  els.wakeTimeDialog.showModal();
}

function commitStart(targetTs) {
  const now = Date.now();
  sessions.push({
    id: newId(), startTs: now, endTs: null, targetTs, tz: tzLabel(),
    rating: null, note: '', createdAt: now, updatedAt: now,
  });
  save(sessions);
  render();
}
```

- [ ] **Step 5: Replace the elapsed-timer logic with the night-view updater**

Replace the `startElapsed` / `stopElapsed` functions:

```js
function startElapsed(startTs) {
  const tick = () => {
    els.elapsed.textContent = formatDuration(durationMinutes(startTs, Date.now()));
  };
  tick();
  stopElapsed();
  elapsedTimer = setInterval(tick, 30000);
}
function stopElapsed() {
  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
}
```

with the night-view driver (live clock + countdown + liquid progress):

```js
function startNight(session) {
  els.night.hidden = false;
  liquid.start(els.liquid);
  const tick = () => {
    const now = Date.now();
    els.clock.textContent = new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (session.targetTs != null) {
      els.countdown.textContent = formatTimeLeft(session.targetTs - now);
      els.alarm.textContent = `Alarm · ${new Date(session.targetTs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      const planned = session.targetTs - session.startTs;
      liquid.setProgress(planned > 0 ? (now - session.startTs) / planned : 0);
    } else {
      els.countdown.textContent = formatDuration(durationMinutes(session.startTs, now));
      els.alarm.textContent = 'No alarm set';
      liquid.setProgress(0);
    }
  };
  tick();
  stopNight();
  elapsedTimer = setInterval(tick, 1000);
}
function stopNight() {
  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
  liquid.stop();
  els.night.hidden = true;
}
```

- [ ] **Step 6: Update `render()` to use the night view + score**

In `render()`, replace this running/not-running block:

```js
  if (running) {
    els.status.classList.add('sleeping');
    els.statusLine.textContent = 'Sleeping…';
    els.primary.textContent = "I'm Awake";
    els.primary.classList.add('sleeping');
    els.elapsed.hidden = false;
    startElapsed(running.startTs);
  } else {
    els.status.classList.remove('sleeping');
    els.statusLine.textContent = 'Not sleeping';
    els.primary.textContent = 'Start Sleep';
    els.primary.classList.remove('sleeping');
    els.elapsed.hidden = true;
    stopElapsed();
  }
```

with:

```js
  if (running) {
    els.status.classList.add('sleeping');
    els.statusLine.textContent = 'Sleeping…';
    els.primary.textContent = "I'm Awake";
    els.primary.classList.add('sleeping');
    startNight(running);
  } else {
    els.status.classList.remove('sleeping');
    els.statusLine.textContent = 'Not sleeping';
    els.primary.textContent = 'Start Sleep';
    els.primary.classList.remove('sleeping');
    stopNight();
  }
```

And in the same `render()`, replace the last-session block:

```js
  const last = lastCompleted();
  if (last) {
    els.lastCard.hidden = false;
    els.lastDuration.textContent = formatDuration(durationMinutes(last.startTs, last.endTs));
    els.lastTimes.textContent = `${fmtTime(last.startTs)} → ${fmtTime(last.endTs)} · ${last.tz}`;
  } else {
    els.lastCard.hidden = true;
  }
```

with one that also fills the score:

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

And in the history loop, add a score chip — replace:

```js
    const dur = document.createElement('span');
    dur.className = 'dur';
    dur.textContent = formatDuration(durationMinutes(s.startTs, s.endTs));
    li.append(when, dur);
```

with:

```js
    const dur = document.createElement('span');
    dur.className = 'dur';
    dur.textContent = formatDuration(durationMinutes(s.startTs, s.endTs));
    const sc = document.createElement('span');
    sc.className = 'score-mini';
    sc.textContent = sleepScore(s);
    const right = document.createElement('span');
    right.append(dur, sc);
    li.append(when, right);
```

- [ ] **Step 7: Wire the wake-time dialog** — add near the other dialog wiring (after the edit-dialog
listeners, before `// ---------- export ----------`):

```js
els.wakeTimeCancel.addEventListener('click', () => els.wakeTimeDialog.close('cancel'));
els.wakeTimeDialog.addEventListener('close', () => {
  if (els.wakeTimeDialog.returnValue !== 'start') return;
  const value = els.wakeTime.value;
  if (!value) { toast('Pick a wake-up time.'); return; }
  commitStart(wakeStringToTs(value, Date.now()));
});
```

- [ ] **Step 8: Remove the now-unused elapsed ref**

In the `els` object, delete the line `elapsed: $('elapsed'),` (the element no longer exists).
Confirm no other code references `els.elapsed` (the old `startElapsed`/`stopElapsed` were replaced
in Step 5).

- [ ] **Step 9: Run unit tests (guard against breakage)**

Run: `node --test`
Expected: all PASS (logic unchanged by app.js edits).

- [ ] **Step 10: Commit**

```bash
git add app.js
git commit -m "feat: wake-time picker, night view, sleep score wiring"
```

---

### Task 6: README + browser verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update `README.md`** — add a "Sleep screen & score" section after the "## Data model"
section:

````markdown
## Sleep screen & score (v2)

When you tap **Start Sleep**, you pick a wake-up time. While sleeping, the app shows a big live
clock, a countdown (`9 hours 39 min left`) to that wake time, and an animated liquid fill that
rises through the night.

**No real alarm:** the countdown is visual only. A web app / iOS PWA cannot reliably ring an
alarm in the background — there is no sound or notification. A real alarm needs a native app.

**Sleep Score (0–100)** is derived (never stored), so it updates if you edit a session:

```
plannedMin    = targetTs ? (targetTs - startTs)/60000 : 480   // 480 = 8h default
durationScore = clamp(actualMin / plannedMin, 0, 1) * 100
ratingScore   = rating ? (rating/5)*100 : null
score = ratingScore == null ? round(durationScore)
                            : round(0.6*durationScore + 0.4*ratingScore)
```

Bands: 85+ Great · 70+ Good · 50+ Fair · else Poor.
````

Also add `targetTs` to the data-model table — find the row:

```
| `endTs` | number \| null | `null` while sleeping |
```

and insert after it:

```
| `targetTs` | number \| null | planned wake time (ms epoch); null for v1 sessions |
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document sleep screen, no-alarm caveat, score formula"
```

- [ ] **Step 3: Browser verification (Playwright + screenshots)**

Run: `python3 -m http.server 8123` then drive `http://localhost:8123`:
1. Click **Start Sleep** → wake-time dialog appears with a default time. Confirm → night view shows:
   big live clock, `… left` countdown, `Alarm · …`, and the liquid canvas animating. Screenshot.
2. Reload mid-sleep → night view persists with correct countdown.
3. Click **I'm Awake** → confirm → wake dialog → pick rating → Save → last-session card shows a
   **score number + band**; history row shows a score chip. Screenshot.
4. Edit last session to a much shorter duration → score drops (recomputed).
5. Check console: 0 errors (the iOS meta deprecation warning is expected/benign).

Expected: all behaviors as described; screenshots confirm the night view and score render.

---

## Self-Review

**Spec coverage:**
- Set wake time on start (default, cancel, tomorrow rollover) → Task 5 Steps 3,4,7 (`defaultWakeValue`, `wakeStringToTs`, dialog). ✓
- Night view: big live clock, countdown, alarm, liquid → Task 3 markup, Task 4 styles, Task 2 `liquid.js`, Task 5 Step 5 `startNight`. ✓
- Past wake time handling → `formatTimeLeft(ms<=0)` (Task 1). ✓
- No real alarm caveat → README (Task 6). ✓
- Sleep score formula + bands → Task 1 `sleepScore`/`scoreBand`. ✓
- Score on last card + history → Task 5 Step 6. ✓
- Score derived/recomputes on edit → score computed in `render()`, edit calls `render()` (existing). ✓
- `targetTs` field, backward compatible → Task 5 Step 4 `commitStart`, fallback in `sleepScore`. ✓
- `lib.js` stays pure → only added pure functions (Task 1). ✓
- `liquid.js` isolated module → Task 2. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. Task 3 Step 4 is an explicit no-op confirmation, not a placeholder. ✓

**Type consistency:** `formatTimeLeft`, `sleepScore`, `scoreBand`, `DEFAULT_GOAL_MIN` exported in Task 1 and imported in Task 5 Step 1. `startNight`/`stopNight` replace `startElapsed`/`stopElapsed` consistently (Task 5 Steps 5,6). `liquid.start/setProgress/stop` defined in Task 2, called in Task 5 Step 5. Session `targetTs` set in `commitStart`, read in `sleepScore` + `startNight`. Element ids match across index.html (Task 3) and `els` (Task 5 Step 2). The old `elapsed` element is removed (Task 3 Step 1) and its ref deleted (Task 5 Step 8). ✓

No gaps found.
