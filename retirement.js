// ---------- retirement.js ----------
console.log("retirement.js loaded");

import { db, auth } from "./firebaseConfig.js";
import { doc, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { updateBalanceDisplay } from "./main.js";
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

let currentUserData = null;
let retirementBusy = false; // 🔒 prevents spam clicks

// ---------- Load user data ----------
auth.onAuthStateChanged((user) => {
  if (!user) return;

  const userRef = doc(db, "users", user.uid);

  onSnapshot(userRef, (docSnap) => {
    if (!docSnap.exists()) return;
    currentUserData = docSnap.data();
    renderSavings();
    applyInterestIfFirstDay();
  });
});

// ---------- Render Retirement UI ----------
function renderSavings() {
  if (!currentUserData) return;

  const savings = Number(currentUserData.retirementSavings || 0);
  const status = currentUserData.employmentStatus || "Unemployed";

  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const diffDays = Math.ceil((nextMonth - now) / (1000 * 60 * 60 * 24));

  savingsEl.textContent = savings.toFixed(2);
  interestEl.textContent = (savings * 0.03).toFixed(2);
  daysEl.textContent = diffDays;

  // Disable everything while processing
  if (retirementBusy) {
    depositBtn.disabled = true;
    withdrawBtn.disabled = true;
    depositInput.disabled = true;
    withdrawInput.disabled = true;
    return;
  }

  // Enable / Disable based on employment status
  if (status === "Employed") {
    depositBtn.disabled = false;
    withdrawBtn.disabled = true;
    depositInput.disabled = false;
    withdrawInput.disabled = true;
  } else if (status === "Unemployed") {
    depositBtn.disabled = true;
    withdrawBtn.disabled = true;
    depositInput.disabled = true;
    withdrawInput.disabled = true;
  } else if (status === "Retired") {
    depositBtn.disabled = true;
    withdrawBtn.disabled = false;
    depositInput.disabled = true;
    withdrawInput.disabled = false;
  }
}

// ---------- Deposit ----------
depositBtn.addEventListener("click", async () => {
  if (!currentUserData || retirementBusy) return;

  const amount = parseFloat(depositInput.value);
  if (isNaN(amount) || amount <= 0) return showMsg("Enter a valid deposit", "error");
  if (currentUserData.employmentStatus !== "Employed") return showMsg("Only employed users can deposit", "error");
  if (currentUserData.balance < amount) return showMsg("Insufficient main balance", "error");

  retirementBusy = true;
  renderSavings();

  try {
    const userRef = doc(db, "users", auth.currentUser.uid);

    const newBalance = currentUserData.balance - amount;
    const newSavings = (currentUserData.retirementSavings || 0) + amount;

    await updateDoc(userRef, {
      balance: newBalance,
      retirementSavings: newSavings
    });

    await logHistory(auth.currentUser.uid, `Deposited $${amount}`, "transfer-out");
    updateBalanceDisplay(newBalance, "user-balance", "loss");

    depositInput.value = "";
    showMsg(`Deposited $${amount}`, "success");
  } catch (err) {
    console.error(err);
    showMsg("Deposit failed: " + err.message, "error");
  } finally {
    retirementBusy = false;
    renderSavings();
  }
});

// ---------- Withdraw ----------
withdrawBtn.addEventListener("click", async () => {
  if (!currentUserData || retirementBusy) return;

  const amount = parseFloat(withdrawInput.value);
  if (isNaN(amount) || amount <= 0) return showMsg("Enter a valid withdrawal", "error");
  if (currentUserData.employmentStatus !== "Retired") return showMsg("Only retired users can withdraw", "error");
  if ((currentUserData.retirementSavings || 0) < amount) return showMsg("Insufficient retirement savings", "error");

  retirementBusy = true;
  renderSavings();

  try {
    const userRef = doc(db, "users", auth.currentUser.uid);

    const newBalance = currentUserData.balance + amount;
    const newSavings = currentUserData.retirementSavings - amount;

    await updateDoc(userRef, {
      balance: newBalance,
      retirementSavings: newSavings
    });

    await logHistory(auth.currentUser.uid, `Withdrew $${amount}`, "transfer-in");
    updateBalanceDisplay(newBalance, "user-balance", "gain");

    withdrawInput.value = "";
    showMsg(`Withdrew $${amount}`, "success");
  } catch (err) {
    console.error(err);
    showMsg("Withdrawal failed: " + err.message, "error");
  } finally {
    retirementBusy = false;
    renderSavings();
  }
});

// ---------- Monthly Interest (once per month) ----------
async function applyInterestIfFirstDay() {
  if (!currentUserData?.retirementSavings) return;

  const now = new Date();
  if (now.getDate() !== 1) return;
  if (currentUserData.lastInterestApplied?.startsWith(now.toISOString().slice(0, 7))) return;

  const interest = currentUserData.retirementSavings * 0.03;
  const userRef = doc(db, "users", auth.currentUser.uid);

  try {
    await updateDoc(userRef, {
      retirementSavings: currentUserData.retirementSavings + interest,
      lastInterestApplied: now.toISOString()
    });

    await logHistory(auth.currentUser.uid, `Received $${interest.toFixed(2)} interest`, "usage");
  } catch (err) {
    console.error(err);
  }
}

// ---------- Message ----------
function showMsg(msg, type) {
  if (!messageEl) return;
  messageEl.textContent = msg;
  messageEl.style.color = type === "error" ? "red" : "green";
  setTimeout(() => (messageEl.textContent = ""), 4000);
}

// ---------- Export ----------
export { currentUserData, renderSavings };
