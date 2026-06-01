import {
  formatDuration, durationMinutes, getRunningSession, canStart,
  validateEnd, sessionsToCsv, recentStats, formatTimeLeft, sleepScore, scoreBand,
  totalSleepMin, timeInBedMin, sleepEfficiency, bedtimeConsistency, sanitizeAwake,
  DEFAULT_GOAL_MIN, trendSeries, rangeSummary, currentStreak, sanitizeGoal,
  ratingLabel, BADGES, badgesFor, earnedBadges, sleepDebt, brainDumpVisible, pendingReveal,
} from './lib.js';
import * as liquid from './liquid.js';

const KEY = 'sleepToggle.sessions.v1';
const SETTINGS_KEY = 'sleepToggle.settings.v1';

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
function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { goalMin: sanitizeGoal(raw.goalMin ?? DEFAULT_GOAL_MIN) };
  } catch {
    return { goalMin: DEFAULT_GOAL_MIN };
  }
}
function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
const BRAIN_KEY = 'sleepToggle.brainDumps.v1';      // array of {id, text, createdAt, seen}
const BRAIN_KEY_OLD = 'sleepToggle.brainDump.v1';   // legacy single {text, createdAt}
function loadBrainDumps() {
  try {
    const raw = JSON.parse(localStorage.getItem(BRAIN_KEY) || 'null');
    if (Array.isArray(raw)) return raw;
  } catch {}
  try { // one-time migration of the legacy single note
    const old = JSON.parse(localStorage.getItem(BRAIN_KEY_OLD) || 'null');
    if (old && old.text) {
      const migrated = [{ id: newId(), text: old.text, createdAt: old.createdAt, seen: false }];
      localStorage.setItem(BRAIN_KEY, JSON.stringify(migrated));
      localStorage.removeItem(BRAIN_KEY_OLD);
      return migrated;
    }
  } catch {}
  return [];
}
function saveBrainDumps(list) { localStorage.setItem(BRAIN_KEY, JSON.stringify(list)); }
function addBrainDump(text) {
  const list = loadBrainDumps();
  list.push({ id: newId(), text, createdAt: Date.now(), seen: false });
  saveBrainDumps(list);
}
function deleteBrainDump(id) { saveBrainDumps(loadBrainDumps().filter((d) => d.id !== id)); }
function markBrainDumpSeen(id) {
  const list = loadBrainDumps();
  const e = list.find((d) => d.id === id);
  if (e) { e.seen = true; saveBrainDumps(list); }
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
let settings = loadSettings();
let currentRange = 7;
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
  tabs: $('tabs'), homeView: $('homeView'), trendsView: $('trendsView'),
  rangeToggle: $('rangeToggle'), goalLabel: $('goalLabel'), goalEdit: $('goalEdit'),
  streak: $('streak'), trendSummary: $('trendSummary'),
  durationBars: $('durationBars'), driftChart: $('driftChart'),
  goalDialog: $('goalDialog'), goalHours: $('goalHours'),
  goalCancel: $('goalCancel'), goalSave: $('goalSave'),
  repRating: $('repRating'), lastBadges: $('lastBadges'),
  sleepDebt: $('sleepDebt'), badgeShelf: $('badgeShelf'),
  brainDumpBtn: $('brainDumpBtn'), brainDumpCard: $('brainDumpCard'),
  brainDumpReveal: $('brainDumpReveal'), brainDumpClear: $('brainDumpClear'),
  brainDumpDialog: $('brainDumpDialog'), brainDumpText: $('brainDumpText'),
  brainDumpCancel: $('brainDumpCancel'), brainDumpSave: $('brainDumpSave'),
  brainDumpList: $('brainDumpList'),
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

    els.repRating.textContent = ratingLabel(last.rating);

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

    els.lastBadges.innerHTML = '';
    for (const b of badgesFor(last)) {
      const tag = document.createElement('span');
      tag.className = 'badge-tag';
      tag.textContent = `${b.emoji} ${b.phrase}`;
      els.lastBadges.appendChild(tag);
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
    const bs = document.createElement('span');
    bs.className = 'hist-badges';
    bs.textContent = badgesFor(s).map((b) => b.emoji).join('');
    const right = document.createElement('span');
    right.append(dur, sc, bs);
    li.append(when, right);
    els.history.appendChild(li);
  }

  els.edit.disabled = lastCompleted() === null;

  renderBrainDump();
}

function renderBrainDump() {
  const reveal = pendingReveal(loadBrainDumps(), Date.now());
  if (reveal) {
    els.brainDumpReveal.textContent = reveal.text;
    els.brainDumpCard.dataset.id = reveal.id;
    els.brainDumpCard.hidden = false;
  } else {
    els.brainDumpCard.hidden = true;
    delete els.brainDumpCard.dataset.id;
  }
}

// History list inside the dialog — prior-day entries only (tonight's stays hidden).
function renderBrainDumpList() {
  const visible = loadBrainDumps()
    .filter((d) => brainDumpVisible(d, Date.now()))
    .sort((a, b) => b.createdAt - a.createdAt);
  els.brainDumpList.innerHTML = '';
  if (visible.length === 0) return;
  const title = document.createElement('h3');
  title.className = 'dump-history-title';
  title.textContent = 'Past notes';
  els.brainDumpList.appendChild(title);
  for (const d of visible) {
    const item = document.createElement('div');
    item.className = 'dump-item';
    const meta = document.createElement('p');
    meta.className = 'dump-date';
    meta.textContent = new Date(d.createdAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const body = document.createElement('p');
    body.className = 'dump-body';
    body.textContent = d.text;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'dump-del';
    del.dataset.id = d.id;
    del.textContent = '✕';
    item.append(meta, body, del);
    els.brainDumpList.appendChild(item);
  }
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

// ---------- trends ----------
function setView(view) {
  els.homeView.hidden = view !== 'home';
  els.trendsView.hidden = view !== 'trends';
  els.tabs.querySelectorAll('.tab').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === view));
  if (view === 'trends') renderTrends();
}

function goalHoursLabel(goalMin) {
  return `${(goalMin / 60).toString().replace(/\.0$/, '')}h`;
}

function renderTrends() {
  const goalMin = settings.goalMin;
  els.goalLabel.textContent = goalHoursLabel(goalMin);
  const n = currentStreak(sessions, goalMin, Date.now());
  els.streak.textContent = `🔥 ${n} night${n === 1 ? '' : 's'} ≥${goalHoursLabel(goalMin)}`;

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

  const series = trendSeries(sessions, currentRange, Date.now());
  const sum = rangeSummary(sessions, currentRange, Date.now());

  els.trendSummary.textContent = sum.nightsTracked === 0
    ? 'No nights tracked yet.'
    : `${sum.nightsTracked} night${sum.nightsTracked === 1 ? '' : 's'} · avg ${formatDuration(sum.avgTimeInBed)}`
      + ` · best ${formatDuration(sum.best.timeInBedMin)} · worst ${formatDuration(sum.worst.timeInBedMin)}`
      + (sum.avgEfficiency == null ? '' : ` · eff ${sum.avgEfficiency}% (${sum.efficiencyNights} night${sum.efficiencyNights === 1 ? '' : 's'})`);

  els.durationBars.innerHTML = '';
  if (series.length === 0) {
    els.durationBars.textContent = 'No nights tracked yet.';
  } else {
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
  }

  renderDrift(series);
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function renderDrift(series) {
  els.driftChart.innerHTML = '';
  if (series.length === 0) { els.driftChart.textContent = 'No nights tracked yet.'; return; }
  const W = Math.max(series.length * 28, 60), H = 140, AX0 = 1080, AX1 = 2160; // 18:00..36:00
  const yOf = (min) => {
    let m = min < 12 * 60 ? min + 24 * 60 : min;            // before noon => next day
    m = Math.max(AX0, Math.min(AX1, m));
    return ((m - AX0) / (AX1 - AX0)) * (H - 16) + 8;
  };
  const colW = W / series.length;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  series.forEach((s, i) => {
    const x = colW * (i + 0.5);
    const yb = yOf(s.bedtimeMin), yw = yOf(s.wakeMin);
    const seg = document.createElementNS(SVG_NS, 'line');
    seg.setAttribute('class', 'link-seg');
    seg.setAttribute('x1', x); seg.setAttribute('x2', x);
    seg.setAttribute('y1', yb); seg.setAttribute('y2', yw);
    svg.appendChild(seg);
    for (const [y, cls] of [[yb, 'dot-bed'], [yw, 'dot-wake']]) {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('class', cls);
      c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', 4);
      svg.appendChild(c);
    }
  });
  els.driftChart.appendChild(svg);
}

// ---------- wiring ----------
els.primary.addEventListener('click', onPrimary);
els.edit.addEventListener('click', openEdit);
els.export.addEventListener('click', exportCsv);

els.tabs.addEventListener('click', (e) => {
  const b = e.target.closest('.tab');
  if (b) setView(b.dataset.view);
});
els.rangeToggle.addEventListener('click', (e) => {
  const b = e.target.closest('.range');
  if (!b) return;
  currentRange = Number(b.dataset.range);
  els.rangeToggle.querySelectorAll('.range').forEach((x) => x.classList.toggle('active', x === b));
  renderTrends();
});
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
els.brainDumpBtn.addEventListener('click', () => {
  els.brainDumpText.value = '';   // always blank — tonight's note stays hidden until morning
  renderBrainDumpList();          // shows prior-day notes only
  els.brainDumpDialog.showModal();
});
els.brainDumpCancel.addEventListener('click', () => els.brainDumpDialog.close());
els.brainDumpSave.addEventListener('click', (e) => {
  e.preventDefault();
  const text = els.brainDumpText.value.trim();
  if (text) addBrainDump(text); // empty save = no-op
  els.brainDumpDialog.close();
  render();
});
els.brainDumpList.addEventListener('click', (e) => {
  const b = e.target.closest('.dump-del');
  if (!b) return;
  deleteBrainDump(b.dataset.id);
  renderBrainDumpList();
  render();
});
els.brainDumpClear.addEventListener('click', () => {
  const id = els.brainDumpCard.dataset.id;
  if (id) markBrainDumpSeen(id); // dismiss the card but keep it in history
  render();
});

render();

// ---------- service worker ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
