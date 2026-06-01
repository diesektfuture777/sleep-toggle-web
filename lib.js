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

export function scoreBand(n) {
  if (n >= 85) return 'Great';
  if (n >= 70) return 'Good';
  if (n >= 50) return 'Fair';
  return 'Poor';
}

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

// Consecutive qualifying nights ending at the most recent tracked night.
// A not-yet-slept (or in-progress) tonight does NOT reset the streak.
export function currentStreak(sessions, goalMin, now = Date.now()) {
  const byNight = groupByNight(sessions);
  const qualifies = (night) => {
    const s = byNight.get(night);
    return s != null && timeInBedMin(s) >= goalMin;
  };
  let cursor = nightDate(now); // device-local anchor for "now"
  if (!qualifies(cursor)) cursor = prevNightStr(cursor);
  let count = 0;
  while (qualifies(cursor)) { count++; cursor = prevNightStr(cursor); }
  return count;
}

export function sanitizeGoal(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_GOAL_MIN;
  return Math.round(clamp(n, 60, 960) / 5) * 5;
}

// ---------- v5: rating words, badges, sleep debt, brain dump ----------

export const RATING_LABELS = [null, 'Very Poor', 'Poor', 'Fair', 'Good', 'Excellent'];
export function ratingLabel(n) {
  return RATING_LABELS[n] ?? '—';
}

export const BADGES = {
  rock: { emoji: '🪨', name: 'The Rock', phrase: 'Slept like a rock!' },
  owl: { emoji: '🦉', name: 'The Owl', phrase: 'Night owl mode active' },
  zombie: { emoji: '🧟', name: 'The Zombie', phrase: 'Running on empty today' },
  earlybird: { emoji: '🌅', name: 'The Early Bird', phrase: 'Up with the sun!' },
};

// Badges a single COMPLETED session earns, from its own data (tz-aware, honest).
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

export function earnedBadges(sessions) {
  const set = new Set();
  for (const s of sessions) for (const b of badgesFor(s)) set.add(b.key);
  return set;
}

export function sleepDebt(sessions, goalMin, rangeDays, now = Date.now()) {
  const series = trendSeries(sessions, rangeDays, now);
  let debtMin = 0;
  for (const s of series) debtMin += Math.max(0, goalMin - s.timeInBedMin);
  return { debtMin, nightsCounted: series.length };
}

// Brain dump reveals once the local calendar date has changed from when it was written.
export function brainDumpVisible(dump, now = Date.now()) {
  if (!dump || !dump.text || !dump.text.trim()) return false;
  const localDate = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };
  return localDate(dump.createdAt) !== localDate(now);
}

// The brain-dump entry the Home reveal card should show: most recent UNSEEN
// entry whose day has passed. null when none qualify.
export function pendingReveal(dumps, now = Date.now()) {
  if (!Array.isArray(dumps)) return null;
  const eligible = dumps.filter((d) => !d.seen && brainDumpVisible(d, now));
  if (eligible.length === 0) return null;
  return eligible.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
}
