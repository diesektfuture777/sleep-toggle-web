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
function save(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
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
  els.wakeDialog._session = null;
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
