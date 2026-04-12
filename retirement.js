// ---------- retirement.js (CATCH-UP + LIFETIME TRACKER + INSURANCE BOOST + BPS BOOST) ----------
console.log("retirement.js loaded");

import { db, auth } from "./firebaseConfig.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "./historyManager.js";
import { PLANS } from "./membership_plans.js";

// ---------- Elements ----------
const savingsEl = document.getElementById("retirement-savings");
const interestEl = document.getElementById("retirement-interest");
const totalEarnedEl = document.getElementById("retirement-total-earned");
const daysEl = document.getElementById("retirement-days");
const depositInput = document.getElementById("retirement-deposit");
const depositBtn = document.getElementById("retirement-deposit-btn");
const withdrawInput = document.getElementById("retirement-withdraw");
const withdrawBtn = document.getElementById("retirement-withdraw-btn");
const messageEl = document.getElementById("retirement-message");

// --- LOCAL STATE ---
let cachedUserData = null; 
let retirementBusy = false; 
let retirementChart = null; 

// ---------- Helper: Calculate Remaining Boost Days ----------
function getRemainingBoostDays(expiryDateString) {
    if (!expiryDateString) return 0;
    const now = new Date();
    const expiry = new Date(expiryDateString);
    const diff = expiry - now;
    if (diff <= 0) return 0;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// ---------- Render Retirement UI ----------
function renderSavings(userData) {
    if (!userData || !savingsEl) return;
    
    // Safety: ensure cachedUserData is always a clean object
    cachedUserData = userData;

    // Membership Data
    const tier = userData.membershipLevel || 'standard';
    const plan = PLANS[tier] || { interest: 0.03 }; // Fallback if plan is missing
    
    let activeInterestRate = plan.interest || 0;

    // --- INSURANCE LOGIC: Cross Go Package A (+2% Boost if Balance <= $325k) ---
    const userBalance = Number(userData.balance || 0);
    const hasInsuranceBoost = userData.insurance?.activePackages?.includes("crossgo_a") && (userBalance <= 325000);
    if (hasInsuranceBoost) {
        activeInterestRate += 0.02;
    }

    // --- BPS BOOST LOGIC: +1% Boost for 30 Days ---
    let bpsBoostActive = false;
    let bpsDaysLeft = 0;
    if (userData.activeBoosts?.interestBoostExpiry) {
        const expiry = new Date(userData.activeBoosts.interestBoostExpiry);
        if (new Date() < expiry) {
            activeInterestRate += 0.01;
            bpsBoostActive = true;
            bpsDaysLeft = getRemainingBoostDays(userData.activeBoosts.interestBoostExpiry);
        }
    }

    const interestRatePercent = (activeInterestRate * 100).toFixed(0);
    
    const savings = Number(userData.retirementSavings || 0);
    const totalEarned = Number(userData.totalInterestEarned || 0);
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
    
    const calculatedInterest = savings * activeInterestRate;
    
    // UI Notice for boosts
    let boostLabels = "";
    if (hasInsuranceBoost) boostLabels += '<span style="color: #2ecc71; font-size: 0.7rem; margin-left: 5px;">🚀 INSURED BOOST</span>';
    if (bpsBoostActive) {
        boostLabels += `<span style="color: #a29bfe; font-size: 0.7rem; margin-left: 5px;">✨ BPS BOOST (+1% | ${bpsDaysLeft}d left)</span>`;
    }

    interestEl.innerHTML = `Next Interest (${interestRatePercent}%): $${calculatedInterest.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${boostLabels}`;
    
    if (daysEl) daysEl.textContent = diffDays;

    // Update Visual Chart
    renderGrowthChart(savings, activeInterestRate);

    // Button states based on employment
    if (retirementBusy) {
        toggleInputs(true);
    } else if (status === "Employed") {
        if (depositBtn) depositBtn.disabled = false;
        if (withdrawBtn) withdrawBtn.disabled = true;
        if (depositInput) depositInput.disabled = false;
        if (withdrawInput) withdrawInput.disabled = true;
    } else if (status === "Retired") {
        if (depositBtn) depositBtn.disabled = true;
        if (withdrawBtn) withdrawBtn.disabled = false;
        if (depositInput) depositInput.disabled = true;
        if (withdrawInput) withdrawInput.disabled = false;
    } else {
        toggleInputs(true); 
    }
    
    // Trigger interest catch up logic
    applyInterestCatchUp(userData, activeInterestRate);
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
        // The display will auto-update via the snapshot listener in main.js
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
    }
});

/* =========================================================
    NEW LOGIC: Catch-up Compound Interest & Lifetime Tracker
========================================================= */
async function applyInterestCatchUp(userData, activeRate) {
    if (!userData?.retirementSavings || userData.retirementSavings <= 0) return;
    if (!auth.currentUser) return;

    // Use current time if lastInterestApplied is missing to avoid huge fake payouts
    const lastAppliedRaw = userData.lastInterestApplied;
    if (!lastAppliedRaw) {
        const userRef = doc(db, "users", auth.currentUser.uid);
        await updateDoc(userRef, { lastInterestApplied: new Date().toISOString() });
        return;
    }

    const lastApplied = new Date(lastAppliedRaw);
    const now = new Date();
    
    // Monthly calculation
    const monthsDiff = (now.getFullYear() - lastApplied.getFullYear()) * 12 + (now.getMonth() - lastApplied.getMonth());

    if (monthsDiff > 0) {
        const currentSavings = Number(userData.retirementSavings || 0);

        // Formula: A = P(1 + r)^n
        const newSavings = currentSavings * Math.pow((1 + activeRate), monthsDiff);
        const amountEarned = newSavings - currentSavings;
        const newLifetimeEarned = (Number(userData.totalInterestEarned) || 0) + amountEarned;

        const userRef = doc(db, "users", auth.currentUser.uid);

        try {
            await updateDoc(userRef, {
                retirementSavings: newSavings,
                totalInterestEarned: newLifetimeEarned,
                lastInterestApplied: now.toISOString()
            });

            const rateDisplay = (activeRate * 100).toFixed(0);
            await logHistory(
                auth.currentUser.uid, 
                `Retirement Catch-up (${monthsDiff} mo @ ${rateDisplay}%): +$${amountEarned.toLocaleString(undefined, {maximumFractionDigits:2})}`, 
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