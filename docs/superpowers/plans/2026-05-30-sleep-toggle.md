# Sleep Toggle MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a mobile-first, offline-capable web sleep tracker (manual start/stop) installable to the iOS Home Screen, finished today.

**Architecture:** Single-screen vanilla-JS app. Pure logic lives in `lib.js` (ESM, unit-tested with Node's built-in test runner). `app.js` (ESM) handles DOM, localStorage, and rendering. A service worker precaches the static shell for offline launch. All data is in `localStorage` under one key.

**Tech Stack:** Vanilla JS (ES modules), HTML, CSS, Web App Manifest, Service Worker. Tests: `node --test` (no dependencies). Local dev server: `python3 -m http.server`. Deploy: Netlify Drop (static HTTPS).

---

## File Structure

```
sleep-toggle-web/
  index.html        — markup + iOS meta tags, loads app.js as module
  style.css         — mobile-first dark UI
  lib.js            — pure functions (no DOM/storage): formatting, CSV, stats, invariants
  app.js            — state machine, localStorage, DOM rendering, event wiring
  manifest.json     — PWA metadata
  sw.js             — offline precache of the static shell
  icons/
    icon-192.png    — generated app icon
    icon-512.png    — generated app icon
  test/
    lib.test.mjs    — Node tests for lib.js
  tools/
    make-icons.py   — stdlib-only PNG icon generator (dark bg + orange crescent)
  README.md         — run + deploy + data model
```

Pure logic is isolated in `lib.js` so it can be tested without a browser. `app.js` imports it. Everything the SW caches is a static file.

---

### Task 1: Pure logic library (`lib.js`) + tests — TDD

**Files:**
- Create: `lib.js`
- Test: `test/lib.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `test/lib.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDuration,
  durationMinutes,
  getRunningSession,
  canStart,
  validateEnd,
  csvEscape,
  sessionsToCsv,
  recentStats,
} from '../lib.js';

test('formatDuration formats h/m', () => {
  assert.equal(formatDuration(0), '0h 0m');
  assert.equal(formatDuration(59), '0h 59m');
  assert.equal(formatDuration(60), '1h 0m');
  assert.equal(formatDuration(485), '8h 5m');
});

test('durationMinutes rounds to nearest minute', () => {
  assert.equal(durationMinutes(0, 60 * 1000), 1);
  assert.equal(durationMinutes(0, 29 * 1000), 0);
  assert.equal(durationMinutes(0, 90 * 1000), 2); // 1.5 -> 2
});

test('getRunningSession returns the open session or null', () => {
  assert.equal(getRunningSession([]), null);
  const open = { id: 'a', startTs: 1, endTs: null };
  assert.deepEqual(getRunningSession([{ id: 'b', startTs: 1, endTs: 2 }, open]), open);
});

test('canStart is false when a session is running', () => {
  assert.equal(canStart([]), true);
  assert.equal(canStart([{ id: 'a', startTs: 1, endTs: 2 }]), true);
  assert.equal(canStart([{ id: 'a', startTs: 1, endTs: null }]), false);
});

test('validateEnd rejects non-positive durations', () => {
  assert.equal(validateEnd(100, 200).ok, true);
  assert.equal(validateEnd(200, 200).ok, false);
  assert.equal(validateEnd(200, 100).ok, false);
});

test('csvEscape quotes fields with comma/quote/newline', () => {
  assert.equal(csvEscape('plain'), 'plain');
  assert.equal(csvEscape('a,b'), '"a,b"');
  assert.equal(csvEscape('she said "hi"'), '"she said ""hi"""');
  assert.equal(csvEscape('line1\nline2'), '"line1\nline2"');
  assert.equal(csvEscape(null), '');
});

test('sessionsToCsv emits stable header + rows', () => {
  const csv = sessionsToCsv([
    { id: 'x1', startTs: 0, endTs: 60000, tz: 'Asia/Singapore', rating: 4, note: 'ok' },
  ]);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'id,startISO,endISO,durationMin,tz,rating,note');
  assert.ok(lines[1].startsWith('x1,1970-01-01T00:00:00.000Z,1970-01-01T00:01:00.000Z,1,Asia/Singapore,4,ok'));
});

test('sessionsToCsv handles running + empty fields', () => {
  const csv = sessionsToCsv([{ id: 'x2', startTs: 0, endTs: null, tz: 'UTC', rating: null, note: '' }]);
  const row = csv.trim().split('\n')[1];
  assert.equal(row, 'x2,1970-01-01T00:00:00.000Z,,,UTC,,');
});

test('recentStats: count + average over last 7 days of completed sessions', () => {
  const now = 7 * 24 * 60 * 60 * 1000; // day 7
  const oneDay = 24 * 60 * 60 * 1000;
  const sessions = [
    { id: 'old', startTs: 0, endTs: 60 * 60 * 1000 }, // day 0, outside window
    { id: 'a', startTs: now - oneDay, endTs: now - oneDay + 8 * 60 * 60 * 1000 }, // 8h
    { id: 'b', startTs: now - 2 * oneDay, endTs: now - 2 * oneDay + 6 * 60 * 60 * 1000 }, // 6h
    { id: 'running', startTs: now - 1000, endTs: null }, // excluded
  ];
  const s = recentStats(sessions, now);
  assert.equal(s.count, 2);
  assert.equal(s.avgMinutes, 420); // (480+360)/2
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/Documents/claude-projects/sleep-toggle-web && node --test`
Expected: FAIL — `Cannot find module '../lib.js'` / exports undefined.

- [ ] **Step 3: Write `lib.js` to make tests pass**

Create `lib.js`:

```js
// Pure functions only — no DOM, no localStorage. Safe to unit-test in Node.

export function durationMinutes(startTs, endTs) {
  return Math.round((endTs - startTs) / 60000);
}

export function formatDuration(totalMinutes) {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function getRunningSession(sessions) {
  return sessions.find((s) => s.endTs === null) ?? null;
}

export function canStart(sessions) {
  return getRunningSession(sessions) === null;
}

export function validateEnd(startTs, endTs) {
  if (!(endTs > startTs)) {
    return { ok: false, reason: 'End time must be after start time.' };
  }
  return { ok: true };
}

export function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const CSV_HEADER = 'id,startISO,endISO,durationMin,tz,rating,note';

export function sessionsToCsv(sessions) {
  const rows = sessions.map((s) => {
    const startISO = new Date(s.startTs).toISOString();
    const endISO = s.endTs == null ? '' : new Date(s.endTs).toISOString();
    const dur = s.endTs == null ? '' : String(durationMinutes(s.startTs, s.endTs));
    return [
      csvEscape(s.id),
      csvEscape(startISO),
      csvEscape(endISO),
      csvEscape(dur),
      csvEscape(s.tz),
      csvEscape(s.rating),
      csvEscape(s.note),
    ].join(',');
  });
  return [CSV_HEADER, ...rows].join('\n') + '\n';
}

export function recentStats(sessions, now = Date.now(), windowDays = 7) {
  const cutoff = now - windowDays * 24 * 60 * 60 * 1000;
  const completed = sessions.filter((s) => s.endTs != null && s.startTs >= cutoff);
  const count = completed.length;
  if (count === 0) return { count: 0, avgMinutes: 0 };
  const total = completed.reduce((sum, s) => sum + durationMinutes(s.startTs, s.endTs), 0);
  return { count, avgMinutes: Math.round(total / count) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib.js test/lib.test.mjs
git commit -m "feat: pure sleep-tracking logic with unit tests"
```

---

### Task 2: HTML shell + iOS meta + styles

**Files:**
- Create: `index.html`
- Create: `style.css`

- [ ] **Step 1: Write `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>Sleep Toggle</title>
  <meta name="theme-color" content="#0a0a0f" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="Sleep" />
  <link rel="apple-touch-icon" href="icons/icon-192.png" />
  <link rel="manifest" href="manifest.json" />
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <main class="app">
    <h1 class="title">Sleep Toggle</h1>

    <section class="status" id="status">
      <p class="status-line" id="statusLine">Not sleeping</p>
      <p class="elapsed" id="elapsed" hidden></p>
    </section>

    <button class="primary" id="primaryBtn" type="button">Start Sleep</button>

    <section class="card" id="lastCard" hidden>
      <h2>Last session</h2>
      <p class="last-duration" id="lastDuration">—</p>
      <p class="last-times" id="lastTimes">—</p>
    </section>

    <section class="card">
      <h2>Last 7 days</h2>
      <p class="stats" id="stats">No completed sessions yet.</p>
      <ul class="history" id="history"></ul>
    </section>

    <div class="actions">
      <button class="secondary" id="editBtn" type="button">Edit last</button>
      <button class="secondary" id="exportBtn" type="button">Export</button>
    </div>
  </main>

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

  <!-- Edit dialog -->
  <dialog id="editDialog">
    <form method="dialog" class="dialog-form">
      <h2>Edit last session</h2>
      <label>Start<input type="datetime-local" id="editStart" /></label>
      <label>End<input type="datetime-local" id="editEnd" /></label>
      <p class="error" id="editError" hidden></p>
      <menu class="dialog-actions">
        <button value="cancel" type="button" id="editCancel">Cancel</button>
        <button value="save" id="editSave">Save</button>
      </menu>
    </form>
  </dialog>

  <div class="toast" id="toast" hidden></div>

  <script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `style.css`** (mobile-first dark theme)

```css
:root {
  --bg: #0a0a0f;
  --card: #15151d;
  --text: #f2f2f7;
  --muted: #9a9aa8;
  --accent: #ff6a00;
  --accent-dim: #7a3300;
  --danger: #ff453a;
  --radius: 16px;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}

.app {
  max-width: 480px;
  margin: 0 auto;
  padding: max(24px, env(safe-area-inset-top)) 20px 40px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.title { font-size: 22px; font-weight: 700; text-align: center; margin: 8px 0 0; }

.status { text-align: center; }
.status-line { font-size: 18px; color: var(--muted); margin: 0; }
.status.sleeping .status-line { color: var(--accent); }
.elapsed { font-size: 34px; font-weight: 700; margin: 6px 0 0; font-variant-numeric: tabular-nums; }

.primary {
  width: 100%;
  padding: 28px;
  font-size: 22px;
  font-weight: 700;
  color: #fff;
  background: var(--accent);
  border: none;
  border-radius: var(--radius);
  cursor: pointer;
  transition: transform 0.08s ease, background 0.2s ease, opacity 0.2s ease;
}
.primary:active { transform: scale(0.98); }
.primary:disabled { opacity: 0.5; cursor: default; }
.primary.sleeping { background: var(--accent-dim); }

.card {
  background: var(--card);
  border-radius: var(--radius);
  padding: 16px 18px;
}
.card h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 0 0 10px; }
.last-duration { font-size: 26px; font-weight: 700; margin: 0; }
.last-times { color: var(--muted); margin: 4px 0 0; font-size: 14px; }
.stats { margin: 0 0 8px; font-size: 15px; }

.history { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.history li { display: flex; justify-content: space-between; font-size: 14px; color: var(--muted); }
.history li .dur { color: var(--text); font-weight: 600; }

.actions { display: flex; gap: 12px; }
.secondary {
  flex: 1;
  padding: 14px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  background: var(--card);
  border: 1px solid #2a2a36;
  border-radius: 12px;
  cursor: pointer;
}
.secondary:active { background: #1e1e28; }

dialog {
  border: none;
  border-radius: var(--radius);
  background: var(--card);
  color: var(--text);
  padding: 0;
  width: min(90vw, 360px);
}
dialog::backdrop { background: rgba(0,0,0,0.6); }
.dialog-form { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.dialog-form h2 { margin: 0; font-size: 18px; }
.dialog-form label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--muted); }
.dialog-form input, .dialog-form textarea {
  background: #0d0d14; color: var(--text); border: 1px solid #2a2a36;
  border-radius: 10px; padding: 10px; font-size: 16px; font-family: inherit;
}
.rating { display: flex; gap: 8px; justify-content: space-between; }
.rating button {
  flex: 1; padding: 12px 0; font-size: 16px; border-radius: 10px;
  border: 1px solid #2a2a36; background: #0d0d14; color: var(--text); cursor: pointer;
}
.rating button.selected { background: var(--accent); border-color: var(--accent); color: #fff; }
.dialog-actions { display: flex; gap: 10px; justify-content: flex-end; padding: 0; margin: 0; }
.dialog-actions button {
  padding: 10px 18px; font-size: 15px; font-weight: 600; border-radius: 10px;
  border: none; background: var(--accent); color: #fff; cursor: pointer;
}
.dialog-actions button#editCancel { background: #2a2a36; }
.error { color: var(--danger); font-size: 13px; margin: 0; }

.toast {
  position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%);
  background: #2a2a36; color: var(--text); padding: 12px 18px; border-radius: 12px;
  font-size: 14px; max-width: 90vw; text-align: center; z-index: 10;
}
```

- [ ] **Step 3: Commit**

```bash
git add index.html style.css
git commit -m "feat: HTML shell, iOS meta tags, dark mobile UI"
```

---

### Task 3: App logic — state, storage, rendering, start/stop

**Files:**
- Create: `app.js`

- [ ] **Step 1: Write `app.js`**

```js
import {
  formatDuration, durationMinutes, getRunningSession, canStart,
  validateEnd, sessionsToCsv, recentStats,
} from './lib.js';

const KEY = 'sleepToggle.sessions.v1';

// ---------- storage ----------
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function save(sessions) {
  localStorage.setItem(KEY, JSON.stringify(sessions));
}

function tzLabel() {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (z) return z;
  } catch {}
  const offMin = -new Date().getTimezoneOffset();
  const sign = offMin >= 0 ? '+' : '-';
  const a = Math.abs(offMin);
  return `UTC${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// ---------- state ----------
let sessions = load();
let busy = false;          // double-tap guard
let elapsedTimer = null;
let pendingRating = null;  // selected rating in wake dialog

// ---------- elements ----------
const $ = (id) => document.getElementById(id);
const els = {
  status: $('status'), statusLine: $('statusLine'), elapsed: $('elapsed'),
  primary: $('primaryBtn'), lastCard: $('lastCard'),
  lastDuration: $('lastDuration'), lastTimes: $('lastTimes'),
  stats: $('stats'), history: $('history'),
  edit: $('editBtn'), export: $('exportBtn'),
  wakeDialog: $('wakeDialog'), ratingRow: $('ratingRow'), wakeNote: $('wakeNote'), wakeSave: $('wakeSave'),
  editDialog: $('editDialog'), editStart: $('editStart'), editEnd: $('editEnd'),
  editError: $('editError'), editCancel: $('editCancel'), editSave: $('editSave'),
  toast: $('toast'),
};

// ---------- helpers ----------
function fmtTime(ts) {
  return new Date(ts).toLocaleString([], {
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  });
}
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { els.toast.hidden = true; }, 2600);
}
function toLocalInput(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}
function lastCompleted() {
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (sessions[i].endTs != null) return sessions[i];
  }
  return null;
}

// ---------- rendering ----------
function render() {
  const running = getRunningSession(sessions);

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

  const last = lastCompleted();
  if (last) {
    els.lastCard.hidden = false;
    els.lastDuration.textContent = formatDuration(durationMinutes(last.startTs, last.endTs));
    els.lastTimes.textContent = `${fmtTime(last.startTs)} → ${fmtTime(last.endTs)} · ${last.tz}`;
  } else {
    els.lastCard.hidden = true;
  }

  const stat = recentStats(sessions, Date.now());
  els.stats.textContent = stat.count === 0
    ? 'No completed sessions yet.'
    : `${stat.count} night${stat.count === 1 ? '' : 's'} · avg ${formatDuration(stat.avgMinutes)}`;

  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = sessions.filter((s) => s.endTs != null && s.startTs >= cutoff).slice(-7).reverse();
  els.history.innerHTML = '';
  for (const s of recent) {
    const li = document.createElement('li');
    const when = document.createElement('span');
    when.textContent = new Date(s.startTs).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const dur = document.createElement('span');
    dur.className = 'dur';
    dur.textContent = formatDuration(durationMinutes(s.startTs, s.endTs));
    li.append(when, dur);
    els.history.appendChild(li);
  }

  els.edit.disabled = lastCompleted() === null;
}

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

// ---------- actions ----------
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

function endSleep() {
  const running = getRunningSession(sessions);
  if (!running) { render(); return; }
  if (!confirm('End this sleep session?')) return;
  const now = Date.now();
  const check = validateEnd(running.startTs, now);
  if (!check.ok) { toast(check.reason); return; }
  running.endTs = now;
  running.updatedAt = now;
  save(sessions);
  openWakeDialog(running);
  render();
}

function onPrimary() {
  if (busy) return;
  busy = true;
  els.primary.disabled = true;
  try {
    if (getRunningSession(sessions)) endSleep();
    else startSleep();
  } finally {
    setTimeout(() => { busy = false; els.primary.disabled = false; }, 400);
  }
}

// ---------- wake dialog ----------
function openWakeDialog(session) {
  pendingRating = null;
  els.wakeNote.value = '';
  els.ratingRow.querySelectorAll('button').forEach((b) => b.classList.remove('selected'));
  els.wakeDialog._session = session;
  els.wakeDialog.showModal();
}
els.ratingRow.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-rating]');
  if (!b) return;
  pendingRating = Number(b.dataset.rating);
  els.ratingRow.querySelectorAll('button').forEach((x) => x.classList.remove('selected'));
  b.classList.add('selected');
});
els.wakeDialog.addEventListener('close', () => {
  const session = els.wakeDialog._session;
  if (!session) return;
  session.rating = pendingRating;
  session.note = els.wakeNote.value.trim();
  session.updatedAt = Date.now();
  save(sessions);
  render();
});

// ---------- edit dialog ----------
function openEdit() {
  const last = lastCompleted();
  if (!last) return;
  els.editDialog._session = last;
  els.editStart.value = toLocalInput(last.startTs);
  els.editEnd.value = toLocalInput(last.endTs);
  els.editError.hidden = true;
  els.editDialog.showModal();
}
els.editCancel.addEventListener('click', () => els.editDialog.close());
els.editSave.addEventListener('click', (e) => {
  e.preventDefault();
  const s = els.editDialog._session;
  const start = fromLocalInput(els.editStart.value);
  const end = fromLocalInput(els.editEnd.value);
  if (start == null || end == null) {
    els.editError.textContent = 'Please enter valid start and end times.';
    els.editError.hidden = false;
    return;
  }
  const check = validateEnd(start, end);
  if (!check.ok) { els.editError.textContent = check.reason; els.editError.hidden = false; return; }
  s.startTs = start; s.endTs = end; s.updatedAt = Date.now();
  save(sessions);
  els.editDialog.close();
  render();
});

// ---------- export ----------
async function exportCsv() {
  const csv = sessionsToCsv(sessions);
  // download
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sleep-toggle-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  // copy
  try {
    await navigator.clipboard.writeText(csv);
    toast('CSV downloaded + copied to clipboard.');
  } catch {
    toast('CSV downloaded. Clipboard copy not supported here.');
  }
}

// ---------- wiring ----------
els.primary.addEventListener('click', onPrimary);
els.edit.addEventListener('click', openEdit);
els.export.addEventListener('click', exportCsv);

render();

// ---------- service worker ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
```

- [ ] **Step 2: Manual verification in browser**

Run: `cd ~/Documents/claude-projects/sleep-toggle-web && python3 -m http.server 8000`
Open `http://localhost:8000` in Chrome/Safari, enable mobile emulation. Verify:
- Start Sleep → status flips to "Sleeping…", live elapsed appears.
- Reload page mid-sleep → still "Sleeping…", elapsed continues.
- I'm Awake → confirm dialog → wake dialog (pick rating, type note, Save) → last session card shows correct duration + times.
- Tapping Start twice fast does not create duplicates (double-tap guard).
Expected: all behaviors as described.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: app state machine, start/stop, wake check-in, edit, export"
```

---

### Task 4: PWA — icons, manifest, service worker

**Files:**
- Create: `tools/make-icons.py`
- Create: `icons/icon-192.png`, `icons/icon-512.png`
- Create: `manifest.json`
- Create: `sw.js`

- [ ] **Step 1: Write `tools/make-icons.py`** (stdlib only — no installs)

```python
#!/usr/bin/env python3
"""Generate dark app icons with an orange crescent moon. Pure stdlib (zlib)."""
import struct, zlib, math, os

def make_png(path, size):
    bg = (10, 10, 15)
    accent = (255, 106, 0)
    cx, cy, r = size * 0.5, size * 0.46, size * 0.30
    ox, oy = cx + r * 0.55, cy - r * 0.30  # cut-out circle for crescent

    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type 0
        for x in range(size):
            dx, dy = x - cx, y - cy
            in_moon = dx * dx + dy * dy <= r * r
            in_cut = (x - ox) ** 2 + (y - oy) ** 2 <= (r * 0.85) ** 2
            raw += bytes(accent if (in_moon and not in_cut) else bg)

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit RGB
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + \
          chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(png)
    print("wrote", path)

if __name__ == "__main__":
    base = os.path.join(os.path.dirname(__file__), "..", "icons")
    make_png(os.path.join(base, "icon-192.png"), 192)
    make_png(os.path.join(base, "icon-512.png"), 512)
```

- [ ] **Step 2: Generate the icons**

Run: `cd ~/Documents/claude-projects/sleep-toggle-web && python3 tools/make-icons.py`
Expected: `wrote .../icons/icon-192.png` and `icon-512.png`. Open one to confirm it shows an orange crescent on dark.

- [ ] **Step 3: Write `manifest.json`**

```json
{
  "name": "Sleep Toggle",
  "short_name": "Sleep",
  "description": "Manual sleep tracker — tap to start, tap to wake.",
  "start_url": ".",
  "scope": ".",
  "display": "standalone",
  "background_color": "#0a0a0f",
  "theme_color": "#0a0a0f",
  "orientation": "portrait",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" }
  ]
}
```

- [ ] **Step 4: Write `sw.js`** (cache-first static shell)

```js
const CACHE = 'sleep-toggle-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './lib.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
```

- [ ] **Step 5: Verify SW registers locally**

Run: `python3 -m http.server 8000` then open `http://localhost:8000`.
In DevTools → Application → Service Workers: confirm `sw.js` is "activated and running". In Application → Manifest: confirm name + icons load with no errors.
Expected: SW active, manifest valid.

- [ ] **Step 6: Commit**

```bash
git add tools/make-icons.py icons/ manifest.json sw.js
git commit -m "feat: PWA manifest, generated icons, offline service worker"
```

---

### Task 5: README + final verification + deploy

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
# Sleep Toggle

Mobile-first, offline-capable web sleep tracker. Manual start/stop. No backend, no auth.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Service workers only register over HTTPS or `localhost` — use `localhost`, not the LAN IP, for local PWA testing.

## Tests

```bash
node --test
```

Covers the pure logic in `lib.js` (formatting, CSV, stats, the single-running-session invariant).

## Deploy (Netlify Drop)

1. Go to https://app.netlify.com/drop
2. Drag the whole `sleep-toggle-web` folder onto the page.
3. Open the generated HTTPS URL on your iPhone in Safari.
4. Share → **Add to Home Screen**. Launches standalone; works offline after first load.

## Data model

All data is in `localStorage` under the single key `sleepToggle.sessions.v1` — a JSON array of:

| field | type | notes |
|-------|------|-------|
| `id` | string | unique id |
| `startTs` | number | ms epoch |
| `endTs` | number \| null | `null` while sleeping |
| `tz` | string | IANA tz (e.g. `Asia/Singapore`) or `UTC±HH:MM` |
| `rating` | number \| null | 1–5 wake rating |
| `note` | string | wake note, may be empty |
| `createdAt` / `updatedAt` | number | ms epoch |

**Invariant:** at most one session has `endTs === null` (the running session).

## CSV export

Columns: `id,startISO,endISO,durationMin,tz,rating,note`. Timestamps are ISO 8601; timezone is included per row. Export downloads a file and also copies to the clipboard (with a fallback message where the Clipboard API is unavailable).

## Scope (v1)

Manual toggle only. No Apple Health, Watch, sleep stages, backend, auth, or sync.
````

- [ ] **Step 2: Full local regression**

Run: `node --test` (expect all PASS), then `python3 -m http.server 8000` and re-run the 5 flows from Task 3 Step 2 plus Edit (adjust last session start/end → duration updates) and Export (file downloads; toast confirms copy).
Expected: all flows pass; no console errors.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README with run, test, deploy, data model"
```

- [ ] **Step 4: Deploy + on-device check (manual, user-assisted)**

Deploy via Netlify Drop (drag folder to https://app.netlify.com/drop). On the iPhone:
- Open the HTTPS URL in Safari → Add to Home Screen → launches standalone (no Safari chrome).
- Toggle a sleep session to confirm storage works on-device.
- Enable Airplane Mode, cold-launch the icon → app still loads (offline shell).
Expected: installs, runs, and cold-launches offline.

---

## Self-Review

**Spec coverage:**
- Manual start/stop → Task 3 (`startSleep`/`endSleep`). ✓
- localStorage single key + data model → Task 3 storage + README. ✓
- No negative durations → `validateEnd` (Task 1), enforced in end + edit (Task 3). ✓
- Double-tap guard → `busy` flag + button disable (Task 3 `onPrimary`). ✓
- Duplicate-session guard / warning → `canStart` + toast (Task 1/3). ✓
- Reload mid-sleep preserved → `render()` detects running session on load (Task 3). ✓
- Edit last session + recompute → edit dialog (Task 3). ✓
- CSV stable + tz + copy/fallback → `sessionsToCsv` (Task 1), `exportCsv` (Task 3). ✓
- PWA manifest + iOS meta + SW → Task 2 meta, Task 4 manifest/sw. ✓
- README + data model section → Task 5. ✓
- Duration `Xh Ym` + exact local times w/ tz label → `formatDuration` + `fmtTime`/`tzLabel` (Task 1/3). ✓

**Placeholder scan:** No TBD/TODO; all steps contain real code/commands. ✓

**Type consistency:** `lib.js` exports (`formatDuration`, `durationMinutes`, `getRunningSession`, `canStart`, `validateEnd`, `csvEscape`, `sessionsToCsv`, `recentStats`) match imports in `app.js` and `test/lib.test.mjs`. Session shape consistent across tasks. ✓

No gaps found.
