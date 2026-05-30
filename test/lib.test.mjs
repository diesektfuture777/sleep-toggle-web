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
  formatTimeLeft,
  sleepScore,
  scoreBand,
  DEFAULT_GOAL_MIN,
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
