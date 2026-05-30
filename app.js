import {
  formatDuration, durationMinutes, getRunningSession, canStart,
  validateEnd, sessionsToCsv, recentStats, formatTimeLeft, sleepScore, scoreBand,
  totalSleepMin, timeInBedMin, sleepEfficiency, bedtimeConsistency, sanitizeAwake,
} from './lib.js';
import * as liquid from './liquid.js';

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
  status: $('status'), statusLine: $('statusLine'),
  primary: $('primaryBtn'), lastCard: $('lastCard'),
  lastDuration: $('lastDuration'), lastTimes: $('lastTimes'),
  stats: $('stats'), history: $('history'),
  edit: $('editBtn'), export: $('exportBtn'),
  wakeDialog: $('wakeDialog'), ratingRow: $('ratingRow'), wakeNote: $('wakeNote'),
  editDialog: $('editDialog'), editStart: $('editStart'), editEnd: $('editEnd'),
  editError: $('editError'), editCancel: $('editCancel'), editSave: $('editSave'),
  toast: $('toast'),
  night: $('night'), liquid: $('liquid'), clock: $('clock'),
  countdown: $('countdown'), alarm: $('alarm'),
  scoreBox: $('scoreBox'), scoreNum: $('scoreNum'), scoreBand: $('scoreBand'),
  repTst: $('repTst'), repEff: $('repEff'), repConsistency: $('repConsistency'),
  awakeBar: $('awakeBar'), awakeBarAsleep: $('awakeBarAsleep'),
  awakeBarAwake: $('awakeBarAwake'), awakeLegend: $('awakeLegend'),
  wakeAwake: $('wakeAwake'), wakeSkip: $('wakeSkip'),
  wakeTimeDialog: $('wakeTimeDialog'), wakeTime: $('wakeTime'),
  wakeTimeCancel: $('wakeTimeCancel'), wakeTimeStart: $('wakeTimeStart'),
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
    startNight(running);
  } else {
    els.status.classList.remove('sleeping');
    els.statusLine.textContent = 'Not sleeping';
    els.primary.textContent = 'Start Sleep';
    els.primary.classList.remove('sleeping');
    stopNight();
  }

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
    const sc = document.createElement('span');
    sc.className = 'score-mini';
    sc.textContent = sleepScore(s);
    const right = document.createElement('span');
    right.append(dur, sc);
    li.append(when, right);
    els.history.appendChild(li);
  }

  els.edit.disabled = lastCompleted() === null;
}

function startNight(session) {
  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
  els.night.hidden = false;
  liquid.start(els.liquid);
  const tick = () => {
    const now = Date.now();
    els.clock.textContent = new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    if (session.targetTs != null) {
      els.countdown.textContent = formatTimeLeft(session.targetTs - now);
      els.alarm.textContent = `Alarm · ${new Date(session.targetTs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}`;
      const planned = session.targetTs - session.startTs;
      liquid.setProgress(planned > 0 ? (now - session.startTs) / planned : 0);
    } else {
      els.countdown.textContent = formatDuration(durationMinutes(session.startTs, now));
      els.alarm.textContent = 'No alarm set';
      liquid.setProgress(0);
    }
  };
  tick();
  elapsedTimer = setInterval(tick, 1000);
}
function stopNight() {
  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
  liquid.stop();
  els.night.hidden = true;
}

// ---------- actions ----------
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
  els.wakeAwake.value = '';
  els.ratingRow.querySelectorAll('button').forEach((b) => b.classList.remove('selected'));
  els.wakeDialog._session = session;
  els.wakeDialog.returnValue = ''; // clear so a stale "save" can't write on Esc/backdrop
  els.wakeDialog.showModal();
}
els.ratingRow.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-rating]');
  if (!b) return;
  pendingRating = Number(b.dataset.rating);
  els.ratingRow.querySelectorAll('button').forEach((x) => x.classList.remove('selected'));
  b.classList.add('selected');
});
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

// ---------- wake-time picker ----------
els.wakeTimeCancel.addEventListener('click', () => els.wakeTimeDialog.close('cancel'));
els.wakeTimeDialog.addEventListener('close', () => {
  if (els.wakeTimeDialog.returnValue !== 'start') return;
  const value = els.wakeTime.value;
  if (!value) { toast('Pick a wake-up time.'); return; }
  commitStart(wakeStringToTs(value, Date.now()));
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
