export function getDefaultGamesConfig() {
  return {
    dailyLoginPrizes: {
      1: { money: 0, bps: 0 },
      2: { money: 500, bps: 0 },
      3: { money: 0, bps: 0 },
      4: { money: 0, bps: 1 },
      5: { money: 0, bps: 0 },
      6: { money: 5000, bps: 0 },
      7: { money: 1000, bps: 5 }
    },
    recoveryCost: { money: 5000, bps: 2 }
  };
}

const DAILY_LOGIN_SCHEDULE_LENGTH = 7;

export function getDailyLoginScheduleDay(day) {
  const numericDay = Number(day);
  if (!Number.isFinite(numericDay) || numericDay < 1) return 1;
  return ((Math.floor(numericDay) - 1) % DAILY_LOGIN_SCHEDULE_LENGTH) + 1;
}

export function getCompletedDailyLoginScheduleDay(claimState) {
  if (claimState.status === 'missed') return 0;

  const scheduleDay = getDailyLoginScheduleDay(claimState.dayToClaim);
  if (claimState.status === 'already-claimed') return scheduleDay;
  if (claimState.streakDayToClaim <= 1 && claimState.status !== 'already-claimed') return 0;

  return scheduleDay - 1;
}

export function getPrizeForDay(config, day) {
  return config?.dailyLoginPrizes?.[getDailyLoginScheduleDay(day)] || { money: 0, bps: 0 };
}

export function getLocalDateKey(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function computeDailyLoginClaim({ currentDay, lastClaimDate, today }) {
  const numericDay = Number(currentDay);
  const streakDay = Number.isFinite(numericDay) && numericDay >= 1 ? Math.floor(numericDay) : 1;
  const scheduleDay = getDailyLoginScheduleDay(streakDay);
  const nextStreakDay = streakDay + 1;

  const normalizedToday = today || getLocalDateKey(new Date());
  const normalizedLast = lastClaimDate || null;

  if (!normalizedLast) {
    return { status: 'claim', streakDayToClaim: 1, dayToClaim: 1, nextDay: 2, recoveryEligible: false };
  }

  // Extract the LOCAL date part from lastClaimDate (handles both
  // "YYYY-MM-DD" and full ISO datetime strings correctly).
  const lastDateStr = getLocalDateKey(normalizedLast);
  if (!lastDateStr) {
    return { status: 'claim', streakDayToClaim: 1, dayToClaim: 1, nextDay: 2, recoveryEligible: false };
  }

  const lastDate = new Date(lastDateStr + "T00:00:00");
  const todayDate = new Date(normalizedToday + "T00:00:00");
  const dayDiff = Math.round((todayDate - lastDate) / 86400000);

  if (dayDiff === 1) {
    return { status: 'claim', streakDayToClaim: streakDay, dayToClaim: scheduleDay, nextDay: nextStreakDay, recoveryEligible: false };
  }

  if (dayDiff === 0) {
    const claimedStreakDay = Math.max(1, streakDay - 1);
    return {
      status: 'already-claimed',
      streakDayToClaim: claimedStreakDay,
      dayToClaim: getDailyLoginScheduleDay(claimedStreakDay),
      nextDay: streakDay,
      recoveryEligible: false
    };
  }

  if (dayDiff === 2) {
    return { status: 'recoverable-miss', streakDayToClaim: streakDay, dayToClaim: scheduleDay, nextDay: 1, recoveryEligible: true };
  }

  return { status: 'missed', streakDayToClaim: 1, dayToClaim: 1, nextDay: 2, recoveryEligible: false };
}