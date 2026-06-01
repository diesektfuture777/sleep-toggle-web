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
  nightDate,
  timeOfDayMin,
  groupByNight,
  trendSeries,
  rangeSummary,
  currentStreak,
  sanitizeGoal,
  RATING_LABELS,
  ratingLabel,
  BADGES,
  badgesFor,
  earnedBadges,
  sleepDebt,
  brainDumpVisible,
  pendingReveal,
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

// ---------- v4: trends + goal/streak ----------

const sess = (id, startUTC, endUTC, extra = {}) => ({
  id, startTs: startUTC, endTs: endUTC, tz: 'Asia/Singapore', awakeMin: null, ...extra,
});
const NOW = Date.UTC(2026, 5, 1, 4, 0); // 2026-06-01 12:00 SGT

test('nightDate: after-noon start keeps same calendar date', () => {
  assert.equal(nightDate(Date.UTC(2026, 4, 31, 14, 0), 'Asia/Singapore'), '2026-05-31'); // 22:00 SGT
});

test('nightDate: before-noon start shifts to previous day', () => {
  assert.equal(nightDate(Date.UTC(2026, 4, 31, 17, 0), 'Asia/Singapore'), '2026-05-31'); // 01:00 SGT next day
});

test('nightDate: boundary 11:59 shifts back, 12:00 stays', () => {
  assert.equal(nightDate(Date.UTC(2026, 4, 31, 3, 59), 'Asia/Singapore'), '2026-05-30'); // 11:59 SGT
  assert.equal(nightDate(Date.UTC(2026, 4, 31, 4, 0), 'Asia/Singapore'), '2026-05-31');  // 12:00 SGT
});

test('nightDate: midnight 00:00 shifts to previous day', () => {
  assert.equal(nightDate(Date.UTC(2026, 4, 31, 16, 0), 'Asia/Singapore'), '2026-05-31'); // 00:00 SGT next day
});

test('nightDate: invalid tz falls back without throwing', () => {
  const ts = Date.UTC(2026, 4, 31, 14, 0);
  assert.doesNotThrow(() => nightDate(ts, 'UTC+08:00'));
  assert.match(nightDate(ts, 'UTC+08:00'), /^\d{4}-\d{2}-\d{2}$/);
});

test('timeOfDayMin: tz-aware minutes since local midnight', () => {
  assert.equal(timeOfDayMin(Date.UTC(2026, 4, 31, 14, 30), 'Asia/Singapore'), 22 * 60 + 30);
});

test('timeOfDayMin: invalid tz falls back without throwing', () => {
  assert.doesNotThrow(() => timeOfDayMin(Date.UTC(2026, 4, 31, 14, 30), 'UTC+08:00'));
});

test('groupByNight: excludes running sessions', () => {
  assert.equal(groupByNight([sess('a', Date.UTC(2026, 4, 31, 14, 0), null)]).size, 0);
});

test('groupByNight: same night keeps the longer session', () => {
  const short = sess('s', Date.UTC(2026, 4, 31, 14, 0), Date.UTC(2026, 4, 31, 15, 0)); // 1h
  const long = sess('l', Date.UTC(2026, 4, 31, 15, 0), Date.UTC(2026, 4, 31, 21, 0));  // 6h
  const m = groupByNight([short, long]);
  assert.equal(m.size, 1);
  assert.equal(m.get('2026-05-31').id, 'l');
});

test('trendSeries: chronological, gaps absent, efficiency null when awake unknown', () => {
  const list = [
    sess('n1', Date.UTC(2026, 4, 30, 14, 0), Date.UTC(2026, 4, 30, 22, 0)), // 05-30, 8h
    sess('n2', Date.UTC(2026, 4, 31, 14, 0), Date.UTC(2026, 4, 31, 20, 0)), // 05-31, 6h
  ];
  const s = trendSeries(list, 7, NOW);
  assert.equal(s.length, 2);
  assert.deepEqual(s.map((x) => x.night), ['2026-05-30', '2026-05-31']);
  assert.equal(s[0].efficiency, null);
  assert.equal(s[1].timeInBedMin, 360);
});

test('trendSeries: all-untracked range returns empty', () => {
  assert.deepEqual(trendSeries([], 7, NOW), []);
});

test('rangeSummary: efficiency only over real-awake nights + count', () => {
  const list = [
    sess('n1', Date.UTC(2026, 4, 30, 14, 0), Date.UTC(2026, 4, 30, 22, 0), { awakeMin: 60 }),
    sess('n2', Date.UTC(2026, 4, 31, 14, 0), Date.UTC(2026, 4, 31, 20, 0)),
  ];
  const r = rangeSummary(list, 7, NOW);
  assert.equal(r.nightsTracked, 2);
  assert.equal(r.efficiencyNights, 1);
  assert.notEqual(r.avgEfficiency, null);
  assert.equal(r.best.timeInBedMin, 480);
  assert.equal(r.worst.timeInBedMin, 360);
});

test('rangeSummary: empty range => zeros and null efficiency', () => {
  const r = rangeSummary([], 7, NOW);
  assert.equal(r.nightsTracked, 0);
  assert.equal(r.avgEfficiency, null);
  assert.equal(r.best, null);
});

test('currentStreak: gap on most recent night breaks immediately', () => {
  const list = [
    sess('a', Date.UTC(2026, 4, 29, 14, 0), Date.UTC(2026, 4, 29, 23, 0)), // 05-29, 9h
    sess('b', Date.UTC(2026, 4, 30, 14, 0), Date.UTC(2026, 4, 30, 23, 0)), // 05-30, 9h
  ];
  assert.equal(currentStreak(list, 480, NOW), 0); // 05-31 untracked, anchor 06-01
});

test('currentStreak: unlogged tonight does not reset prior run', () => {
  const list = [
    sess('a', Date.UTC(2026, 4, 30, 14, 0), Date.UTC(2026, 4, 30, 23, 0)), // 05-30, 9h
    sess('b', Date.UTC(2026, 4, 31, 14, 0), Date.UTC(2026, 4, 31, 23, 0)), // 05-31, 9h
  ];
  const now = Date.UTC(2026, 5, 1, 14, 0); // 06-01 22:00 SGT, tonight not logged
  assert.equal(currentStreak(list, 480, now), 2);
});

test('currentStreak: below-goal most-recent night breaks', () => {
  const list = [
    sess('a', Date.UTC(2026, 4, 30, 14, 0), Date.UTC(2026, 4, 30, 23, 0)), // 05-30, 9h
    sess('b', Date.UTC(2026, 4, 31, 14, 0), Date.UTC(2026, 4, 31, 18, 0)), // 05-31, 4h
  ];
  assert.equal(currentStreak(list, 480, Date.UTC(2026, 5, 1, 14, 0)), 0);
});

test('currentStreak: goal exactly met is inclusive', () => {
  const list = [sess('a', Date.UTC(2026, 4, 31, 14, 0), Date.UTC(2026, 4, 31, 22, 0))]; // 8h, 05-31
  assert.equal(currentStreak(list, 480, Date.UTC(2026, 5, 1, 14, 0)), 1);
});

test('currentStreak: excludes running session', () => {
  assert.equal(currentStreak([sess('a', Date.UTC(2026, 4, 31, 14, 0), null)], 480, NOW), 0);
});

test('sanitizeGoal: clamps, rounds to 5, invalid -> default', () => {
  assert.equal(sanitizeGoal(420), 420);
  assert.equal(sanitizeGoal(7.3 * 60), 440); // 438 -> 440
  assert.equal(sanitizeGoal(5), 60);
  assert.equal(sanitizeGoal(2000), 960);
  assert.equal(sanitizeGoal('nope'), DEFAULT_GOAL_MIN);
  assert.equal(sanitizeGoal(-10), DEFAULT_GOAL_MIN);
});

// ---------- v5: rating words, badges, sleep debt, brain dump ----------

test('ratingLabel: 1..5 map to words, out-of-range -> dash', () => {
  assert.equal(ratingLabel(5), 'Excellent');
  assert.equal(ratingLabel(4), 'Good');
  assert.equal(ratingLabel(3), 'Fair');
  assert.equal(ratingLabel(2), 'Poor');
  assert.equal(ratingLabel(1), 'Very Poor');
  assert.equal(ratingLabel(0), '—');
  assert.equal(ratingLabel(6), '—');
  assert.equal(ratingLabel(null), '—');
});

test('badgesFor: rock at 8h with low awake', () => {
  const s = sess('r', Date.UTC(2026, 4, 31, 15, 0), Date.UTC(2026, 4, 31, 23, 0), { awakeMin: 10 }); // 23:00->07:00 SGT, 8h
  assert.ok(badgesFor(s).some((b) => b.key === 'rock'));
});

test('badgesFor: rock via Excellent rating when awake unknown', () => {
  const s = sess('r', Date.UTC(2026, 4, 31, 15, 0), Date.UTC(2026, 4, 31, 23, 0), { rating: 5 });
  assert.ok(badgesFor(s).some((b) => b.key === 'rock'));
});

test('badgesFor: no rock at 8h with high awake', () => {
  const s = sess('r', Date.UTC(2026, 4, 31, 15, 0), Date.UTC(2026, 4, 31, 23, 0), { awakeMin: 90 });
  assert.ok(!badgesFor(s).some((b) => b.key === 'rock'));
});

test('badgesFor: owl on 01:30 bedtime, not on 22:00', () => {
  const owl = sess('o', Date.UTC(2026, 4, 31, 17, 30), Date.UTC(2026, 5, 1, 1, 0)); // 01:30 SGT bedtime
  const notOwl = sess('n', Date.UTC(2026, 4, 31, 14, 0), Date.UTC(2026, 4, 31, 22, 0)); // 22:00 SGT
  assert.ok(badgesFor(owl).some((b) => b.key === 'owl'));
  assert.ok(!badgesFor(notOwl).some((b) => b.key === 'owl'));
});

test('badgesFor: zombie on rating 1 and on <5h', () => {
  const bad = sess('z', Date.UTC(2026, 4, 31, 14, 0), Date.UTC(2026, 4, 31, 22, 0), { rating: 1 });
  const short = sess('s', Date.UTC(2026, 4, 31, 14, 0), Date.UTC(2026, 4, 31, 17, 0)); // 3h
  assert.ok(badgesFor(bad).some((b) => b.key === 'zombie'));
  assert.ok(badgesFor(short).some((b) => b.key === 'zombie'));
});

test('badgesFor: earlybird on 05:30 wake, not on 12:00 wake', () => {
  const early = sess('e', Date.UTC(2026, 4, 31, 15, 0), Date.UTC(2026, 4, 31, 21, 30)); // wake 05:30 SGT
  const noon = sess('m', Date.UTC(2026, 4, 31, 18, 0), Date.UTC(2026, 5, 1, 4, 0));     // wake 12:00 SGT
  assert.ok(badgesFor(early).some((b) => b.key === 'earlybird'));
  assert.ok(!badgesFor(noon).some((b) => b.key === 'earlybird'));
});

test('badgesFor: running session -> none', () => {
  assert.deepEqual(badgesFor(sess('x', Date.UTC(2026, 4, 31, 15, 0), null)), []);
});

test('earnedBadges: union of keys across sessions; running ignored', () => {
  const list = [
    sess('a', Date.UTC(2026, 4, 31, 15, 0), Date.UTC(2026, 4, 31, 23, 0), { awakeMin: 5 }), // rock
    sess('b', Date.UTC(2026, 4, 30, 14, 0), Date.UTC(2026, 4, 30, 17, 0)),                  // zombie (<5h)
    sess('c', Date.UTC(2026, 4, 29, 15, 0), null),                                          // running
  ];
  const set = earnedBadges(list);
  assert.ok(set.has('rock'));
  assert.ok(set.has('zombie'));
  assert.equal(earnedBadges([]).size, 0);
});

test('sleepDebt: sums only below-goal nights, tracked only', () => {
  const list = [
    sess('a', Date.UTC(2026, 4, 30, 14, 0), Date.UTC(2026, 4, 30, 20, 0)), // 05-30, 6h -> 2h debt
    sess('b', Date.UTC(2026, 4, 31, 14, 0), Date.UTC(2026, 4, 31, 23, 0)), // 05-31, 9h -> 0
  ];
  const r = sleepDebt(list, 480, 7, NOW);
  assert.equal(r.debtMin, 120);
  assert.equal(r.nightsCounted, 2);
});

test('sleepDebt: empty range -> zero', () => {
  assert.deepEqual(sleepDebt([], 480, 7, NOW), { debtMin: 0, nightsCounted: 0 });
});

test('sleepDebt: recomputes with goal', () => {
  const list = [sess('a', Date.UTC(2026, 4, 31, 14, 0), Date.UTC(2026, 4, 31, 20, 0))]; // 6h, 05-31
  assert.equal(sleepDebt(list, 420, 7, NOW).debtMin, 60);
  assert.equal(sleepDebt(list, 480, 7, NOW).debtMin, 120);
});

test('brainDumpVisible: same local day hidden, next day shown', () => {
  const created = new Date('2026-05-31T23:00:00').getTime();
  const sameDay = new Date('2026-05-31T23:30:00').getTime();
  const nextDay = new Date('2026-06-01T07:00:00').getTime();
  assert.equal(brainDumpVisible({ text: 'x', createdAt: created }, sameDay), false);
  assert.equal(brainDumpVisible({ text: 'x', createdAt: created }, nextDay), true);
});

test('brainDumpVisible: empty/null hidden', () => {
  const now = Date.now();
  assert.equal(brainDumpVisible({ text: '   ', createdAt: 0 }, now), false);
  assert.equal(brainDumpVisible(null, now), false);
});

test('pendingReveal: most recent unseen prior-day entry', () => {
  const d1 = new Date('2026-05-30T23:00:00').getTime();
  const d2 = new Date('2026-05-31T23:00:00').getTime();
  const now = new Date('2026-06-01T07:00:00').getTime();
  const dumps = [
    { id: 'a', text: 'older', createdAt: d1, seen: false },
    { id: 'b', text: 'newer', createdAt: d2, seen: false },
  ];
  assert.equal(pendingReveal(dumps, now).id, 'b');
});

test('pendingReveal: skips seen and same-day entries', () => {
  const prior = new Date('2026-05-31T23:00:00').getTime();
  const today = new Date('2026-06-01T01:00:00').getTime();
  const now = new Date('2026-06-01T07:00:00').getTime();
  assert.equal(pendingReveal([{ id: 'a', text: 'x', createdAt: prior, seen: true }], now), null);
  assert.equal(pendingReveal([{ id: 'b', text: 'x', createdAt: today, seen: false }], now), null);
  assert.equal(pendingReveal([], now), null);
  assert.equal(pendingReveal(null, now), null);
});
