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

// score branches: durationScore uses TST vs planned (targetTs-startTs, else 480)
test('sleepScore: eff+rating branch (0.5 dur + 0.3 eff + 0.2 rating)', () => {
  const startTs = 0, targetTs = 8 * 60 * 60 * 1000, endTs = 8 * 60 * 60 * 1000; // planned 8h, TIB 8h
  // awakeMin 0 -> TST 8h -> dur 100, eff 100; rating 5 -> 100 => 100
  assert.equal(sleepScore({ startTs, endTs, targetTs, awakeMin: 0, rating: 5 }), 100);
  // awakeMin 240 -> TST 4h -> dur 50, eff 50; rating 5 -> 100 => 0.5*50+0.3*50+0.2*100=60
  assert.equal(sleepScore({ startTs, endTs, targetTs, awakeMin: 240, rating: 5 }), 60);
});

test('sleepScore: eff, no rating (0.6 dur + 0.4 eff)', () => {
  const startTs = 0, targetTs = 8 * 60 * 60 * 1000, endTs = 8 * 60 * 60 * 1000;
  // awakeMin 240 -> dur 50, eff 50 => 50
  assert.equal(sleepScore({ startTs, endTs, targetTs, awakeMin: 240, rating: null }), 50);
});

test('sleepScore: no awake, rating -> v2 formula (0.6 dur + 0.4 rating)', () => {
  const startTs = 0, targetTs = 8 * 60 * 60 * 1000, endTs = 4 * 60 * 60 * 1000; // dur 50
  // rating 5 -> 100 => 0.6*50 + 0.4*100 = 70
  assert.equal(sleepScore({ startTs, endTs, targetTs, awakeMin: null, rating: 5 }), 70);
});

test('sleepScore: no awake, no rating -> duration only', () => {
  const startTs = 0, targetTs = 8 * 60 * 60 * 1000, endTs = 4 * 60 * 60 * 1000; // dur 50
  assert.equal(sleepScore({ startTs, endTs, targetTs, awakeMin: null, rating: null }), 50);
});

test('sleepScore: no target falls back to 8h default goal', () => {
  const startTs = 0, endTs = 4 * 60 * 60 * 1000; // 4h of default 8h -> dur 50
  assert.equal(sleepScore({ startTs, endTs, targetTs: null, awakeMin: null, rating: null }), 50);
});

test('sleepScore: oversleep caps duration at 100', () => {
  // planned 6h, slept 9h, no awake -> TST 9h, dur capped 100; eff 100 => 100
  const startTs = 0, targetTs = 6 * 60 * 60 * 1000, endTs = 9 * 60 * 60 * 1000;
  assert.equal(sleepScore({ startTs, endTs, targetTs, awakeMin: 0, rating: null }), 100);
});

test('sleepScore: awake >= time-in-bed => no sleep => 0', () => {
  // TIB 8h, awake 999 clamped to 480 -> TST 0 -> dur 0, eff 0 -> 0
  const startTs = 0, targetTs = 8 * 60 * 60 * 1000, endTs = 8 * 60 * 60 * 1000;
  assert.equal(sleepScore({ startTs, endTs, targetTs, awakeMin: 999, rating: null }), 0);
});

test('sleepScore: null for running session', () => {
  assert.equal(sleepScore({ startTs: 0, endTs: null, targetTs: 8 * 60 * 60 * 1000 }), null);
});

test('scoreBand boundaries', () => {
  assert.equal(scoreBand(85), 'Great');
  assert.equal(scoreBand(84), 'Good');
  assert.equal(scoreBand(70), 'Good');
  assert.equal(scoreBand(69), 'Fair');
  assert.equal(scoreBand(50), 'Fair');
  assert.equal(scoreBand(49), 'Poor');
});

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
