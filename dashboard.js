// ---------- dashboard.js ----------
console.log("dashboard.js loaded");

import { auth, db } from "./firebaseConfig.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { doc, onSnapshot, updateDoc, collection, query, orderBy, limit, getDoc, increment } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "./historyManager.js";
import { renderSavings } from "./retirement.js"; 
import { applyInterest, takeOutLoan, repayLoan, getCreditStatus } from "./loan.js"; 

// --- NEW CONTRACT IMPORTS ---
import { listenForContractOffers, listenForAdminRoster, renderUserContract } from "./contracts.js";

// --- SHOP & COSMETICS IMPORTS FOR QUOTA SAVING ---
import { renderShop } from "./shop.js";
import { renderBpsShop } from "./bpsShop.js";
import { loadCosmetics } from "./cosmetics.js"; 

// --- MEMBERSHIP IMPORTS (Updated with Slack integration functions) ---
import { PLANS, checkMembershipBilling, getTierBadge, getNextBillingDate, purchaseMembership, cancelMembership } from "./membership_plans.js";

// --- BPS CONVERTER IMPORT ---
import { renderBpsConverter } from "./bpsConverter.js";

// --- ECONOMIC STATS IMPORT ---
import { renderStatsTeaser } from "./estats.js";

// NEW: Import the shared utility for Option A math synchronization
import { getLiveMarketRate } from "./economyUtils.js";

// NEW: Import the economy logger to archive daily snapshots for real charts
import { logDailyEconomySnapshot } from "./economyLogger.js";

/* =========================================================
    QUOTA PROTECTION: LISTENER MANAGER
========================================================= */
let unsubUser = null;
let unsubHistory = null;
let listenersInitialized = false; 

/* =========================================================
    CONNECTION STATUS UI ELEMENTS
========================================================= */
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");

/* =========================================================
    INSTANT THEME APPLY
========================================================= */
const savedTheme = localStorage.getItem("theme");
if (savedTheme === "dark") document.body.classList.add("dark-mode");
if (savedTheme === "light") document.body.classList.add("light-mode");

// ---------- UI Elements ----------
const dashboard = document.getElementById("dashboard");
const dashboardContent = document.getElementById("dashboard-content"); 
const adminPanel = document.getElementById("admin-panel");
const userName = document.getElementById("user-name");
const userBalance = document.getElementById("user-balance");
const logoutBtn = document.getElementById("logout-btn");
const openAdminBtn = document.getElementById("open-admin");
const backToDashboardBtn = document.getElementById("back-to-dashboard");
const themeToggleBtn = document.getElementById("theme-toggle-btn");

const profileUsername = document.getElementById("profile-username");
const profileUid = document.getElementById("profile-uid");
const profileRenewal = document.getElementById("profile-renewal");
const profileExpiration = document.getElementById("profile-expiration");
const renewalStatus = document.getElementById("renewal-status");
const renewBtn = document.getElementById("renew-btn");

const employmentStatusEl = document.getElementById("employment-status");

const displayCreditScore = document.getElementById("display-credit-score");
const loanAmountSelect = document.getElementById("loan-amount-select");
const takeLoanBtn = document.getElementById("take-loan-btn");
const repayLoanBtn = document.getElementById("repay-loan-btn");
const activeLoanSection = document.getElementById("active-loan-info");
const debtAmountEl = document.getElementById("debt-amount");
const dailyInterestEl = document.getElementById("daily-interest");
const timerEl = document.getElementById("interest-timer");

const unifiedHistoryList = document.getElementById("unified-history-list");
const dateFilterInput = document.getElementById("history-date-filter");
const endDateFilterInput = document.getElementById("history-end-date-filter");
const searchFilterInput = document.getElementById("history-search-filter");
const clearFiltersBtn = document.getElementById("clear-history-filters");
const historyCountBadge = document.getElementById("history-count-badge");

let currentDashboardData = null;
let interestTimerInterval = null; 
let cachedHistory = []; 

/* =========================================================
    HELPER: GET EST DATE (YYYY-MM-DD)
========================================================= */
function getESTDate(offsetDays = 0) {
    const now = new Date();
    const estOffset = now.getTime() + (now.getTimezoneOffset() * 60000) - (5 * 3600000);
    const estDate = new Date(estOffset);
    estDate.setDate(estDate.getDate() + offsetDays);
    return estDate.toISOString().split('T')[0];
}

function applyTheme(theme) {
  if (theme === "light") {
    document.body.classList.add("light-mode");
    document.body.classList.remove("dark-mode");
    if (themeToggleBtn) themeToggleBtn.textContent = "🌙 Dark Mode";
  } else {
    document.body.classList.add("dark-mode");
   document.body.classList.remove("light-mode");
    if (themeToggleBtn) themeToggleBtn.textContent = "☀️ Light Mode";
  }
  localStorage.setItem("theme", theme);
}

/**
 * REFACTORED AUTH STATE LOGIC
 */
onAuthStateChanged(auth, async (user) => {
  if (unsubUser) { unsubUser(); unsubUser = null; }
  if (unsubHistory) { unsubHistory(); unsubHistory = null; }

  if (!user) {
    dashboard.classList.add("hidden");
    adminPanel.classList.add("hidden");
    currentDashboardData = null;
    listenersInitialized = false; 
    
    if (statusDot) {
        statusDot.style.backgroundColor = "#bbb";
        statusDot.classList.remove("status-online");
        statusDot.style.boxShadow = "none";
    }
    if (statusText) {
        statusText.textContent = "Connecting";
        statusText.style.color = "#888";
    }
    return;
  }

  dashboard.classList.remove("hidden");

  // DATA ENGINEERING TRIGGER: Snapshot today's economy for historical trends
  logDailyEconomySnapshot();

  if (!listenersInitialized) {
      listenForContractOffers(user.uid);
      listenForAdminRoster(); 
      listenersInitialized = true;
  }

  const userRef = doc(db, "users", user.uid);
  let themeAppliedOnce = false; 
  let billingCheckedOnce = false;

  unsubUser = onSnapshot(userRef, async snap => { 
    if (statusDot) {
        statusDot.style.backgroundColor = "#2ecc71"; 
        statusDot.classList.add("status-online");   
        statusDot.style.boxShadow = "0 0 8px rgba(46, 204, 113, 0.6)";
    }
    if (statusText) {
        statusText.textContent = "LIVE CONNECTION";
        statusText.style.color = "#2ecc71";
    }

    if (!snap.exists()) return;
    currentDashboardData = snap.data();

    // 1. Check Membership Billing once per login session
    if (!billingCheckedOnce) {
        await checkMembershipBilling(user.uid, currentDashboardData);
        billingCheckedOnce = true;
    }

    await applyInterest(user.uid, currentDashboardData);

    if (!themeAppliedOnce) {
        const theme = currentDashboardData.cosmeticsOwned?.darkMode
            ? (currentDashboardData.theme || localStorage.getItem("theme") || "dark")
            : "light"; 
        applyTheme(theme);
        themeAppliedOnce = true; 
    }

    // SYNC UPDATE: Fetch dynamic market rate to calculate Net Worth
    const { rate: liveRate } = await getLiveMarketRate();
    updateDashboardUI(user, liveRate);

    if (typeof renderShop === "function") renderShop(currentDashboardData);
    if (typeof renderBpsShop === "function") renderBpsShop(currentDashboardData);
    if (typeof loadCosmetics === "function") loadCosmetics(currentDashboardData);
    
    // UPDATED: Ensure renderSavings gets full data for catch-up interest logic
    if (typeof renderSavings === "function") renderSavings(currentDashboardData); 
    
    // NEW: Handle BPS Converter membership checks and limits
    if (typeof renderBpsConverter === "function") renderBpsConverter(currentDashboardData);

    // NEW: Handle Economic Stats Teaser
    if (typeof renderStatsTeaser === "function") renderStatsTeaser(currentDashboardData);

    if (typeof renderUserContract === "function") renderUserContract(user.uid, currentDashboardData);

  }, (error) => {
    if (statusDot) {
        statusDot.style.backgroundColor = "#e74c3c"; 
        statusDot.classList.remove("status-online");
        statusDot.style.boxShadow = "none";
    }
    if (statusText) {
        statusText.textContent = "Offline / Quota Limited";
        statusText.style.color = "#e74c3c";
    }
    console.error("Firestore error:", error);
  });

  const historyRef = collection(db, "users", user.uid, "history_logs");
  const q = query(historyRef, orderBy("timestamp", "desc"), limit(200)); 

  unsubHistory = onSnapshot(q, (snapshot) => {
    cachedHistory = [];
    snapshot.forEach(doc => cachedHistory.push(doc.data()));
    if (dateFilterInput && !dateFilterInput.value) {
        dateFilterInput.value = getESTDate(-1);
        endDateFilterInput.value = getESTDate(0);
    }
    renderUnifiedHistory();
  });
});

/* =========================================================
    UPDATED UNIFIED HISTORY RENDERING (Modern Dark UI)
========================================================= */
function renderUnifiedHistory() {
    if (!unifiedHistoryList) return;
    
    const searchTerm = searchFilterInput.value.toLowerCase();
    const startVal = dateFilterInput.value; 
    const endVal = endDateFilterInput.value; 
    
    unifiedHistoryList.innerHTML = "";

    const filterStartTime = startVal ? new Date(startVal + "T00:00:00").getTime() : 0;
    const filterEndTime = endVal ? new Date(endVal + "T23:59:59").getTime() : Infinity;

    const filtered = cachedHistory.filter(entry => {
      const entryDate = new Date(entry.timestamp);
      const entryMsg = entry.message.toLowerCase();
      const matchesSearch = entryMsg.includes(searchTerm);
      const logTime = entryDate.getTime();
      return matchesSearch && logTime >= filterStartTime && logTime <= filterEndTime;
    });

    if (historyCountBadge) {
        historyCountBadge.textContent = `${filtered.length} found`;
    }

    if (filtered.length === 0) {
        unifiedHistoryList.innerHTML = `<div style="color: gray; padding: 40px; text-align: center; border: 1px dashed #333; border-radius: 10px; font-style: italic;">No matching activity found.</div>`;
        return;
    }

    filtered.forEach(entry => {
        let icon = getHistoryIcon(entry.type);
        const timeStr = getRelativeTime(new Date(entry.timestamp));
        
        let accentColor = "#444"; 
        if (entry.type === "transfer-in" || entry.message.includes("Paid") || entry.message.includes("Received") || entry.message.includes("Approved")) {
            accentColor = "#2ecc71"; 
        } else if (entry.type === "transfer-out" || entry.message.includes("Rejected") || entry.message.includes("Denied") || entry.message.includes("Sent") || entry.message.includes("CUT") || entry.message.includes("Repaid")) {
            accentColor = "#e74c3c"; 
        } else if (entry.type === "membership") {
            accentColor = "#f1c40f";
        }

        unifiedHistoryList.innerHTML += `
    <div class="history-entry-row" style="display: flex; align-items: center; padding: 16px 12px; border-bottom: 1px solid var(--border-color); gap: 20px; width: 100%; box-sizing: border-box; overflow: hidden;">
        <div class="history-icon-wrapper" style="flex-shrink: 0; width: 48px; height: 48px; background: var(--input-bg); border: 2.5px solid ${accentColor}; display: flex; align-items: center; justify-content: center; border-radius: 50%; font-size: 1.2rem; box-shadow: 0 4px 8px rgba(0,0,0,0.15);">
            ${icon}
        </div>
        
        <div style="flex-grow: 1; min-width: 0; overflow: hidden;">
            <div class="history-message" style="color: var(--text-color); font-weight: 600; font-size: 1.05rem; margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${entry.message}
            </div>
            <div class="history-time" style="font-size: 0.85rem; color: var(--text-muted);">${timeStr}</div>
        </div>

        <div class="history-tag-wrapper" style="flex-shrink: 0; margin-left: auto;">
            <span class="history-type-pill" style="font-size: 0.65rem; color: var(--text-muted); background: var(--input-bg); padding: 4px 12px; border-radius: 6px; text-transform: uppercase; font-weight: 800; letter-spacing: 1px; border: 1px solid var(--border-color); white-space: nowrap;">
                ${entry.type}
            </span>
        </div>
    </div>`;
    });
}

function getHistoryIcon(type) {
    switch(type) {
      case "transfer-in":   return "💸";
      case "transfer-out": return "📤";
      case "purchase":     return "🛒";
      case "usage":        return "🧪";
      case "admin":        return "🛡️";
      case "contract":     return "📝";
      case "membership":   return "💎"; 
      default:             return "📄";
    }
}

function getRelativeTime(date) {
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} mins ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  return date.toLocaleDateString(); 
}

/**
 * UPDATED: Reactive Economy Engine (RESISTANCE MODEL)
 * Formula: Uses liveRate passed from getLiveMarketRate()
 */
function updateDashboardUI(user, dynamicRate) {
  if (!currentDashboardData) return;
  const data = currentDashboardData;

  // 1. DATA EXTRACTION
  const balance = Number(data.balance) || 0;
  const bpsBalance = Number(data.bpsBalance) || 0;
  const savings = Number(data.retirementSavings) || 0;
  
  // 2. THE RESISTANCE ENGINE
  const vIndex = Number(data.volatilityIndex) || 34000000;
  
  // 3. NET WORTH CALCULATION
  // Using the liveRate passed from the snapshot for perfect synchronization
  const totalWealth = balance + savings + (bpsBalance * dynamicRate);

  userName.textContent = data.username || user.email.split("@")[0];
  
  // Header now only shows liquid spendable balance
  userBalance.textContent = `$${balance.toLocaleString()}`; 

  // Update Resistance Display Text
  const volDisplay = document.getElementById("volatility-display");
  if (volDisplay) {
    // SYNCED: Logic matches economyStatsPage.js thresholds
    if (vIndex > 45000000) {
        volDisplay.style.color = "#e74c3c"; 
        volDisplay.textContent = "HEAVY RESISTANCE (BEARISH)"; 
    } else if (vIndex < 25000000) {
        volDisplay.style.color = "#2ecc71"; 
        volDisplay.textContent = "OPEN MARKET (BULLISH)"; 
    } else {
        volDisplay.style.color = "#3498db"; 
        volDisplay.textContent = "STABLE MARKET"; 
    }
  }

  // Update BPS Rate Display (Matches Stats and Converter)
  const rateDisplay = document.getElementById("dynamic-bps-rate");
  if (rateDisplay) rateDisplay.textContent = `$${dynamicRate.toLocaleString()}`;

  // Update Net Worth Display
  const netWorthDisplay = document.getElementById("net-worth-display");
  if (netWorthDisplay) netWorthDisplay.textContent = `$${totalWealth.toLocaleString()}`;

  profileUsername.textContent = data.username || user.email.split("@")[0];
  profileUid.textContent = user.uid.slice(0, 8);

  // --- COSMETIC PERSISTENCE UPDATES ---
  if (data.equippedBackground) {
    document.body.style.setProperty('background-color', data.equippedBackground, 'important');
  } else {
    document.body.style.backgroundColor = ""; 
  }

  // --- MEMBERSHIP UI UPDATES ---
  const tier = data.membershipLevel || 'standard';
  const profileBadge = document.getElementById("profile-membership-badge");
  const cancelBtn = document.getElementById("cancel-plan-btn");
  const billingInfoEl = document.getElementById("membership-billing-info");

  if (profileBadge) profileBadge.innerHTML = getTierBadge(tier);
  if (cancelBtn) cancelBtn.classList.toggle("hidden", tier === 'standard');

  const onTrial = !!data.trialExpiration;
  document.querySelectorAll(".join-plan-btn").forEach(btn => {
      const btnPlan = btn.dataset.plan;
      if (onTrial) {
          btn.disabled = true;
          btn.textContent = "Trial Active 🔒";
          btn.style.opacity = "0.6";
      } else if (tier === btnPlan) {
          btn.disabled = true;
          btn.textContent = "Current Plan ✅";
          btn.style.backgroundColor = "#27ae60";
      } else {
          btn.disabled = false;
          btn.textContent = `Join ${PLANS[btnPlan].label}`;
          btn.style.backgroundColor = ""; 
          btn.style.opacity = "1";
      }
  });

  if (billingInfoEl) {
      if (tier !== 'standard' || onTrial) {
          const nextDate = getNextBillingDate(data);
          billingInfoEl.innerHTML = `Next Billing/Trial Renewal: <strong>${nextDate}</strong>`;
          billingInfoEl.classList.remove("hidden");
      } else {
          billingInfoEl.classList.add("hidden");
      }
  }

  const score = data.creditScore || 600;
  const status = getCreditStatus(score);
  if (displayCreditScore) {
      displayCreditScore.innerHTML = `${score} <span style="color: ${status.color}; font-weight: bold; margin-left: 5px;">(${status.label})</span>`;
  }
  const activeDebt = data.activeLoan || 0;
  if (activeDebt > 0) {
      activeLoanSection?.classList.remove("hidden");
      if (debtAmountEl) debtAmountEl.textContent = `$${activeDebt.toLocaleString()}`;
      if (dailyInterestEl) dailyInterestEl.textContent = `$${(activeDebt * 0.05).toLocaleString()}`;
      
      const dueDateEl = document.getElementById("loan-due-date");
     if (dueDateEl && data.loanDeadline) {
          const dueDate = new Date(data.loanDeadline);
          dueDateEl.textContent = `Due: ${dueDate.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`;
          dueDateEl.style.color = "#e74c3c";
          dueDateEl.style.fontWeight = "bold";
      }

      if (data.lastInterestApplied) {
          if (interestTimerInterval) clearInterval(interestTimerInterval);
          interestTimerInterval = setInterval(() => {
              const now = new Date();
              const timeLeft = new Date(data.lastInterestApplied).getTime() + (24*60*60*1000) - now.getTime();
              if (timeLeft <= 0) {
                  if (timerEl) timerEl.textContent = "Next charge in: 00:00:00";
                  clearInterval(interestTimerInterval);
              } else {
                  const hours = Math.floor((timeLeft / 3600000) % 24);
                  const mins = Math.floor((timeLeft / 60000) % 60);
                  const secs = Math.floor((timeLeft / 1000) % 60);
                  if (timerEl) timerEl.textContent = `Next charge in: ${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
              }
          }, 1000);
      }
  } else {
      activeLoanSection?.classList.add("hidden");
      if (interestTimerInterval) clearInterval(interestTimerInterval);
  }
  if (data.isEconomyPaused) dashboardContent?.classList.add("paused-economy");
  else dashboardContent?.classList.remove("paused-economy");

  const expirationDate = data.expirationDate ? new Date(data.expirationDate) : null;
  profileRenewal.textContent = data.renewalDate ? new Date(data.renewalDate).toLocaleDateString() : "N/A";
  profileExpiration.textContent = expirationDate ? expirationDate.toLocaleDateString() : "N/A";

  if (data.renewalPending) {
    renewalStatus.textContent = "Pending Approval";
   renewalStatus.style.color = "orange";
  } else if (expirationDate && expirationDate < new Date()) {
    renewalStatus.textContent = "Expired";
    renewalStatus.style.color = "red";
  } else {
    renewalStatus.textContent = "Active";
    renewalStatus.style.color = "green";
  }

  const employmentStatus = data.employmentStatus || "Unemployed";
  let statusColor = "red";
  if (employmentStatus === "Employed") statusColor = "green";
  else if (employmentStatus === "Retired") statusColor = "blue";
  
  if (employmentStatusEl) {
    employmentStatusEl.textContent = employmentStatus;
    employmentStatusEl.style.color = statusColor;
    employmentStatusEl.style.fontWeight = "bold";
  }

  if (data.isAdmin) openAdminBtn.classList.remove("hidden");
  else openAdminBtn.classList.add("hidden");

  if(document.getElementById("user-bps")) document.getElementById("user-bps").textContent = `${data.bpsBalance || 0} BPS`;

  const discount = data.activeDiscount || 0;
  const discountEl = document.getElementById("active-discount-indicator");
  if(discountEl) {
    if(discount > 0) {
      discountEl.textContent = `🔥 ${discount * 100}% Discount Active!`;
      discountEl.classList.remove("hidden");
    } else {
      discountEl.classList.add("hidden");
    }
  }
}

/* =========================================================
    MEMBERSHIP HANDLERS
========================================================= */
window.joinPlan = async (planKey) => {
    if (!auth.currentUser || !currentDashboardData) return;
    const plan = PLANS[planKey];
    const userRef = doc(db, "users", auth.currentUser.uid);
    const oldTier = currentDashboardData.membershipLevel || 'standard';

    if (currentDashboardData.trialExpiration) {
        alert("You cannot join a paid plan while an active free trial is running.");
        return;
    }

    if (!confirm(`Join ${plan.label} for $${plan.price.toLocaleString()}/month?`)) return;

    if (currentDashboardData.balance < plan.price) {
        alert("Insufficient funds for the first month!");
        return;
    }

    try {
        await updateDoc(userRef, {
            membershipLevel: planKey,
            balance: increment(-plan.price),
            membershipLastPaid: new Date().toISOString(),
            shopOrderCount: 0
        });
        await logHistory(auth.currentUser.uid, `Subscribed to ${plan.label} Plan (-$${plan.price.toLocaleString()})`, "membership");
        
        if (typeof purchaseMembership === "function") {
            await purchaseMembership(auth.currentUser.uid, planKey, currentDashboardData, oldTier);
        }
        alert(`Welcome to ${plan.label}! Your perks are now active.`);
    } catch (err) {
        console.error(err);
        alert("Failed to join plan.");
    }
};

const cancelPlanBtn = document.getElementById("cancel-plan-btn");
cancelPlanBtn?.addEventListener("click", async () => {
    if (!auth.currentUser || !currentDashboardData) return;
    const tierToCancel = currentDashboardData.membershipLevel || 'standard';
    if (!confirm("Are you sure you want to cancel your membership?")) return;

    try {
        await updateDoc(doc(db, "users", auth.currentUser.uid), {
            membershipLevel: "standard",
            shopOrderCount: 0
        });
        await logHistory(auth.currentUser.uid, "Cancelled Membership Subscription", "membership");

        if (typeof cancelMembership === "function") {
            await cancelMembership(auth.currentUser.uid, currentDashboardData, tierToCancel);
        }
        alert("Membership cancelled.");
    } catch (err) {
        console.error(err);
        alert("Failed to cancel plan.");
    }
});

/* =========================================================
    EVENT LISTENERS
========================================================= */
dateFilterInput?.addEventListener("change", renderUnifiedHistory);
endDateFilterInput?.addEventListener("change", renderUnifiedHistory);
searchFilterInput?.addEventListener("input", renderUnifiedHistory);

clearFiltersBtn?.addEventListener("click", () => {
    dateFilterInput.value = getESTDate(-1);
    endDateFilterInput.value = getESTDate(0);
   searchFilterInput.value = "";
    renderUnifiedHistory();
});

themeToggleBtn?.addEventListener("click", async () => {
  if(!auth.currentUser) return;
  if(!currentDashboardData?.cosmeticsOwned?.darkMode) {
    alert("🎨 Buy Dark Mode from the Cosmetics Shop to unlock this feature.");
    return;
  }
  const isLight = document.body.classList.contains("light-mode");
  const newTheme = isLight ? "dark" : "light";
  applyTheme(newTheme);
  await updateDoc(doc(db, "users", auth.currentUser.uid), { theme: newTheme });
});

takeLoanBtn?.addEventListener("click", () => takeOutLoan(parseInt(loanAmountSelect.value)));
repayLoanBtn?.addEventListener("click", () => repayLoan());
openAdminBtn?.addEventListener("click", () => { dashboard.classList.add("hidden"); adminPanel.classList.remove("hidden"); });
backToDashboardBtn?.addEventListener("click", () => { adminPanel.classList.add("hidden"); dashboard.classList.remove("hidden"); });
logoutBtn?.addEventListener("click", async () => { if (unsubUser) unsubUser(); if (unsubHistory) unsubHistory(); await signOut(auth); });

renewBtn?.addEventListener("click", async () => {
  if (!auth.currentUser) return;
  try {
    await updateDoc(doc(db, "users", auth.currentUser.uid), { renewalPending: true, renewalRequestDate: new Date().toISOString() });
    alert("Renewal request sent. Waiting for admin approval.");
  } catch (err) { alert("Could not send renewal request: " + err.message); }
});

loanAmountSelect?.addEventListener("change", () => {
    const amount = parseInt(loanAmountSelect.value);
    const msgEl = document.getElementById("loan-message");
    if (amount === 50000) { msgEl.textContent = "ℹ️ Requirement: Risky Status (0-499)"; msgEl.style.color = "#e74c3c"; }
    else if (amount === 100000) { msgEl.textContent = "ℹ️ Requirement: Fair Status (500-649)"; msgEl.style.color = "#3498db"; }
    else if (amount === 500000) { msgEl.textContent = "ℹ️ Requirement: Good Status (650-749)"; msgEl.style.color = "#2ecc71"; }
    else if (amount === 1000000) { msgEl.textContent = "✨ Requirement: Elite Status (750-850)"; msgEl.style.color = "#f1c40f"; }
});

document.addEventListener('click', async (e) => {
    if (!auth.currentUser) return;

    if (e.target.classList.contains('join-plan-btn')) {
      const planKey = e.target.dataset.plan;
        await window.joinPlan(planKey);
    }

    if (e.target.id === 'request-trade-btn') {
        if (!confirm("Are you sure you want to request a trade?")) return;
        try {
            const userRef = doc(db, "users", auth.currentUser.uid);
            await updateDoc(userRef, { tradePending: true, releasePending: false });
            await logHistory(auth.currentUser.uid, "📤 Sent Trade Request", "contract");
            alert("✅ Trade request sent.");
        } catch (err) {
            console.error(err);
            alert("Failed to send request.");
        }
    }

    if (e.target.id === 'request-release-btn') {
        if (!confirm("Requesting a release will terminate your contract. Continue?")) return;
        try {
            const userRef = doc(db, "users", auth.currentUser.uid);
            await updateDoc(userRef, { releasePending: true, tradePending: false });
            await logHistory(auth.currentUser.uid, "📤 Sent Release Request", "contract");
            alert("✅ Release request sent.");
        } catch (err) {
            console.error(err);
            alert("Failed to send request.");
        }
    }
});