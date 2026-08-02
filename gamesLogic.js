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

export function getPrizeForDay(config, day) {
  return config?.dailyLoginPrizes?.[day] || { money: 0, bps: 0 };
}

// Extracts the LOCAL calendar date (YYYY-MM-DD) from either a plain
// "YYYY-MM-DD" string or a full ISO datetime string. This avoids the
// bug where slicing the raw ISO string grabbed the UTC date instead
// of the user's local date near midnight boundaries.
function toLocalDateKey(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
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
  // Get local date for today
  const getTodayLocalDate = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const normalizedToday = today || getTodayLocalDate();
  const normalizedLast = lastClaimDate || null;

  if (!normalizedLast) {
    return { status: 'claim', dayToClaim: 1, nextDay: 2, recoveryEligible: false };
  }

  // Extract the LOCAL date part from lastClaimDate (handles both
  // "YYYY-MM-DD" and full ISO datetime strings correctly).
  const lastDateStr = toLocalDateKey(normalizedLast);
  if (!lastDateStr) {
    return { status: 'claim', dayToClaim: 1, nextDay: 2, recoveryEligible: false };
  }

  const lastDate = new Date(lastDateStr + "T00:00:00");
  const todayDate = new Date(normalizedToday + "T00:00:00");
  const dayDiff = Math.round((todayDate - lastDate) / 86400000);

  if (dayDiff === 1) {
    return { status: 'claim', dayToClaim: currentDay, nextDay: currentDay + 1, recoveryEligible: false };
  }

  if (dayDiff === 0) {
    return { status: 'already-claimed', dayToClaim: currentDay, nextDay: currentDay + 1, recoveryEligible: false };
  }

  if (dayDiff === 2) {
    return { status: 'recoverable-miss', dayToClaim: currentDay, nextDay: 1, recoveryEligible: true };
  }

  return { status: 'missed', dayToClaim: 1, nextDay: 2, recoveryEligible: false };
}