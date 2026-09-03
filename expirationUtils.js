import { increment } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function toValidDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getThirtyDayExpiryIso(baseDate = new Date()) {
  const sourceDate = toValidDate(baseDate) || new Date();
  return new Date(sourceDate.getTime() + THIRTY_DAYS_MS).toISOString();
}

export function formatTimeRemaining(targetDate, now = new Date()) {
  const validTarget = toValidDate(targetDate);
  if (!validTarget) return "No expiration set";

  const currentDate = toValidDate(now) || new Date();
  const diffMs = validTarget.getTime() - currentDate.getTime();
  const isOverdue = diffMs < 0;
  const absMinutes = Math.max(0, Math.floor(Math.abs(diffMs) / 60000));
  const days = Math.floor(absMinutes / 1440);
  const hours = Math.floor((absMinutes % 1440) / 60);
  const minutes = absMinutes % 60;
  const parts = [];

  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (days === 0 && hours === 0) parts.push(`${minutes}m`);

  const label = parts.join(" ") || "0m";
  return isOverdue ? `Overdue by ${label}` : `Expires in ${label}`;
}

export function getInventoryExpiryInfo(item, now = new Date()) {
  const acquiredAt = toValidDate(item?.acquiredAt);
  const expiresAt = toValidDate(item?.expiresAt) || (acquiredAt ? new Date(acquiredAt.getTime() + THIRTY_DAYS_MS) : null);
  const currentDate = toValidDate(now) || new Date();

  return {
    acquiredAt,
    expiresAt,
    expiresLabel: expiresAt ? formatTimeRemaining(expiresAt, currentDate) : "No expiration set",
    expiresAtText: expiresAt ? expiresAt.toLocaleString() : "N/A",
    isExpired: Boolean(expiresAt && expiresAt.getTime() <= currentDate.getTime()),
  };
}

export function getBpsDecayInfo(userData, now = new Date()) {
  const balance = Number(userData?.bpsBalance || 0);
  const expiryAt = toValidDate(userData?.bpsExpiryAt);
  const currentDate = toValidDate(now) || new Date();
  const decayAmount = balance > 0 ? Math.min(10, balance) : 0;

  return {
    balance,
    expiryAt,
    decayAmount,
    expiresLabel: balance > 0 && expiryAt ? formatTimeRemaining(expiryAt, currentDate) : "Inactive",
    expiresAtText: balance > 0 && expiryAt ? expiryAt.toLocaleString() : "Inactive",
    isActive: balance > 0,
    isOverdue: Boolean(balance > 0 && expiryAt && expiryAt.getTime() <= currentDate.getTime()),
  };
}

export function buildBpsBalanceUpdate(currentData, delta, now = new Date()) {
  const currentBalance = Number(currentData?.bpsBalance || 0);
  const nextBalance = Math.max(0, currentBalance + delta);
  const updates = { bpsBalance: increment(delta) };

  if (nextBalance <= 0) {
    updates.bpsExpiryAt = null;
  } else if (delta > 0 && !currentData?.bpsExpiryAt) {
    updates.bpsExpiryAt = getThirtyDayExpiryIso(now);
  }

  return updates;
}