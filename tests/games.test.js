import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDailyLoginClaim, getDefaultGamesConfig, getPrizeForDay } from '../gamesLogic.js';

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
});
