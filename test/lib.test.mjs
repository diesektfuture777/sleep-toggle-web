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
    { id: 'old', startTs: -oneDay, endTs: -oneDay + 60 * 60 * 1000 }, // before window
    { id: 'a', startTs: now - oneDay, endTs: now - oneDay + 8 * 60 * 60 * 1000 }, // 8h
    { id: 'b', startTs: now - 2 * oneDay, endTs: now - 2 * oneDay + 6 * 60 * 60 * 1000 }, // 6h
    { id: 'running', startTs: now - 1000, endTs: null }, // excluded
  ];
  const s = recentStats(sessions, now);
  assert.equal(s.count, 2);
  assert.equal(s.avgMinutes, 420); // (480+360)/2
});
