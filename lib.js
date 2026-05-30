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
