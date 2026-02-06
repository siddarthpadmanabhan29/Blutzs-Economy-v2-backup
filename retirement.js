// ---------- retirement.js (FIXED & OPTIMIZED) ----------
console.log("retirement.js loaded");

import { db, auth } from "./firebaseConfig.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "./historyManager.js";

// ---------- Elements ----------
const savingsEl = document.getElementById("retirement-savings");
const interestEl = document.getElementById("retirement-interest");
const daysEl = document.getElementById("retirement-days");
const depositInput = document.getElementById("retirement-deposit");
const depositBtn = document.getElementById("retirement-deposit-btn");
const withdrawInput = document.getElementById("retirement-withdraw");
const withdrawBtn = document.getElementById("retirement-withdraw-btn");
const messageEl = document.getElementById("retirement-message");

// --- LOCAL STATE ---
let cachedUserData = null; // Stores the latest snapshot from dashboard.js
let retirementBusy = false; 

// ---------- Render Retirement UI ----------
/**
 * This is called live by dashboard.js on every database change.
 * It also keeps our 'cachedUserData' fresh for the buttons below.
 */
function renderSavings(userData) {
  if (!userData || !savingsEl) return;
  
  // Save the data so the Deposit/Withdraw buttons can use it later
  cachedUserData = userData;

  const savings = Number(userData.retirementSavings || 0);
  const status = userData.employmentStatus || "Unemployed";

  // Calculate Days Until 1st of Next Month
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const diffTime = nextMonth - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  // --- BIG NUMBER FORMATTING ---
  savingsEl.textContent = savings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  interestEl.textContent = (savings * 0.03).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  daysEl.textContent = diffDays;

  // Handle Button States based on Processing or Employment
  if (retirementBusy) {
    toggleInputs(true);
    return;
  }

  if (status === "Employed") {
    depositBtn.disabled = false;
    withdrawBtn.disabled = true;
    depositInput.disabled = false;
    withdrawInput.disabled = true;
  } else if (status === "Retired") {
    depositBtn.disabled = true;
    withdrawBtn.disabled = false;
    depositInput.disabled = true;
    withdrawInput.disabled = false;
  } else {
    toggleInputs(true); // Unemployed/Other cannot interact
  }
  
  // Check for monthly interest payout automatically
  applyInterestIfFirstDay(userData);
}

function toggleInputs(disabled) {
    if (depositBtn) depositBtn.disabled = disabled;
    if (withdrawBtn) withdrawBtn.disabled = disabled;
    if (depositInput) depositInput.disabled = disabled;
    if (withdrawInput) withdrawInput.disabled = disabled;
}

// ---------- Deposit Logic ----------
depositBtn?.addEventListener("click", async () => {
  // Use the cached data we saved in renderSavings
  if (retirementBusy || !auth.currentUser || !cachedUserData) {
    return showMsg("⚠️ System initializing, try again in a second...", "error");
  }

  const amount = parseFloat(depositInput.value);
  if (isNaN(amount) || amount <= 0) return showMsg("⚠️ Enter a valid deposit amount", "error");

  // Validate using cached data (0 reads cost!)
  if (cachedUserData.balance < amount) return showMsg("❌ Insufficient main balance", "error");
  if (cachedUserData.employmentStatus !== "Employed") return showMsg("❌ Only employed users can deposit", "error");

  retirementBusy = true;
  showMsg("Processing deposit...", "success");

  try {
    const userRef = doc(db, "users", auth.currentUser.uid);

    const newBalance = cachedUserData.balance - amount;
    const newSavings = (cachedUserData.retirementSavings || 0) + amount;

    await updateDoc(userRef, {
      balance: newBalance,
      retirementSavings: newSavings
    });

    await logHistory(auth.currentUser.uid, `Retirement Deposit: $${amount.toLocaleString()}`, "transfer-out");

    depositInput.value = "";
    showMsg(`✅ Successfully deposited $${amount.toLocaleString()}`, "success");
  } catch (err) {
    console.error(err);
    showMsg("Deposit failed: " + err.message, "error");
  } finally {
    retirementBusy = false;
    renderSavings(cachedUserData);
  }
});

// ---------- Withdrawal Logic ----------
withdrawBtn?.addEventListener("click", async () => {
  if (retirementBusy || !auth.currentUser || !cachedUserData) {
    return showMsg("⚠️ System initializing...", "error");
  }

  const amount = parseFloat(withdrawInput.value);
  if (isNaN(amount) || amount <= 0) return showMsg("⚠️ Enter a valid withdrawal amount", "error");

  // Validate using cached data (0 reads cost!)
  if (cachedUserData.employmentStatus !== "Retired") return showMsg("❌ Only retired users can withdraw", "error");
  if ((cachedUserData.retirementSavings || 0) < amount) return showMsg("❌ Insufficient retirement savings", "error");

  retirementBusy = true;
  showMsg("Processing withdrawal...", "success");

  try {
    const userRef = doc(db, "users", auth.currentUser.uid);

    const newBalance = cachedUserData.balance + amount;
    const newSavings = cachedUserData.retirementSavings - amount;

    await updateDoc(userRef, {
      balance: newBalance,
      retirementSavings: newSavings
    });

    await logHistory(auth.currentUser.uid, `Retirement Withdrawal: $${amount.toLocaleString()}`, "transfer-in");

    withdrawInput.value = "";
    showMsg(`✅ Successfully withdrew $${amount.toLocaleString()}`, "success");
  } catch (err) {
    console.error(err);
    showMsg("Withdrawal failed: " + err.message, "error");
  } finally {
    retirementBusy = false;
    renderSavings(cachedUserData);
  }
});

// ---------- Monthly Interest Logic ----------
async function applyInterestIfFirstDay(userData) {
  if (!userData?.retirementSavings || userData.retirementSavings <= 0) return;

  const now = new Date();
  if (now.getDate() !== 1) return; // Only run on the 1st
  
  const monthKey = now.toISOString().slice(0, 7); 
  if (userData.lastInterestApplied?.startsWith(monthKey)) return;

  const interest = userData.retirementSavings * 0.03;
  const userRef = doc(db, "users", auth.currentUser.uid);

  try {
    await updateDoc(userRef, {
      retirementSavings: userData.retirementSavings + interest,
      lastInterestApplied: now.toISOString()
    });

    await logHistory(auth.currentUser.uid, `Monthly Interest Gained: $${interest.toFixed(2)}`, "usage");
  } catch (err) {
    console.error("Interest application failed:", err);
  }
}

// ---------- Notifications ----------
function showMsg(msg, type) {
  if (!messageEl) return;
  messageEl.textContent = msg;
  messageEl.style.color = type === "error" ? "#e74c3c" : "#2ecc71";
  messageEl.style.fontWeight = "bold";
  setTimeout(() => { if(messageEl.textContent === msg) messageEl.textContent = ""; }, 4000);
}

// ---------- Export ----------
export { renderSavings };