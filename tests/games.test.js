import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDailyLoginClaim, getCompletedDailyLoginScheduleDay, getDailyLoginScheduleDay, getDefaultGamesConfig, getLocalDateKey, getPrizeForDay } from '../gamesLogic.js';

test('keeps date-only claim timestamps on their stored local calendar day', () => {
  assert.equal(getLocalDateKey('2026-10-25'), '2026-10-25');
});

test('starts a new streak on the first claim', () => {
  const result = computeDailyLoginClaim({
    currentDay: 1,
    lastClaimDate: null,
    today: '2026-08-02'
  });

  assert.equal(result.status, 'claim');
  assert.equal(result.dayToClaim, 1);
  assert.equal(result.nextDay, 2);
});

test('continues the streak for the next day', () => {
  const result = computeDailyLoginClaim({
    currentDay: 2,
    lastClaimDate: '2026-08-01',
    today: '2026-08-02'
  });

  assert.equal(result.status, 'claim');
  assert.equal(result.dayToClaim, 2);
  assert.equal(result.nextDay, 3);
});

test('keeps the streak count increasing after the seventh reward day', () => {
  const result = computeDailyLoginClaim({
    currentDay: 7,
    lastClaimDate: '2026-08-01',
    today: '2026-08-02'
  });

  assert.equal(result.status, 'claim');
  assert.equal(result.dayToClaim, 7);
  assert.equal(result.streakDayToClaim, 7);
  assert.equal(result.nextDay, 8);
});

test('keeps the total streak while cycling to the matching reward day', () => {
  assert.equal(getDailyLoginScheduleDay(8), 1);
  assert.equal(getDailyLoginScheduleDay(14), 7);

  const result = computeDailyLoginClaim({
    currentDay: 11,
    lastClaimDate: '2026-08-01',
    today: '2026-08-02'
  });

  assert.equal(result.status, 'claim');
  assert.equal(result.streakDayToClaim, 11);
  assert.equal(result.dayToClaim, 4);
  assert.equal(result.nextDay, 12);
});

test('retains the full streak day when already claimed on day 14', () => {
  const result = computeDailyLoginClaim({
    currentDay: 15,
    lastClaimDate: '2026-08-02',
    today: '2026-08-02'
  });

  assert.equal(result.status, 'already-claimed');
  assert.equal(result.streakDayToClaim, 14);
  assert.equal(result.dayToClaim, 7);
  assert.equal(getCompletedDailyLoginScheduleDay(result), 7);
});

test('resets completed reward days when the next cycle is ready to claim', () => {
  const result = computeDailyLoginClaim({
    currentDay: 15,
    lastClaimDate: '2026-08-01',
    today: '2026-08-02'
  });

  assert.equal(result.streakDayToClaim, 15);
  assert.equal(result.dayToClaim, 1);
  assert.equal(getCompletedDailyLoginScheduleDay(result), 0);
});

test('starts the new reward cycle after day 14 is claimed', () => {
  const result = computeDailyLoginClaim({
    currentDay: 16,
    lastClaimDate: '2026-08-02',
    today: '2026-08-02'
  });

  assert.equal(result.status, 'already-claimed');
  assert.equal(result.streakDayToClaim, 15);
  assert.equal(result.dayToClaim, 1);
  assert.equal(getCompletedDailyLoginScheduleDay(result), 1);
});

test('marks completed days in the new reward cycle after day 16 is claimed', () => {
  const result = computeDailyLoginClaim({
    currentDay: 17,
    lastClaimDate: '2026-08-03',
    today: '2026-08-03'
  });

  assert.equal(result.streakDayToClaim, 16);
  assert.equal(result.dayToClaim, 2);
  assert.equal(getCompletedDailyLoginScheduleDay(result), 2);
});

test('flags a one-day miss as recoverable', () => {
  const result = computeDailyLoginClaim({
    currentDay: 3,
    lastClaimDate: '2026-07-31',
    today: '2026-08-02'
  });

  assert.equal(result.status, 'recoverable-miss');
  assert.equal(result.dayToClaim, 3);
  assert.equal(result.recoveryEligible, true);
});

test('returns the configured prize for each day', () => {
  const config = getDefaultGamesConfig();
  assert.deepEqual(getPrizeForDay(config, 2), { money: 500, bps: 0 });
  assert.deepEqual(getPrizeForDay(config, 4), { money: 0, bps: 1 });
  assert.deepEqual(getPrizeForDay(config, 6), { money: 5000, bps: 0 });
  assert.deepEqual(getPrizeForDay(config, 7), { money: 1000, bps: 5 });
  assert.deepEqual(getPrizeForDay(config, 8), getPrizeForDay(config, 1));
  assert.deepEqual(getPrizeForDay(config, 11), getPrizeForDay(config, 4));
});
