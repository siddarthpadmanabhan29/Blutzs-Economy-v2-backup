// ---------- retirement.js ----------
console.log("retirement.js loaded");

import { db, auth } from "./firebaseConfig.js";
import { doc, getDoc, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
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

// ---------- Load user data ----------
auth.onAuthStateChanged((user) => {
  if (!user) return;

  const userRef = doc(db, "users", user.uid);

  onSnapshot(userRef, (docSnap) => {
    if (!docSnap.exists()) return;
    currentUserData = docSnap.data();
    renderSavings();
    applyInterestIfFirstDay(); // Interest auto-apply check
  });
});

// ---------- Render Retirement Savings ----------
function renderSavings() {
  const savings = Number(currentUserData?.retirementSavings || 0);
  const status = currentUserData?.employmentStatus || "Unemployed";

  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const diffDays = Math.ceil((nextMonth - now) / (1000 * 60 * 60 * 24));

  savingsEl.textContent = savings.toFixed(2);
  interestEl.textContent = (savings * 0.03).toFixed(2);
  daysEl.textContent = diffDays;

  depositBtn.disabled = status !== "Employed";
  withdrawBtn.disabled = status === "Unemployed";
}

// ---------- Deposit Handler ----------
depositBtn.addEventListener("click", async () => {
  if (!currentUserData) return;

  const amount = parseFloat(depositInput.value);
  if (isNaN(amount) || amount <= 0) return showMsg("Enter a valid deposit", "error");

  if (currentUserData.employmentStatus !== "Employed") return showMsg("Only employed users can deposit", "error");
  if (currentUserData.balance < amount) return showMsg("Insufficient main balance", "error");

  const userRef = doc(db, "users", auth.currentUser.uid);
  const newBalance = currentUserData.balance - amount;
  const newSavings = (currentUserData.retirementSavings || 0) + amount;

  try {
    await updateDoc(userRef, { balance: newBalance, retirementSavings: newSavings });
    await logHistory(auth.currentUser.uid, `Deposited $${amount} to retirement savings`, "transfer-out");
    updateBalanceDisplay(newBalance, "user-balance", "loss");
    depositInput.value = "";
    renderSavings();
    showMsg(`Deposited $${amount}`, "success");
  } catch (err) {
    console.error(err);
    showMsg("Deposit failed: " + err.message, "error");
  }
});

// ---------- Withdraw Handler ----------
withdrawBtn.addEventListener("click", async () => {
  if (!currentUserData) return;

  const amount = parseFloat(withdrawInput.value);
  if (isNaN(amount) || amount <= 0) return showMsg("Enter a valid withdrawal", "error");

  if (currentUserData.employmentStatus === "Unemployed") return showMsg("Unemployed users cannot withdraw", "error");
  if ((currentUserData.retirementSavings || 0) < amount) return showMsg("Insufficient retirement savings", "error");

  const userRef = doc(db, "users", auth.currentUser.uid);
  const newBalance = currentUserData.balance + amount;
  const newSavings = (currentUserData.retirementSavings || 0) - amount;

  try {
    await updateDoc(userRef, { balance: newBalance, retirementSavings: newSavings });
    await logHistory(auth.currentUser.uid, `Withdrew $${amount} from retirement savings`, "transfer-in");
    updateBalanceDisplay(newBalance, "user-balance", "gain");
    withdrawInput.value = "";
    renderSavings();
    showMsg(`Withdrew $${amount}`, "success");
  } catch (err) {
    console.error(err);
    showMsg("Withdrawal failed: " + err.message, "error");
  }
});

// ---------- Interest Application (First of Month) ----------
async function applyInterestIfFirstDay() {
  if (!currentUserData || !currentUserData.retirementSavings) return;

  const now = new Date();
  if (now.getDate() !== 1) return; // Only first day of month

  const interest = currentUserData.retirementSavings * 0.03;
  const newSavings = currentUserData.retirementSavings + interest;
  const userRef = doc(db, "users", auth.currentUser.uid);

  try {
    await updateDoc(userRef, { retirementSavings: newSavings });
    await logHistory(auth.currentUser.uid, `Received $${interest.toFixed(2)} interest on retirement savings`, "usage");
    renderSavings();
    showMsg(`Interest $${interest.toFixed(2)} applied!`, "success");
  } catch (err) {
    console.error(err);
    showMsg("Interest update failed: " + err.message, "error");
  }
}

// ---------- Message Display ----------
function showMsg(msg, type) {
  if (!messageEl) return;
  messageEl.textContent = msg;
  messageEl.style.color = type === "error" ? "red" : "green";
  setTimeout(() => (messageEl.textContent = ""), 4000);
}

export { renderSavings };
