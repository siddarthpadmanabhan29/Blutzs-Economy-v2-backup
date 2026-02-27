// ---------- retirement.js (CATCH-UP + LIFETIME TRACKER) ----------
console.log("retirement.js loaded");

import { db, auth } from "./firebaseConfig.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "./historyManager.js";
import { PLANS } from "./membership_plans.js";

// ---------- Elements ----------
const savingsEl = document.getElementById("retirement-savings");
const interestEl = document.getElementById("retirement-interest");
const totalEarnedEl = document.getElementById("retirement-total-earned"); // New Element
const daysEl = document.getElementById("retirement-days");
const depositInput = document.getElementById("retirement-deposit");
const depositBtn = document.getElementById("retirement-deposit-btn");
const withdrawInput = document.getElementById("retirement-withdraw");
const withdrawBtn = document.getElementById("retirement-withdraw-btn");
const messageEl = document.getElementById("retirement-message");

// --- LOCAL STATE ---
let cachedUserData = null; 
let retirementBusy = false; 
let retirementChart = null; // Chart.js instance

// ---------- Render Retirement UI ----------
function renderSavings(userData) {
    if (!userData || !savingsEl) return;
    
    cachedUserData = userData;

    // Membership Data
    const tier = userData.membershipLevel || 'standard';
    const plan = PLANS[tier];
    const interestRatePercent = (plan.interest * 100).toFixed(0);
    
    const savings = Number(userData.retirementSavings || 0);
    const totalEarned = Number(userData.totalInterestEarned || 0); // New Field
    const status = userData.employmentStatus || "Unemployed";

    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const diffTime = nextMonth - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // Update Text Elements
    savingsEl.textContent = savings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (totalEarnedEl) {
        totalEarnedEl.textContent = totalEarned.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    
    const calculatedInterest = savings * plan.interest;
    interestEl.innerHTML = `Next Interest (${interestRatePercent}%): $${calculatedInterest.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    daysEl.textContent = diffDays;

    // Update Visual Chart
    renderGrowthChart(savings, plan.interest);

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
        toggleInputs(true); 
    }
    
    // NEW: Trigger Catch-up check instead of standard check
    applyInterestCatchUp(userData);
}

function toggleInputs(disabled) {
    if (depositBtn) depositBtn.disabled = disabled;
    if (withdrawBtn) withdrawBtn.disabled = disabled;
    if (depositInput) depositInput.disabled = disabled;
    if (withdrawInput) withdrawInput.disabled = disabled;
}

// ---------- Helper: Check Daily Limit Reset ----------
function getTodayLimitUsed(userData) {
    if (!userData.lastRetirementDate) return 0;
    const lastDate = new Date(userData.lastRetirementDate).toDateString();
    const today = new Date().toDateString();
    return (lastDate === today) ? (userData.retirementDailyTotal || 0) : 0;
}

// ---------- Visual Growth Graph (Chart.js) ----------
function renderGrowthChart(currentSavings, interestRate) {
    const canvas = document.getElementById('retirementChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    const months = ["Now", "Mo 1", "Mo 2", "Mo 3", "Mo 4", "Mo 5", "Mo 6"];
    const dataPoints = [currentSavings];
    
    for (let i = 1; i < 7; i++) {
        dataPoints.push(dataPoints[i-1] * (1 + interestRate));
    }

    if (retirementChart) retirementChart.destroy();

    // @ts-ignore
    retirementChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: months,
            datasets: [{
                label: `Projected Growth (${(interestRate * 100).toFixed(0)}% Int)`,
                data: dataPoints,
                borderColor: '#2ecc71',
                backgroundColor: 'rgba(46, 204, 113, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                y: { ticks: { callback: (val) => '$' + Number(val).toLocaleString() } }
            }
        }
    });
}

// ---------- Deposit Logic ----------
depositBtn?.addEventListener("click", async () => {
    if (retirementBusy || !auth.currentUser || !cachedUserData) {
        return showMsg("⚠️ System initializing...", "error");
    }

    const amount = parseFloat(depositInput.value);
    if (isNaN(amount) || amount <= 0) return showMsg("⚠️ Enter a valid deposit amount", "error");

    const tier = cachedUserData.membershipLevel || 'standard';
    const DAILY_LIMIT = 500000;
    const dailyUsed = getTodayLimitUsed(cachedUserData);
    
    if (tier !== 'platinum' && (dailyUsed + amount > DAILY_LIMIT)) {
        return showMsg(`❌ Daily limit exceeded. Remaining: $${(DAILY_LIMIT - dailyUsed).toLocaleString()}`, "error");
    }

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
            retirementSavings: newSavings,
            retirementDailyTotal: dailyUsed + amount,
            lastRetirementDate: new Date().toISOString()
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

    const tier = cachedUserData.membershipLevel || 'standard';
    const DAILY_LIMIT = 500000;
    const dailyUsed = getTodayLimitUsed(cachedUserData);
    
    if (tier !== 'platinum' && (dailyUsed + amount > DAILY_LIMIT)) {
        return showMsg(`❌ Daily limit exceeded. Remaining: $${(DAILY_LIMIT - dailyUsed).toLocaleString()}`, "error");
    }

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
            retirementSavings: newSavings,
            retirementDailyTotal: dailyUsed + amount,
            lastRetirementDate: new Date().toISOString()
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

/* =========================================================
    NEW LOGIC: Catch-up Compound Interest & Lifetime Tracker
========================================================= */
async function applyInterestCatchUp(userData) {
    if (!userData?.retirementSavings || userData.retirementSavings <= 0) return;

    // Use current time if lastInterestApplied is missing
    const lastApplied = userData.lastInterestApplied ? new Date(userData.lastInterestApplied) : new Date();
    const now = new Date();
    
    // Calculate total months passed since last success
    const monthsDiff = (now.getFullYear() - lastApplied.getFullYear()) * 12 + (now.getMonth() - lastApplied.getMonth());

    if (monthsDiff > 0) {
        const tier = userData.membershipLevel || 'standard';
        const rate = PLANS[tier].interest;
        const currentSavings = userData.retirementSavings;

        // Compound Formula: A = P(1 + r)^n
        const newSavings = currentSavings * Math.pow((1 + rate), monthsDiff);
        const amountEarned = newSavings - currentSavings;
        const newLifetimeEarned = (userData.totalInterestEarned || 0) + amountEarned;

        const userRef = doc(db, "users", auth.currentUser.uid);

        try {
            await updateDoc(userRef, {
                retirementSavings: newSavings,
                totalInterestEarned: newLifetimeEarned,
                lastInterestApplied: now.toISOString()
            });

            await logHistory(
                auth.currentUser.uid, 
                `Retirement Catch-up (${monthsDiff} mo): +$${amountEarned.toLocaleString(undefined, {maximumFractionDigits:2})}`, 
                "usage"
            );
        } catch (err) {
            console.error("Interest catch-up failed:", err);
        }
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