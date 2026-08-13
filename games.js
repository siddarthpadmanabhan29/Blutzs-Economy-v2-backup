import { db, auth } from "./firebaseConfig.js";
import { doc, getDoc, updateDoc, increment, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "./historyManager.js";
import { computeDailyLoginClaim, getDefaultGamesConfig, getPrizeForDay } from "./gamesLogic.js";

let gamesConfig = getDefaultGamesConfig();
let gamesListener = null;
let configListener = null;
let timerInterval = null;
let latestUserData = null;

function formatPrize(prize) {
  const money = Number(prize?.money || 0);
  const bps = Number(prize?.bps || 0);
  if (!money && !bps) return "No prize";
  const parts = [];
  if (money) parts.push(`$${money.toLocaleString()}`);
  if (bps) parts.push(`${bps} BPS`);
  return parts.join(" + ");
}

// Returns true if two Date objects fall on the same LOCAL calendar day.
function isSameLocalDay(dateA, dateB) {
  return dateA.getFullYear() === dateB.getFullYear() &&
         dateA.getMonth() === dateB.getMonth() &&
         dateA.getDate() === dateB.getDate();
}

// Milliseconds remaining until the next local midnight (device/computer time).
function getMsUntilNextLocalMidnight() {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return nextMidnight.getTime() - now.getTime();
}

/**
 * Custom recovery payment-choice modal. Replaces window.confirm() with a
 * real three-way choice: pay cash, pay BPS, or cancel entirely (no forced
 * either/or). Resolves to "money", "bps", or null (cancelled / no action).
 */
function showRecoveryChoiceModal({ costMoney, costBps, hasMoney, hasBps }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.85);
      backdrop-filter: blur(6px); z-index: 10001;
      display: flex; align-items: center; justify-content: center;
    `;

    const box = document.createElement("div");
    box.style.cssText = `
      background: #1a1a1a; padding: 28px; border-radius: 18px;
      border: 2px solid #e74c3c; width: 300px; text-align: center;
      box-shadow: 0 0 30px rgba(231, 76, 60, 0.25);
    `;

    box.innerHTML = `
      <h4 style="color:#e74c3c; margin:0 0 6px 0; font-weight:800; text-transform:uppercase; letter-spacing:0.5px;">Purchase Recovery</h4>
      <p style="color:#aaa; font-size:0.8rem; margin-bottom:20px;">Choose how you'd like to pay to recover your streak.</p>
      <div style="display:flex; flex-direction:column; gap:10px;">
        <button id="recovery-pay-money" ${hasMoney ? "" : "disabled"} style="padding:12px; border-radius:10px; border:none; background:${hasMoney ? "#2ecc71" : "#333"}; color:${hasMoney ? "#000" : "#777"}; font-weight:900; cursor:${hasMoney ? "pointer" : "not-allowed"}; text-transform:uppercase; font-size:0.8rem;">
          Pay $${costMoney.toLocaleString()} Cash
        </button>
        <button id="recovery-pay-bps" ${hasBps ? "" : "disabled"} style="padding:12px; border-radius:10px; border:none; background:${hasBps ? "#8e44ad" : "#333"}; color:${hasBps ? "#fff" : "#777"}; font-weight:900; cursor:${hasBps ? "pointer" : "not-allowed"}; text-transform:uppercase; font-size:0.8rem;">
          Pay ${costBps} BPS
        </button>
        <button id="recovery-cancel-btn" style="padding:10px; border-radius:10px; border:1px solid #444; background:transparent; color:#aaa; font-weight:700; cursor:pointer; text-transform:uppercase; font-size:0.7rem; margin-top:6px;">
          Cancel
        </button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const cleanup = (result) => {
      document.body.removeChild(overlay);
      resolve(result);
    };

    box.querySelector("#recovery-pay-money")?.addEventListener("click", () => { if (hasMoney) cleanup("money"); });
    box.querySelector("#recovery-pay-bps")?.addEventListener("click", () => { if (hasBps) cleanup("bps"); });
    box.querySelector("#recovery-cancel-btn").addEventListener("click", () => cleanup(null));
    // Clicking the dark backdrop also counts as cancel, same as pressing Esc would.
    overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(null); });
  });
}

function startTimer(lastClaimDate) {
  if (timerInterval) clearInterval(timerInterval);

  const timerEl = document.getElementById("games-timer");
  if (!timerEl) return;

  const updateTimer = () => {
    if (!lastClaimDate) {
      timerEl.textContent = "Ready to claim now!";
      timerEl.style.color = "#2ecc71";
      if (timerInterval) clearInterval(timerInterval);
      return;
    }

    const parsedDate = new Date(lastClaimDate);
    if (isNaN(parsedDate.getTime())) {
      timerEl.textContent = "Ready to claim now!";
      timerEl.style.color = "#2ecc71";
      if (timerInterval) clearInterval(timerInterval);
      return;
    }

    const now = new Date();

    // If the last claim wasn't today (local time), a new day has already
    // started, so the user is free to claim/recover right now.
    if (!isSameLocalDay(parsedDate, now)) {
      timerEl.textContent = "Ready to claim now!";
      timerEl.style.color = "#2ecc71";
      if (timerInterval) clearInterval(timerInterval);
      return;
    }

    // Otherwise, count down to the moment the local clock hits 12:00 AM
    // the next day (device/computer local time).
    const remaining = getMsUntilNextLocalMidnight();

    if (remaining <= 0) {
      timerEl.textContent = "Ready to claim now!";
      timerEl.style.color = "#2ecc71";
      if (timerInterval) clearInterval(timerInterval);
      return;
    }

    const hours = Math.floor(remaining / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
    const seconds = Math.floor((remaining % (60 * 1000)) / 1000);
    timerEl.textContent = `${hours}h ${minutes}m ${seconds}s`;
    timerEl.style.color = remaining < 3600000 ? "#f39c12" : "#3498db";
  };

  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
}

function updateDayTracker(currentDay, lastClaimDate) {
  const tracker = document.getElementById("games-day-tracker");
  if (!tracker) return;

  const dayItems = tracker.querySelectorAll(".games-day-item");
  dayItems.forEach((item) => {
    const day = Number(item.dataset.day);
    item.style.background = day < currentDay ? "rgba(212, 175, 55, 0.3)" : "rgba(255,255,255,0.05)";
    item.style.border = day < currentDay ? "2px solid #d4af37" : "1px solid rgba(255,255,255,0.1)";
    item.style.color = day < currentDay ? "#d4af37" : "#fff";
    item.style.textShadow = day < currentDay ? "0 0 8px rgba(212, 175, 55, 0.5)" : "none";
  });
}

function getTodayKey() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function setStatus(message, color = "#f1c40f") {
  const el = document.getElementById("games-status-msg");
  if (el) {
    el.textContent = message;
    el.style.color = color;
  }
}

// Always renders the recovery section/button. Unlocked (clickable) ONLY when
// the claim state is exactly "recoverable-miss" (missed exactly one day).
// In every other state (already claimed, ready to claim, or missed more than
// one day so the streak fully reset) it renders visible but locked/disabled.
function updateRecoveryUI(claimState, recoveryCost) {
  const recoverySection = document.getElementById("games-recovery-section");
  const recoveryBtn = document.getElementById("games-recovery-btn");

  if (recoverySection) recoverySection.style.display = "block";
  if (!recoveryBtn) return;

  const isRecoverable = claimState.status === "recoverable-miss";

  recoveryBtn.style.display = "block";

  if (isRecoverable) {
    recoveryBtn.disabled = false;
    recoveryBtn.textContent = `🔓 Purchase Recovery - $${Number(recoveryCost.money || 0).toLocaleString()} or ${Number(recoveryCost.bps || 0)} BPS`;
    recoveryBtn.style.opacity = "1";
    recoveryBtn.style.cursor = "pointer";
  } else {
    recoveryBtn.disabled = true;
    recoveryBtn.textContent = "🔒 Recovery Locked";
    recoveryBtn.style.opacity = "0.5";
    recoveryBtn.style.cursor = "not-allowed";
  }
}

function renderGamesUI(userData, claimState) {
  const streakEl = document.getElementById("games-streak-display");
  const dayCardEl = document.getElementById("games-day-card");
  const prizeEl = document.getElementById("games-prize-display");
  const recoveryEl = document.getElementById("games-recovery-cost");
  const lastClaimEl = document.getElementById("games-last-claim");
  const confirmBtn = document.getElementById("games-confirm-btn");

  const currentDay = Number(userData?.dailyLoginDay || 1);
  const prize = getPrizeForDay(gamesConfig, currentDay);
  const recoveryCost = gamesConfig.recoveryCost || { money: 5000, bps: 2 };
  const lastClaimDate = userData?.lastDailyLoginDate;

  if (streakEl) streakEl.textContent = `Day ${currentDay}`;
  if (dayCardEl) dayCardEl.textContent = `Day ${currentDay}`;
  if (prizeEl) prizeEl.textContent = formatPrize(prize);
  if (recoveryEl) recoveryEl.textContent = `Recovery available for $${Number(recoveryCost.money || 0).toLocaleString()} or ${Number(recoveryCost.bps || 0)} BPS.`;

  if (lastClaimEl) {
    lastClaimEl.textContent = lastClaimDate ? new Date(lastClaimDate).toLocaleDateString() : "No confirmation yet.";
  }

  updateDayTracker(currentDay, lastClaimDate);
  startTimer(lastClaimDate);

  // Recovery section/button is always shown; lock state depends on claimState.
  updateRecoveryUI(claimState, recoveryCost);

  if (claimState.status === "already-claimed") {
    setStatus("You already confirmed today. Come back tomorrow for the next day.", "#2ecc71");
    confirmBtn.disabled = true;
    confirmBtn.textContent = "✓ Confirmed Today";
    confirmBtn.style.background = "linear-gradient(135deg, #27ae60, #229954)";
    return;
  }

  if (claimState.status === "recoverable-miss") {
    setStatus("You missed the previous day. You can recover once for the cost below.", "#f1c40f");
    confirmBtn.disabled = false;
    confirmBtn.textContent = "Recover & Continue";
    confirmBtn.style.background = "linear-gradient(135deg, #e74c3c, #c0392b)";
    return;
  }

  if (claimState.status === "claim") {
    setStatus(`Ready to confirm Day ${currentDay}.`, "#2ecc71");
    confirmBtn.disabled = false;
    confirmBtn.textContent = "Confirm Daily Login";
    confirmBtn.style.background = "linear-gradient(135deg, #8e44ad, #6c5ce7)";
    return;
  }

  setStatus("Your streak needs a fresh start. Confirm again to begin Day 1.", "#f1c40f");
  confirmBtn.disabled = false;
  confirmBtn.textContent = "Start New Streak";
  confirmBtn.style.background = "linear-gradient(135deg, #f39c12, #d68910)";
}

// Recomputes claim state from the latest cached user data and re-renders.
// Called whenever EITHER the user doc OR the games config doc changes,
// so admin edits to prizes/recovery cost reflect immediately without
// requiring the player to reload the page.
function rerenderFromLatest() {
  if (!latestUserData) return;
  const claimState = computeDailyLoginClaim({
    currentDay: Number(latestUserData.dailyLoginDay || 1),
    lastClaimDate: latestUserData.lastDailyLoginDate || null,
    today: getTodayKey()
  });
  renderGamesUI(latestUserData, claimState);
}

export async function initGamesUI() {
  const confirmBtn = document.getElementById("games-confirm-btn");
  const recoveryBtn = document.getElementById("games-recovery-btn");

  if (!confirmBtn) return;

  // One-time bootstrap: make sure the config doc exists before we
  // attach the live listener below.
  const configRef = doc(db, "games", "dailyLogin");
  const configSnapOnce = await getDoc(configRef);
  if (configSnapOnce.exists()) {
    gamesConfig = configSnapOnce.data();
  } else {
    gamesConfig = getDefaultGamesConfig();
    await setDoc(configRef, gamesConfig);
  }

  if (gamesListener) gamesListener();
  if (configListener) configListener();

  const user = auth.currentUser;
  if (!user) return;

  // LIVE config listener: any admin save to games/dailyLogin now
  // reflects immediately for players already viewing the Games tab,
  // instead of requiring a full page reload.
  configListener = onSnapshot(configRef, (configSnap) => {
    if (configSnap.exists()) {
      gamesConfig = configSnap.data();
    } else {
      gamesConfig = getDefaultGamesConfig();
    }
    rerenderFromLatest();
  });

  const userRef = doc(db, "users", user.uid);
  gamesListener = onSnapshot(userRef, async (snap) => {
    if (!snap.exists()) return;
    latestUserData = snap.data();
    rerenderFromLatest();
  });

  confirmBtn.onclick = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return;

    const userData = userSnap.data();
    const claimState = computeDailyLoginClaim({
      currentDay: Number(userData.dailyLoginDay || 1),
      lastClaimDate: userData.lastDailyLoginDate || null,
      today: getTodayKey()
    });

    if (claimState.status === "already-claimed") {
      setStatus("You already confirmed today. Come back tomorrow for the next day.", "#2ecc71");
      return;
    }

    const recoveryCost = gamesConfig.recoveryCost || { money: 5000, bps: 2 };
    const claimDay = Number(claimState.dayToClaim || 1);
    const prize = getPrizeForDay(gamesConfig, claimDay);

    if (claimState.status === "recoverable-miss") {
      const hasMoney = Number(userData.balance || 0) >= Number(recoveryCost.money || 0);
      const hasBps = Number(userData.bpsBalance || 0) >= Number(recoveryCost.bps || 0);
      if (!hasMoney && !hasBps) {
        setStatus("You need enough funds or BPS to recover the lost streak.", "#e74c3c");
        return;
      }

      let paymentMethod = null;
      if (hasMoney && !hasBps) {
        paymentMethod = "money";
      } else if (hasBps && !hasMoney) {
        paymentMethod = "bps";
      } else {
        // Both affordable — let the user pick via the custom modal
        // (real Cancel option, no forced either/or).
        paymentMethod = await showRecoveryChoiceModal({
          costMoney: Number(recoveryCost.money || 0),
          costBps: Number(recoveryCost.bps || 0),
          hasMoney,
          hasBps
        });
      }

      if (!paymentMethod) {
        setStatus("Recovery cancelled.", "#888");
        return;
      }

      if (paymentMethod === "money") {
        await updateDoc(userRef, { balance: increment(-Number(recoveryCost.money || 0)), lastDailyLoginDate: getTodayKey(), dailyLoginDay: Number(userData.dailyLoginDay || 1) });
      } else {
        await updateDoc(userRef, { bpsBalance: increment(-Number(recoveryCost.bps || 0)), lastDailyLoginDate: getTodayKey(), dailyLoginDay: Number(userData.dailyLoginDay || 1) });
      }

      await logHistory(user.uid, "Recovered daily login streak", "usage");
      setStatus("Streak recovered. Your next login day is ready.", "#2ecc71");
      return;
    }

    const payout = prize || { money: 0, bps: 0 };

    const updates = {
      lastDailyLoginDate: new Date().toISOString(),
      dailyLoginDay: Number(claimState.nextDay || (claimDay + 1 > 7 ? 1 : claimDay + 1))
    };

    if (payout.money) updates.balance = increment(payout.money);
    if (payout.bps) updates.bpsBalance = increment(payout.bps);

    await updateDoc(userRef, updates);
    await logHistory(user.uid, `Confirmed daily login Day ${claimDay}${payout.money || payout.bps ? ` and received ${formatPrize(payout)}` : ""}`, "transfer-in");
    setStatus(`Confirmed Day ${claimDay}. ${payout.money || payout.bps ? `You received ${formatPrize(payout)}.` : "No prize this time."}`, "#2ecc71");
  };

  recoveryBtn.onclick = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return;
    const userData = userSnap.data();

    // Guard: only allow this action if the user is actually in a
    // recoverable-miss state (missed exactly one day, not zero, not more).
    const claimState = computeDailyLoginClaim({
      currentDay: Number(userData.dailyLoginDay || 1),
      lastClaimDate: userData.lastDailyLoginDate || null,
      today: getTodayKey()
    });
    if (claimState.status !== "recoverable-miss") {
      setStatus("Recovery is only available if you missed exactly one day.", "#e74c3c");
      return;
    }

    const recoveryCost = gamesConfig.recoveryCost || { money: 5000, bps: 2 };
    const hasMoney = Number(userData.balance || 0) >= Number(recoveryCost.money || 0);
    const hasBps = Number(userData.bpsBalance || 0) >= Number(recoveryCost.bps || 0);
    
    if (!hasMoney && !hasBps) {
      setStatus("Insufficient funds. You need $" + Number(recoveryCost.money || 0).toLocaleString() + " or " + Number(recoveryCost.bps || 0) + " BPS to recover.", "#e74c3c");
      return;
    }

    let paymentMethod = null;
    if (hasMoney && !hasBps) {
      paymentMethod = "money";
    } else if (hasBps && !hasMoney) {
      paymentMethod = "bps";
    } else {
      // Both affordable — let the user pick via the custom modal
      // (real Cancel option, no forced either/or).
      paymentMethod = await showRecoveryChoiceModal({
        costMoney: Number(recoveryCost.money || 0),
        costBps: Number(recoveryCost.bps || 0),
        hasMoney,
        hasBps
      });
    }

    if (!paymentMethod) {
      setStatus("Recovery cancelled.", "#888");
      return;
    }

    if (paymentMethod === "money") {
      await updateDoc(userRef, { 
        balance: increment(-Number(recoveryCost.money || 0)), 
        lastDailyLoginDate: new Date().toISOString(), 
        dailyLoginDay: Number(userData.dailyLoginDay || 1) 
      });
      await logHistory(user.uid, `Purchased daily login recovery for $${Number(recoveryCost.money || 0).toLocaleString()}`, "usage");
    } else {
      await updateDoc(userRef, { 
        bpsBalance: increment(-Number(recoveryCost.bps || 0)), 
        lastDailyLoginDate: new Date().toISOString(), 
        dailyLoginDay: Number(userData.dailyLoginDay || 1) 
      });
      await logHistory(user.uid, `Purchased daily login recovery for ${Number(recoveryCost.bps || 0)} BPS`, "usage");
    }

    setStatus("Streak recovered! Your next login day is ready.", "#2ecc71");
  };
}

export async function saveGamesSettings(config) {
  const mergedConfig = {
    ...getDefaultGamesConfig(),
    ...config,
    dailyLoginPrizes: { ...(getDefaultGamesConfig().dailyLoginPrizes), ...(config?.dailyLoginPrizes || {}) },
    recoveryCost: { money: Number(config?.recoveryCost?.money || 5000), bps: Number(config?.recoveryCost?.bps || 2) }
  };
  await setDoc(doc(db, "games", "dailyLogin"), mergedConfig);
  gamesConfig = mergedConfig;
}

export function getGamesConfig() {
  return gamesConfig;
}